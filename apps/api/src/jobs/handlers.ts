import { formatApprovalGroup, JobRegistry, type LLMService } from '@papi/core';
import { approvalRevise } from '@papi/prompts';
import { notify } from '../notify.ts';
import type { EmbeddingTable, Repo } from '@papi/server';
import type { TelegramApi } from '../telegram/client.ts';

export interface JobDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi;
  ownerChatId: number;
}

const EMBED_BATCH = 16;
const EMBED_TABLES: EmbeddingTable[] = ['knowledge_items', 'style_memory', 'memory_items'];

export function buildRegistry(deps: JobDeps): JobRegistry {
  const { repo, llm } = deps;
  return new JobRegistry()
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
    });
}

/** Maintenance jobs enqueued from the every-minute cron (Workers free plan: 5 cron triggers). */
export function scheduledJobs(now: Date): { type: string; payload: Record<string, unknown> }[] {
  const out: { type: string; payload: Record<string, unknown> }[] = [];
  if (now.getUTCMinutes() % 15 === 0) out.push({ type: 'embed.missing', payload: {} });
  if (now.getUTCHours() === 3 && now.getUTCMinutes() === 7)
    out.push({ type: 'llm.verify_models', payload: {} });
  return out;
}
