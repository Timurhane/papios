import { localDate, redactPersonal, type LLMService } from '@papi/core';
import { papiVoice } from '@papi/prompts';
import { addNote, searchNotes, type Repo } from '@papi/server';
import { z } from 'zod';
import { searchKnowledge } from './papi/knowledge.ts';

/**
 * K-3.10, K-15.6, K-15.7: "Papi ile konuş". The Worker mints a single-use Gemini Live token whose model,
 * instructions and tools are locked; the API key never reaches the browser. Tool calls come back to the
 * Worker (authenticated panel session) and run read-only.
 */
export interface VoiceDeps {
  repo: Repo;
  llm: LLMService;
  geminiApiKey: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const TZ = 'Europe/Istanbul';
/** One token covers at most this much speaking time; a new one is minted for longer talks. */
const CHUNK_SECONDS = 600;
const now = (d: { now?: () => Date }) => d.now?.() ?? new Date();

interface VoiceUsage {
  day: string;
  seconds: number;
}

async function usage(deps: VoiceDeps): Promise<VoiceUsage> {
  const day = localDate(now(deps), TZ);
  const u = await deps.repo.getState<VoiceUsage>('voice_usage');
  return u && u.day === day ? u : { day, seconds: 0 };
}

const str = (description: string) => ({ type: 'STRING', description });
/** Read tools plus note / quiet mode (K-15.7). Locked into the token. */
export const VOICE_TOOLS = [
  {
    name: 'search_knowledge',
    description: 'AJNA bilgi bankasında arar (marka, paketler, itirazlar, vakalar).',
    parameters: {
      type: 'OBJECT',
      properties: { query: str('aranacak ifade') },
      required: ['query'],
    },
  },
  {
    name: 'search_notes',
    description: "Timurhan'ın notlarında anlamca arar.",
    parameters: { type: 'OBJECT', properties: { query: str('konu') }, required: ['query'] },
  },
  {
    name: 'find_company',
    description: "CRM'de firma arar; puan, aşama ve sıradaki adımı verir.",
    parameters: { type: 'OBJECT', properties: { name: str('firma adı') }, required: ['name'] },
  },
  {
    name: 'today_summary',
    description: 'Günün özeti: onay bekleyenler, tek tık işler, aramalar.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'quota_status',
    description: 'Yapay zeka kotası, kuyruk ve hata durumu.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'save_note',
    description: 'Not alır. Dışarı gidecek bir istek varsa metne #taslak ekle.',
    parameters: { type: 'OBJECT', properties: { text: str('not metni') }, required: ['text'] },
  },
  {
    name: 'set_quiet_mode',
    description: 'Sessiz modu açar veya kapatır.',
    parameters: {
      type: 'OBJECT',
      properties: { on: { type: 'BOOLEAN', description: 'açık mı' } },
      required: ['on'],
    },
  },
] as const;
export type VoiceToolName = (typeof VOICE_TOOLS)[number]['name'];

export type StartResult =
  | { ok: true; token: string; model: string; seconds: number; remainingSeconds: number }
  | { ok: false; reason: 'limit' | 'not_configured' | 'provider'; remainingSeconds: number };

export async function startVoice(deps: VoiceDeps): Promise<StartResult> {
  const s = await deps.repo.getSettings();
  const u = await usage(deps);
  const remaining = Math.max(0, s.live_voice.daily_minutes * 60 - u.seconds);
  if (remaining < 30) return { ok: false, reason: 'limit', remainingSeconds: remaining };
  if (!deps.geminiApiKey)
    return { ok: false, reason: 'not_configured', remainingSeconds: remaining };
  const seconds = Math.min(CHUNK_SECONDS, remaining);
  const t = now(deps);
  const model = s.live_voice.model;
  const res = await (deps.fetchImpl ?? fetch)(
    'https://generativelanguage.googleapis.com/v1alpha/auth_tokens',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.geminiApiKey },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(t.getTime() + seconds * 1000).toISOString(),
        newSessionExpireTime: new Date(t.getTime() + 60_000).toISOString(),
        // Everything the session may do is fixed here; the browser cannot change it.
        bidiGenerateContentSetup: {
          model: `models/${model}`,
          generationConfig: { responseModalities: ['AUDIO'] },
          systemInstruction: { parts: [{ text: papiVoice.text }] },
          tools: [{ functionDeclarations: VOICE_TOOLS }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        fieldMask:
          'model,generationConfig,systemInstruction,tools,inputAudioTranscription,outputAudioTranscription',
      }),
    },
  );
  if (!res.ok) {
    await deps.repo.recordError('voice', 'warning', `live token failed: ${res.status}`);
    return { ok: false, reason: 'provider', remainingSeconds: remaining };
  }
  const token = ((await res.json()) as { name?: string }).name;
  if (!token) return { ok: false, reason: 'provider', remainingSeconds: remaining };
  // The whole chunk is reserved now; voice.end refunds what was not used.
  await deps.repo.setState('voice_usage', { day: u.day, seconds: u.seconds + seconds });
  await deps.repo.audit('voice.started', { model, seconds }, { type: 'agent', id: 'papi' });
  return { ok: true, token, model, seconds, remainingSeconds: remaining - seconds };
}

/** Session ended: refund unused reserved time, keep a short transcript in Papi's history. */
export async function endVoice(
  deps: VoiceDeps,
  reservedSeconds: number,
  usedSeconds: number,
  transcript: string,
): Promise<{ remainingSeconds: number }> {
  const s = await deps.repo.getSettings();
  const u = await usage(deps);
  const refund = Math.max(0, Math.min(reservedSeconds, CHUNK_SECONDS) - Math.max(0, usedSeconds));
  const seconds = Math.max(0, u.seconds - refund);
  await deps.repo.setState('voice_usage', { day: u.day, seconds });
  const text = transcript.trim().slice(0, 4000);
  if (text)
    await deps.repo.appendConversation(
      'telegram',
      'assistant',
      `🎙️ Sesli konuşma özeti:\n${text}`,
      {
        via: 'voice',
      },
    );
  await deps.repo.audit(
    'voice.ended',
    { used_seconds: usedSeconds },
    { type: 'agent', id: 'papi' },
  );
  return { remainingSeconds: Math.max(0, s.live_voice.daily_minutes * 60 - seconds) };
}

const argSchemas = {
  search_knowledge: z.object({ query: z.string().min(2).max(200) }),
  search_notes: z.object({ query: z.string().min(2).max(200) }),
  find_company: z.object({ name: z.string().min(2).max(120) }),
  today_summary: z.object({}),
  quota_status: z.object({}),
  save_note: z.object({ text: z.string().min(2).max(2000) }),
  set_quiet_mode: z.object({ on: z.boolean() }),
} satisfies Record<VoiceToolName, z.ZodType>;

export function isVoiceTool(name: string): name is VoiceToolName {
  return Object.prototype.hasOwnProperty.call(argSchemas, name);
}

/** Runs one tool call. Results go back to a free-tier model: personal data stays masked (K-4.9). */
export async function runVoiceTool(
  deps: VoiceDeps,
  name: VoiceToolName,
  rawArgs: unknown,
): Promise<Record<string, unknown>> {
  const { repo } = deps;
  switch (name) {
    case 'search_knowledge': {
      const a = argSchemas[name].parse(rawArgs);
      const hits = await searchKnowledge(repo, deps.llm, a.query, 3);
      return { results: hits.map((h) => ({ title: h.title, content: h.content })) };
    }
    case 'search_notes': {
      const a = argSchemas[name].parse(rawArgs);
      const hits = await searchNotes({ repo, llm: deps.llm }, a.query, 3);
      return { results: hits.map((h) => redactPersonal(h.body).text.slice(0, 400)) };
    }
    case 'find_company': {
      const a = argSchemas[name].parse(rawArgs);
      const hits = await repo.searchCompanies(a.name, 3);
      return {
        results: hits.map((c) =>
          // K-4.7: a won client's details stay out of free-tier models.
          c.stage === 'won'
            ? { name: c.name, stage: 'müşteri' }
            : {
                name: c.name,
                city: c.city,
                sector: c.sector,
                score: c.score,
                stage: c.stage,
                next_step: c.assigned_playbook ?? c.waiting_reason,
              },
        ),
      };
    }
    case 'today_summary': {
      const [approvals, ready] = await Promise.all([
        repo.listPendingApprovals(100),
        repo.touchesByStatus(['ready'], 100),
      ]);
      const calls = ready.filter((t) => t.channel === 'phone_call' || t.channel === 'visit').length;
      return {
        pending_approvals: approvals.length,
        one_click: ready.length - calls,
        calls_and_visits: calls,
      };
    }
    case 'quota_status': {
      const u = await repo.usageSummary();
      return {
        buckets: u.buckets.map((b) => ({ bucket: b.bucket, used: b.used, per_day: b.rpd })),
        queued_jobs: u.queued,
        failed_jobs: u.dead,
        errors_24h: u.errors24h,
      };
    }
    case 'save_note': {
      const a = argSchemas[name].parse(rawArgs);
      const r = await addNote({ repo }, a.text, 'panel');
      return { saved: true, tags: r.tags };
    }
    case 'set_quiet_mode': {
      const a = argSchemas[name].parse(rawArgs);
      await repo.setState('quiet_mode', { on: a.on, since: now(deps).toISOString() });
      return { quiet: a.on };
    }
  }
}
