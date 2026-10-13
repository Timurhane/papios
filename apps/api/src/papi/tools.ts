import { defineTool, type AgentTool, type LLMService } from '@papi/core';
import { z } from 'zod';
import type { Repo } from '../repo/types.ts';
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
        "Bir işletmenin linkini (site, Instagram, harita) aday olarak kuyruğa ekler. Analiz Faz 2'de çalışır.",
      argsHint: '{"url": "https://..."}',
      args: z.object({ url: z.url() }),
      run: async ({ url }) => {
        await repo.enqueue('lead.add_from_link', { url, source: 'telegram' }, { heavy: true });
        return { queued: true };
      },
    }),
  ];
}
