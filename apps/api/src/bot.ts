import {
  chunk,
  classifyUpdate,
  decodeApprovalCallback,
  decodeTouchCallback,
  formatApprovalGroup,
  isOwner,
  QuotaExhaustedError,
  runAgent,
  senderId,
  splitMessage,
  type Command,
  type LLMService,
  type TgUpdate,
} from '@papi/core';
import { papiSystem } from '@papi/prompts';
import { isQuiet, type QuietMode } from './notify.ts';
import { searchKnowledge } from './papi/knowledge.ts';
import { papiTools } from './papi/tools.ts';
import {
  completeOneClick,
  onApprovalDecided,
  type ApprovalRow,
  type OutreachDeps,
  type Repo,
  type TelegramApi,
} from '@papi/server';

export interface BotDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi;
  ownerId: number;
  /** Outreach (Phase 3); absent until the public URL and token secret are configured. */
  outreach?: OutreachDeps;
}

const HISTORY_MESSAGES = 10;
const MAX_VOICE_SECONDS = 300;

const HELP = `Merhaba, ben Papi. Bana yazabilir veya sesli not atabilirsin.

Komutlar:
/bugun – günün özeti
/onaylar – onay bekleyenler
/ekle {link} – işletme linkini aday olarak kuyruğa ekle
/ara {soru} – bilgi bankasında ara
/rapor – kullanım ve sağlık raporu
/kota – yapay zeka kota durumu
/uyuyorum – sessiz mod
/uyandim – sessiz modu kapat ve özet al`;

/** Entry point for one Telegram update. Strangers are ignored silently (K-15.1). */
export async function handleUpdate(
  update: TgUpdate,
  deps: BotDeps,
): Promise<'ignored' | 'handled'> {
  if (!isOwner(update, deps.ownerId)) {
    await deps.repo.audit('telegram.ignored', {
      from_id: senderId(update),
      update_id: update.update_id,
    });
    return 'ignored';
  }

  const incoming = classifyUpdate(update);
  const chatId = incoming.chatId ?? deps.ownerId;
  try {
    switch (incoming.kind) {
      case 'command':
        await handleCommand(incoming.command, incoming.args, chatId, deps);
        break;
      case 'text':
        await handleText(incoming.text, chatId, deps, false);
        break;
      case 'voice': {
        if (incoming.duration > MAX_VOICE_SECONDS) {
          await deps.tg.sendMessage(chatId, 'Sesli not 5 dakikadan uzun; lütfen bölerek gönder.');
          break;
        }
        await deps.tg.sendChatAction(chatId, 'typing');
        const file = await deps.tg.downloadFile(incoming.fileId);
        const text = await deps.llm.transcribe(file.bytes, incoming.mimeType || file.mimeType, {
          agent: 'papi',
          task: 'telegram.voice',
          dataClass: 'internal',
        });
        if (!text) {
          await deps.tg.sendMessage(chatId, 'Sesli notu anlayamadım, tekrar dener misin?');
          break;
        }
        await deps.tg.sendMessage(chatId, `🎙️ ${text}`, { silent: true });
        await handleText(text, chatId, deps, true);
        break;
      }
      case 'callback':
        await handleCallback(incoming.callbackId, incoming.data, chatId, deps);
        break;
      case 'unsupported':
        await deps.tg.sendMessage(chatId, 'Şimdilik yazı ve sesli notları anlayabiliyorum.');
        break;
    }
  } catch (err) {
    if (err instanceof QuotaExhaustedError) {
      await deps.tg.sendMessage(
        chatId,
        'Yapay zeka kotası şu an dolu. Birkaç dakika sonra tekrar dener misin?',
      );
      await deps.repo.recordError('telegram', 'warning', 'quota exhausted during a Telegram turn');
    } else {
      await deps.repo.recordError(
        'telegram',
        'error',
        err instanceof Error ? err.message : String(err),
        { kind: incoming.kind },
      );
      await deps.tg.sendMessage(chatId, 'Bir hata oldu ve kaydettim. Tekrar dener misin?');
    }
  }
  return 'handled';
}

async function handleText(text: string, chatId: number, deps: BotDeps, fromVoice: boolean) {
  const pending = await deps.repo.getState<{ approvalId: string } | null>('awaiting_correction');
  if (pending?.approvalId) {
    await applyCorrection(pending.approvalId, text, chatId, deps);
    return;
  }

  // Rule before model (K-2.3): a bare link is a lead, no LLM needed.
  const bare = bareUrl(text);
  if (bare && !fromVoice) {
    await queueLink(bare, chatId, deps);
    return;
  }

  const settings = await deps.repo.getSettings();
  const history = await deps.repo.recentConversation('telegram', HISTORY_MESSAGES);
  await deps.tg.sendChatAction(chatId, 'typing');
  const result = await runAgent({
    llm: deps.llm,
    agent: 'papi',
    task: 'papi.turn',
    tier: 'medium',
    dataClass: 'internal',
    system: papiSystem,
    tools: papiTools(deps.repo, deps.llm),
    history,
    input: text,
    maxSteps: settings.llm.max_agent_steps,
  });
  await deps.repo.appendConversation('telegram', 'user', text, { voice: fromVoice });
  await deps.repo.appendConversation('telegram', 'assistant', result.reply, {
    tools: result.steps.map((s) => s.tool),
  });
  for (const part of splitMessage(result.reply)) await deps.tg.sendMessage(chatId, part);

  if (fromVoice && settings.telegram.voice_replies) {
    try {
      const audio = await deps.llm.speak(result.reply, {
        agent: 'papi',
        task: 'telegram.voice_reply',
        dataClass: 'internal',
      });
      if (audio) await deps.tg.sendAudio(chatId, audio.audio, audio.mimeType, true);
    } catch (err) {
      await deps.repo.recordError(
        'telegram',
        'warning',
        `voice reply failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// --- commands ----------------------------------------------------------------------------------

async function handleCommand(command: Command, args: string, chatId: number, deps: BotDeps) {
  const { repo, tg } = deps;
  switch (command) {
    case 'start':
    case 'yardim':
      await tg.sendMessage(chatId, HELP);
      return;

    case 'bugun': {
      const [approvals, usage, quiet] = await Promise.all([
        repo.listPendingApprovals(100),
        repo.usageSummary(),
        isQuiet(repo),
      ]);
      await tg.sendMessage(
        chatId,
        [
          '☀️ Bugün',
          `• Onay bekleyen: ${approvals.length}`,
          `• Sessiz mod: ${quiet ? 'açık' : 'kapalı'}`,
          `• Yapay zeka çağrısı (24 saat): ${usage.llmCallsToday} (${usage.cachedToday} önbellekten)`,
          `• Kuyruktaki iş: ${usage.queued}${usage.dead ? ` · başarısız: ${usage.dead}` : ''}`,
          usage.errors24h ? `• ⚠️ Hata (24 saat): ${usage.errors24h}` : null,
          '',
          'Aramalar, ziyaretler ve sıcak cevaplar CRM ile (Faz 2–3) buraya eklenecek.',
        ]
          .filter((l) => l !== null)
          .join('\n'),
      );
      return;
    }

    case 'onaylar':
      await sendApprovals(chatId, deps);
      return;

    case 'ekle': {
      let url: URL;
      try {
        url = new URL(args);
        if (!/^https?:$/.test(url.protocol)) throw new Error('protocol');
      } catch {
        await tg.sendMessage(
          chatId,
          'Kullanım: /ekle https://isletme-sitesi.com (site, Instagram veya harita linki)',
        );
        return;
      }
      await queueLink(url, chatId, deps);
      return;
    }

    case 'ara': {
      if (!args) {
        await tg.sendMessage(chatId, 'Kullanım: /ara {soru}');
        return;
      }
      const hits = await searchKnowledge(repo, deps.llm, args, 3);
      await tg.sendMessage(
        chatId,
        hits.length
          ? hits.map((h) => `• ${h.title}: ${h.content}`).join('\n\n')
          : 'Bilgi bankasında bulamadım. Anlatırsan kaydederim.',
      );
      return;
    }

    case 'rapor':
    case 'kota': {
      const usage = await repo.usageSummary();
      const lines = usage.buckets.map((b) => `• ${b.bucket}: ${b.used}/${b.rpd ?? '—'} bugün`);
      const header = command === 'kota' ? '📊 Kota durumu' : '📋 Rapor';
      const extra =
        command === 'rapor'
          ? [
              `Çağrı (24 saat): ${usage.llmCallsToday} · önbellekten: ${usage.cachedToday}`,
              `Hata (24 saat): ${usage.errors24h}`,
              `Kuyruk: ${usage.queued} bekleyen · ${usage.dead} başarısız`,
            ]
          : [];
      await tg.sendMessage(chatId, [header, ...lines, ...extra].join('\n'));
      return;
    }

    case 'uyuyorum':
      await repo.setState('quiet_mode', {
        on: true,
        since: new Date().toISOString(),
      } satisfies QuietMode);
      await tg.sendMessage(
        chatId,
        'İyi uykular 🌙 Sessiz moddayım: yalnızca sistem hataları ve sıcak cevaplar gelecek. Diğer her şeyi /uyandim deyince özetleyeceğim.',
      );
      return;

    case 'uyandim': {
      const state = await repo.getState<QuietMode>('quiet_mode');
      const since = state?.on ? new Date(state.since) : new Date(Date.now() - 8 * 3_600_000);
      await repo.setState('quiet_mode', {
        on: false,
        since: new Date().toISOString(),
      } satisfies QuietMode);
      const [counts, approvals, held] = await Promise.all([
        repo.countAuditSince(since),
        repo.listPendingApprovals(100),
        repo.getState<{ kind: string; text: string }[]>('held_notifications'),
      ]);
      await repo.setState('held_notifications', []);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const lines = [
        'Günaydın ☀️ Sen uyurken:',
        `• Kayda geçen işlem: ${total}`,
        `• Onay bekleyen: ${approvals.length}`,
        ...(held ?? []).slice(-10).map((h) => `• ${h.text}`),
      ];
      if (approvals.length) lines.push('', 'Onaylar için /onaylar');
      await tg.sendMessage(chatId, lines.join('\n'));
      return;
    }
  }
}

async function sendApprovals(chatId: number, deps: BotDeps) {
  const settings = await deps.repo.getSettings();
  const pending = await deps.repo.listPendingApprovals(50);
  if (pending.length === 0) {
    await deps.tg.sendMessage(chatId, 'Onay bekleyen iş yok ✅');
    return;
  }
  for (const group of chunk(pending, settings.telegram.approvals_per_message)) {
    const batchId = sharedBatch(group);
    const { text, keyboard } = formatApprovalGroup(
      group.map((a) => ({ id: a.id, title: a.title, preview: previewOf(a) })),
      batchId,
    );
    await deps.tg.sendMessage(chatId, text, { html: true, keyboard });
  }
}

function sharedBatch(group: ApprovalRow[]): string | null {
  const first = group[0]?.batch_id ?? null;
  return first && group.every((a) => a.batch_id === first) ? first : null;
}

function previewOf(a: ApprovalRow): string {
  const text = a.payload.text;
  return typeof text === 'string' ? text : JSON.stringify(a.payload);
}

// --- approvals ---------------------------------------------------------------------------------

async function handleCallback(callbackId: string, data: string, chatId: number, deps: BotDeps) {
  const touchCb = decodeTouchCallback(data);
  if (touchCb) {
    await handleTouchCallback(callbackId, touchCb, chatId, deps);
    return;
  }
  const cb = decodeApprovalCallback(data);
  if (!cb) {
    await deps.tg.answerCallback(callbackId, 'Geçersiz işlem');
    return;
  }

  if (cb.scope === 'batch') {
    const status = cb.op === 'ok' ? 'approved' : 'rejected';
    const ids = await deps.repo.decideBatch(cb.id, status);
    for (const id of ids) await afterDecision(id, status, deps);
    await deps.tg.answerCallback(
      callbackId,
      ids.length
        ? `${ids.length} iş ${status === 'approved' ? 'onaylandı' : 'reddedildi'}`
        : 'Bekleyen iş kalmamış',
    );
    return;
  }

  const approval = await deps.repo.getApproval(cb.id);
  if (!approval || approval.status !== 'pending') {
    await deps.tg.answerCallback(callbackId, 'Bu iş artık beklemiyor');
    return;
  }

  if (cb.op === 'ed') {
    await deps.repo.setState('awaiting_correction', { approvalId: approval.id });
    await deps.tg.answerCallback(callbackId);
    await deps.tg.sendMessage(
      chatId,
      `✏️ "${approval.title}" için düzeltmeni yaz veya sesli not at.`,
    );
    return;
  }

  const status = cb.op === 'ok' ? 'approved' : 'rejected';
  if (await deps.repo.decideApproval(approval.id, status)) {
    await afterDecision(approval.id, status, deps, approval);
  }
  await deps.tg.answerCallback(
    callbackId,
    status === 'approved' ? 'Onaylandı ✅' : 'Reddedildi ❌',
  );
}

/** Style memory + (for outreach) scheduling of the approved touch. */
async function afterDecision(
  approvalId: string,
  status: 'approved' | 'rejected',
  deps: BotDeps,
  known?: ApprovalRow,
) {
  const approval = known ?? (await deps.repo.getApproval(approvalId));
  if (!approval) return;
  await deps.repo.addStyleMemory({
    draftKind: styleKind(approval),
    original: personalPart(approval),
    revised: null,
    instruction: null,
    verdict: status === 'approved' ? 'approved' : 'rejected',
  });
  if (approval.kind === 'outreach' && deps.outreach)
    await onApprovalDecided(deps.outreach, approval.id, status);
}

/** Style memory keeps only the model-written part: greetings with names never reach a prompt (K-4.7). */
function personalPart(a: ApprovalRow): string {
  return typeof a.payload.personal === 'string' ? a.payload.personal : previewOf(a);
}

function styleKind(a: ApprovalRow): string {
  return typeof a.payload.draftKind === 'string' ? a.payload.draftKind : a.kind;
}

async function handleTouchCallback(
  callbackId: string,
  cb: { touchId: string; op: 'ok' | 'no' },
  chatId: number,
  deps: BotDeps,
) {
  if (!deps.outreach) {
    await deps.tg.answerCallback(callbackId, 'Henüz hazır değil');
    return;
  }
  const touch = await completeOneClick(deps.outreach, cb.touchId, cb.op === 'ok' ? 'sent' : 'skip');
  await deps.tg.answerCallback(
    callbackId,
    touch ? (cb.op === 'ok' ? 'Kaydedildi ✅' : 'Atlandı') : 'Bu iş artık beklemiyor',
  );
  if (touch?.channel === 'phone_call' && cb.op === 'ok') {
    await deps.tg.sendMessage(
      chatId,
      'Görüşme nasıl geçti? Sesli not atarsan firmanın hafızasına eklerim.',
    );
  }
}

async function applyCorrection(
  approvalId: string,
  instruction: string,
  chatId: number,
  deps: BotDeps,
) {
  await deps.repo.setState('awaiting_correction', null);
  const approval = await deps.repo.getApproval(approvalId);
  if (!approval || !(await deps.repo.decideApproval(approvalId, 'needs_revision', instruction))) {
    await deps.tg.sendMessage(chatId, 'Bu iş artık beklemiyor, düzeltmeyi uygulayamadım.');
    return;
  }
  await deps.repo.addStyleMemory({
    draftKind: styleKind(approval),
    original: personalPart(approval),
    revised: null,
    instruction,
    verdict: 'edited',
  });
  await deps.repo.enqueue('approval.revise', { approvalId });
  await deps.tg.sendMessage(chatId, 'Not aldım. Taslağı düzeltip tekrar onayına sunacağım.');
}

function bareUrl(text: string): URL | null {
  const t = text.trim();
  if (/\s/.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u : null;
  } catch {
    return null;
  }
}

/** K-8.6: queue the link; the cron worker analyses it within a minute and sends the card. */
async function queueLink(url: URL, chatId: number, deps: BotDeps) {
  await deps.repo.enqueue(
    'lead.add_from_link',
    { url: url.toString(), source: 'telegram' },
    { priority: 10 },
  );
  await deps.repo.audit('lead.link_queued', { host: url.hostname }, { type: 'agent', id: 'papi' });
  await deps.tg.sendMessage(
    chatId,
    `🔎 ${url.hostname} kuyruğa alındı. Analiz ve puan 1–2 dakika içinde gelecek.`,
  );
}
