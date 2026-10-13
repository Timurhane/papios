import { decideDelivery, inQuietWindow, splitMessage, type NotificationKind } from '@papi/core';
import type { Repo } from '@papi/server';
import type { TelegramApi } from './telegram/client.ts';

export interface QuietMode {
  on: boolean;
  since: string;
}

export async function isQuiet(repo: Repo, now = new Date()): Promise<boolean> {
  const state = await repo.getState<QuietMode>('quiet_mode');
  if (state?.on) return true;
  const settings = await repo.getSettings();
  return inQuietWindow(settings.night_shift.auto_window, now);
}

/** Sends or holds a notification according to quiet mode and preferences (K-15.4, K-15.5). */
export async function notify(
  deps: { repo: Repo; tg: TelegramApi; ownerChatId: number },
  kind: NotificationKind,
  text: string,
): Promise<'sent' | 'held' | 'dropped'> {
  const settings = await deps.repo.getSettings();
  const delivery = decideDelivery(
    kind,
    await isQuiet(deps.repo),
    settings.notifications,
    settings.night_shift.urgent_as_silent,
  );
  if (delivery === 'drop') return 'dropped';
  if (delivery === 'hold') {
    const held =
      (await deps.repo.getState<{ kind: string; text: string; at: string }[]>(
        'held_notifications',
      )) ?? [];
    held.push({ kind, text: text.slice(0, 500), at: new Date().toISOString() });
    await deps.repo.setState('held_notifications', held.slice(-100));
    return 'held';
  }
  for (const part of splitMessage(text)) {
    await deps.tg.sendMessage(deps.ownerChatId, part, { silent: delivery === 'send_silent' });
  }
  return 'sent';
}
