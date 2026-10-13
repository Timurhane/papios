import { formatApprovalGroup, JobRegistry, normalizeName, type LLMService } from '@papi/core';
import {
  addFromLink,
  analyzeCompanies,
  draftMonthlyReports,
  draftReply,
  notifyOverdue,
  syncCharges,
  findWebsiteByName,
  formatOutcome,
  upsertCompany,
  type InstagramDiscovery,
  type OpsDeps,
  type SalesDeps,
} from '@papi/server';
import { approvalRevise } from '@papi/prompts';
import { notify } from '../notify.ts';
import type { EmbeddingTable, Repo } from '@papi/server';
import type { TelegramApi } from '@papi/server';

export interface JobDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi;
  ownerChatId: number;
  instagram?: InstagramDiscovery | null;
  pageSpeedKey?: string;
  panelUrl?: string;
  fetchFn?: typeof fetch;
  /** Satıcı (Phase 4): reply drafts. */
  sales?: SalesDeps;
  /** Operatör (Phase 5): charges, overdue alerts, client reports. */
  ops?: OpsDeps;
}

const EMBED_BATCH = 16;
const EMBED_TABLES: EmbeddingTable[] = ['knowledge_items', 'style_memory', 'memory_items'];

export function buildRegistry(deps: JobDeps): JobRegistry {
  const { repo, llm } = deps;
  const analyzeAndReport = async (companyId: string) => {
    const company = await repo.getCompany(companyId);
    if (!company) return;
    const [outcome] = await analyzeCompanies(
      {
        repo,
        llm,
        pageSpeedKey: deps.pageSpeedKey,
        ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
      },
      [company],
      'light',
    );
    if (outcome) await deps.tg.sendMessage(deps.ownerChatId, formatOutcome(outcome, deps.panelUrl));
  };

  return (
    new JobRegistry()
      // K-8.6: a link from Telegram becomes an analysed company card (Phase 2 acceptance: < 5 minutes).
      .register('lead.add_from_link', async (job) => {
        const url = String(job.payload.url ?? '');
        const added = await addFromLink(
          {
            repo,
            llm,
            instagram: deps.instagram ?? null,
            ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
          },
          url,
        );
        if (added.status === 'unsupported') {
          await deps.tg.sendMessage(deps.ownerChatId, added.message);
          return;
        }
        if (added.note) await deps.tg.sendMessage(deps.ownerChatId, `${added.name}: ${added.note}`);
        if (added.analyzable) await analyzeAndReport(added.companyId);
      })
      .register('lead.add_by_name', async (job) => {
        const name = String(job.payload.name ?? '').trim();
        const city = typeof job.payload.city === 'string' ? job.payload.city : null;
        if (!name) return;
        const site = await findWebsiteByName(
          { repo, llm, ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}) },
          name,
          city,
        ).catch(() => null);
        const r = await upsertCompany(repo, {
          name,
          name_norm: normalizeName(name),
          source: 'telegram',
          city,
          ...(site ? { domain: site.domain, website_url: site.url } : {}),
        });
        if (!site)
          await deps.tg.sendMessage(
            deps.ownerChatId,
            `${name}: sitesini bulamadım; web sitesi yokmuş gibi değerlendiriyorum.`,
          );
        await analyzeAndReport(r.id);
      })
      .register('lead.analyze', async (job) =>
        analyzeAndReport(String(job.payload.companyId ?? '')),
      )
      .register('embed.missing', async () => {
        for (const table of EMBED_TABLES) {
          const rows = await repo.missingEmbeddings(table, EMBED_BATCH);
          if (rows.length === 0) continue;
          const vectors = await llm.embed(
            rows.map((r) => r.text),
            { agent: 'system', task: `embed.${table}`, dataClass: 'internal' },
          );
          for (const [i, row] of rows.entries()) {
            const v = vectors[i];
            if (v) await repo.setEmbedding(table, row.id, v);
          }
          if (rows.length === EMBED_BATCH)
            await repo.enqueue('embed.missing', {}, { runAfter: new Date(Date.now() + 60_000) });
          return; // one table per run keeps the cron tick inside the subrequest budget
        }
      })
      .register('finance.daily', async () => {
        if (!deps.ops) return;
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
          new Date(),
        );
        await syncCharges(deps.ops, today);
        await notifyOverdue(deps.ops);
      })
      .register('client.monthly_report', async () => {
        if (!deps.ops) return;
        const n = await draftMonthlyReports(deps.ops);
        if (n)
          await notify(
            deps,
            'approval_pending',
            `📊 ${n} aylık müşteri raporu onay bekliyor: /onaylar`,
          );
      })
      // Satıcı: answer draft for an interested / question reply (redacted input, K-4.9).
      .register('satici.reply_draft', async (job) => {
        if (!deps.sales) return;
        const approvalId = await draftReply(deps.sales, String(job.payload.inboxId ?? ''));
        if (approvalId)
          await notify(deps, 'approval_pending', '✍️ Gelen cevap için taslak hazır: /onaylar');
      })
      .register('approval.revise', async (job) => {
        const approvalId = String(job.payload.approvalId ?? '');
        const old = await repo.getApproval(approvalId);
        if (!old || old.status !== 'needs_revision') return;
        const original =
          typeof old.payload.text === 'string' ? old.payload.text : JSON.stringify(old.payload);
        const correction = String(
          (old as { correction?: string }).correction ?? job.payload.instruction ?? '',
        );
        const revised = await llm.generate({
          agent: 'ulak',
          task: 'approval.revise',
          tier: 'medium',
          dataClass: 'internal',
          promptId: approvalRevise.id,
          promptVersion: approvalRevise.version,
          system: approvalRevise.text,
          messages: [
            { role: 'user', content: `Taslak:\n${original}\n\nDüzeltme talimatı:\n${correction}` },
          ],
        });
        const newId = await repo.createApproval({
          kind: old.kind,
          title: old.title,
          payload: { ...old.payload, text: revised.text.trim() },
          batchId: null,
          agent: 'ulak',
          supersedes: old.id,
        });
        await repo.decideApproval(old.id, 'superseded');
        // An outreach draft keeps its touch: point it at the new approval and text.
        if (typeof old.payload.touchId === 'string') {
          await repo.updateTouch(old.payload.touchId, {
            approval_id: newId,
            body: revised.text.trim(),
          });
        }
        await repo.addStyleMemory({
          draftKind: old.kind,
          original,
          revised: revised.text.trim(),
          instruction: correction,
          verdict: 'edited',
        });
        const { text, keyboard } = formatApprovalGroup(
          [{ id: newId, title: `${old.title} (düzeltildi)`, preview: revised.text.trim() }],
          null,
        );
        await deps.tg.sendMessage(deps.ownerChatId, text, { html: true, keyboard });
      })
      .register('llm.verify_models', async () => {
        const missing = await llm.findMissingModels();
        if (missing.length === 0) return;
        const list = missing.map((m) => `${m.provider}/${m.model}`).join(', ');
        await repo.recordError('llm', 'warning', `configured models not found: ${list}`);
        await notify(
          deps,
          'system_error',
          `⚠️ Ayarlardaki şu modeller sağlayıcıda bulunamadı: ${list}. Ayarlar → LLM yönlendirme bölümünden güncellenmeli.`,
        );
      })
  );
}

/** Maintenance jobs enqueued from the every-minute cron (Workers free plan: 5 cron triggers). */
export function scheduledJobs(now: Date): { type: string; payload: Record<string, unknown> }[] {
  const out: { type: string; payload: Record<string, unknown> }[] = [];
  if (now.getUTCMinutes() % 15 === 0) out.push({ type: 'embed.missing', payload: {} });
  if (now.getUTCHours() === 3 && now.getUTCMinutes() === 7)
    out.push({ type: 'llm.verify_models', payload: {} });
  // 09:05 Istanbul: monthly charges + overdue alerts (K-13.8, K-15.4)
  if (now.getUTCHours() === 6 && now.getUTCMinutes() === 5)
    out.push({ type: 'finance.daily', payload: {} });
  // 1st of the month 09:20 Istanbul: client report drafts (Phase 5)
  if (now.getUTCDate() === 1 && now.getUTCHours() === 6 && now.getUTCMinutes() === 20)
    out.push({ type: 'client.monthly_report', payload: {} });
  return out;
}
