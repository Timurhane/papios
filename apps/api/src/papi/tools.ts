import { defineTool, redactPersonal, type AgentTool, type LLMService } from '@papi/core';
import { z } from 'zod';
import { searchNotes, type Repo } from '@papi/server';
import { searchKnowledge } from './knowledge.ts';

const KNOWLEDGE_KINDS = [
  'brand',
  'service',
  'icp',
  'objection',
  'case_study',
  'module_catalog',
  'other',
] as const;

/** Papi's tool allow-list for Phase 1 (K-5.3 subset; the rest arrives with its module). */
export function papiTools(repo: Repo, llm: LLMService): AgentTool<unknown>[] {
  return [
    defineTool({
      name: 'search_knowledge',
      description:
        'AJNA bilgi bankasında (marka, paketler, ideal müşteri, itirazlar, vakalar) arar.',
      argsHint: '{"query": "aranacak ifade"}',
      args: z.object({ query: z.string().min(2).max(200) }),
      run: async ({ query }) => {
        const hits = await searchKnowledge(repo, llm, query, 4);
        return hits.length
          ? hits.map(({ title, content }) => ({ title, content }))
          : 'Bilgi bankasında sonuç yok.';
      },
    }),
    defineTool({
      name: 'search_notes',
      description:
        'Timurhan\'ın notlarında ve görüşme özetlerinde anlamca arar ("geçen ay o klinikçi ne demişti").',
      argsHint: '{"query": "aranacak konu"}',
      args: z.object({ query: z.string().min(2).max(200) }),
      run: async ({ query }) => {
        const hits = await searchNotes({ repo, llm }, query, 4);
        // Results go back into a free-tier prompt: personal data stays masked (K-4.9).
        return hits.length
          ? hits.map((h) => ({
              date: h.created_at.slice(0, 10),
              note: redactPersonal(h.body).text.slice(0, 600),
            }))
          : 'Notlarda sonuç yok.';
      },
    }),
    defineTool({
      name: 'save_knowledge',
      description: "Timurhan'ın anlattığı yeni bir AJNA bilgisini bilgi bankasına kaydeder.",
      argsHint: `{"kind": "${KNOWLEDGE_KINDS.join('|')}", "title": "kısa başlık", "content": "düzenlenmiş metin"}`,
      args: z.object({
        kind: z.enum(KNOWLEDGE_KINDS),
        title: z.string().min(2).max(120),
        content: z.string().min(2).max(4000),
      }),
      run: async ({ kind, title, content }) => {
        const id = await repo.addKnowledge(kind, title, content);
        await repo.enqueue('embed.missing', {}, { unique: true });
        await repo.audit('knowledge.saved', { id, kind }, { type: 'agent', id: 'papi' });
        return { saved: true, id };
      },
    }),
    defineTool({
      name: 'list_pending_approvals',
      description: 'Onay bekleyen işleri listeler.',
      argsHint: '{}',
      args: z.object({}),
      run: async () =>
        (await repo.listPendingApprovals(20)).map((a) => ({ title: a.title, kind: a.kind })),
    }),
    defineTool({
      name: 'quota_status',
      description:
        'Yapay zeka sağlayıcılarının bugünkü kota kullanımını, hata ve kuyruk sayılarını verir.',
      argsHint: '{}',
      args: z.object({}),
      run: async () => repo.usageSummary(),
    }),
    defineTool({
      name: 'set_quiet_mode',
      description: 'Sessiz modu açar (uyku) veya kapatır.',
      argsHint: '{"on": true}',
      args: z.object({ on: z.boolean() }),
      run: async ({ on }) => {
        await repo.setState('quiet_mode', { on, since: new Date().toISOString() });
        return { quiet: on };
      },
    }),
    defineTool({
      name: 'queue_lead_link',
      description:
        'Bir işletmenin linkini (site, Instagram, harita) aday olarak ekler; analiz edilip puanlanır.',
      argsHint: '{"url": "https://..."}',
      args: z.object({ url: z.url() }),
      run: async ({ url }) => {
        await repo.enqueue('lead.add_from_link', { url, source: 'telegram' }, { priority: 10 });
        return { queued: true, note: "Analiz kartı 1–2 dakika içinde Telegram'a gelecek." };
      },
    }),
    defineTool({
      name: 'add_lead_by_name',
      description: 'İşletme adıyla aday ekler; sitesini arayıp doğrular, sonra analiz eder.',
      argsHint: '{"name": "işletme adı", "city": "il (isteğe bağlı)"}',
      args: z.object({
        name: z.string().min(2).max(120),
        city: z.string().min(2).max(40).optional(),
      }),
      run: async ({ name, city }) => {
        await repo.enqueue('lead.add_by_name', { name, city: city ?? null }, { priority: 10 });
        return { queued: true };
      },
    }),
    defineTool({
      name: 'find_company',
      description: "CRM'de firma arar (ad, alan adı veya Instagram) ve puan/aşama bilgisini verir.",
      argsHint: '{"query": "aranacak ifade"}',
      args: z.object({ query: z.string().min(2).max(100) }),
      run: async ({ query }) =>
        (await repo.searchCompanies(query, 5)).map((c) => ({
          name: c.name,
          score: c.score,
          stage: c.stage,
          next: c.next_step_kind === 'playbook' ? c.assigned_playbook : c.waiting_reason,
          city: c.city,
        })),
    }),
    defineTool({
      name: 'start_lead_search',
      description:
        'Web aramasıyla yeni aday bulur (ör. "Balıkesir\'deki diş klinikleri"); sitesi doğrulananlar CRM\'e girer.',
      argsHint: '{"query": "arama cümlesi"}',
      args: z.object({ query: z.string().min(5).max(200) }),
      run: async ({ query }) => {
        await repo.enqueue('kasif.grounded_search', { query }, { heavy: true });
        return {
          queued: true,
          note: "Arama arka planda çalışacak; sonuçlar CRM'e düşünce bildireceğim.",
        };
      },
    }),
    defineTool({
      name: 'start_osm_search',
      description: "OpenStreetMap'te bir ildeki işletmeleri sektöre göre arar.",
      argsHint:
        '{"area": "il adı", "sectors": ["clinic","real_estate","auto","hotel","education","construction","manufacturing"]}',
      args: z.object({
        area: z.string().min(2).max(60),
        sectors: z
          .array(
            z.enum([
              'clinic',
              'real_estate',
              'auto',
              'hotel',
              'education',
              'construction',
              'manufacturing',
            ]),
          )
          .min(1),
      }),
      run: async ({ area, sectors }) => {
        await repo.enqueue('kasif.osm_search', { area, sectors }, { heavy: true });
        return { queued: true };
      },
    }),
  ];
}
