import { describeSchedule, ACTION_LABEL, validateRoutine, type LLMService } from '@papi/core';
import {
  describeRoutine,
  parseRoutineRequest,
  saveRoutine,
  type Repo,
  type TelegramApi,
} from '@papi/server';

export interface AutomationBotDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi;
}

export const AUTOMATION_HELP = `/rutin – rutinlerin listesi
/rutin {istek} – doğal dille yeni rutin ("her pazartesi 9'da sıcak adayları özetle")
/rutin kapat {no} · /rutin ac {no} – rutini kapat / aç`;

/** Routine confirmation buttons: the parsed spec waits in runtime_state until Timurhan answers. */
export const ROUTINE_OK = 'rt:ok';
export const ROUTINE_NO = 'rt:no';
const PENDING_KEY = 'pending_routine';

export async function handleRoutineCommand(
  args: string,
  chatId: number,
  deps: AutomationBotDeps,
): Promise<void> {
  const { repo, tg } = deps;
  const routines = await repo.listRoutines();
  const text = args.trim();
  if (!text) {
    if (!routines.length) {
      await tg.sendMessage(chatId, 'Hiç rutin yok. Örnek: /rutin her cuma 17:00 haftalık özet');
      return;
    }
    await tg.sendMessage(
      chatId,
      [
        '⏱ Rutinler',
        ...routines.map(
          (r, i) =>
            `${i + 1}. ${r.enabled ? '🟢' : '⚪️'} ${r.name} — ${describeSchedule(r.schedule)} (${ACTION_LABEL[r.action]})`,
        ),
        '',
        'Kapatmak/açmak için: /rutin kapat 3 · /rutin ac 3',
      ].join('\n'),
    );
    return;
  }

  const toggle = /^(kapat|ac|aç)\s+(\d+)$/i.exec(text);
  if (toggle) {
    const r = routines[Number(toggle[2]) - 1];
    if (!r) {
      await tg.sendMessage(chatId, 'Bu numarada rutin yok. Liste için: /rutin');
      return;
    }
    const enabled = toggle[1]?.toLowerCase() !== 'kapat';
    // Re-enabling recomputes the next run on the next tick instead of firing a stale due time.
    await repo.updateRoutine(r.id, enabled ? { enabled, next_run_at: null } : { enabled });
    await repo.audit('routine.toggled', { routine: r.code, enabled, via: 'telegram' });
    await tg.sendMessage(chatId, `${r.name} ${enabled ? 'açıldı 🟢' : 'kapatıldı ⚪️'}`);
    return;
  }

  const spec = await parseRoutineRequest(deps, text).catch(() => null);
  if (!spec) {
    await tg.sendMessage(
      chatId,
      'Bunu izinli rutinlerden birine çeviremedim. Örnek: "her pazartesi 9\'da sıcak adayları özetle".',
    );
    return;
  }
  await repo.setState(PENDING_KEY, spec);
  await tg.sendMessage(chatId, `Şu rutini kaydedeyim mi?\n\n${describeRoutine(spec)}`, {
    keyboard: [
      [
        { text: '✅ Kaydet', callback_data: ROUTINE_OK },
        { text: '❌ Vazgeç', callback_data: ROUTINE_NO },
      ],
    ],
  });
}

/** True when the callback was a routine confirmation. */
export async function handleRoutineCallback(
  callbackId: string,
  data: string,
  deps: AutomationBotDeps,
): Promise<boolean> {
  if (data !== ROUTINE_OK && data !== ROUTINE_NO) return false;
  const pending = validateRoutine(await deps.repo.getState<unknown>(PENDING_KEY));
  await deps.repo.setState(PENDING_KEY, null);
  if (!pending) {
    await deps.tg.answerCallback(callbackId, 'Bekleyen rutin yok');
    return true;
  }
  if (data === ROUTINE_NO) {
    await deps.tg.answerCallback(callbackId, 'Vazgeçildi');
    return true;
  }
  await saveRoutine(deps, pending, 'telegram');
  await deps.tg.answerCallback(callbackId, 'Rutin kaydedildi ✅');
  return true;
}
