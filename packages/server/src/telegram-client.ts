import type { InlineKeyboard } from '@papi/core';

export interface SendOptions {
  keyboard?: InlineKeyboard;
  silent?: boolean;
  html?: boolean;
}

/** Outbound Telegram surface used by the bot. Faked in tests. */
export interface TelegramApi {
  sendMessage(chatId: number, text: string, opts?: SendOptions): Promise<{ message_id: number }>;
  editReplyMarkup(
    chatId: number,
    messageId: number,
    keyboard: InlineKeyboard | null,
  ): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  downloadFile(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  sendAudio(chatId: number, audio: Uint8Array, mimeType: string, silent?: boolean): Promise<void>;
  sendChatAction(chatId: number, action: 'typing' | 'record_voice'): Promise<void>;
}

const MAX_VOICE_BYTES = 10 * 1024 * 1024;

export class TelegramClient implements TelegramApi {
  private readonly base: string;

  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    // Never include the URL (it contains the token) in errors.
    if (!data.ok) throw new Error(`telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result as T;
  }

  async sendMessage(chatId: number, text: string, opts: SendOptions = {}) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...(opts.html ? { parse_mode: 'HTML' } : {}),
      ...(opts.silent ? { disable_notification: true } : {}),
      ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}),
      link_preview_options: { is_disabled: true },
    });
  }

  async editReplyMarkup(chatId: number, messageId: number, keyboard: InlineKeyboard | null) {
    await this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  }

  async answerCallback(callbackId: string, text?: string) {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text } : {}),
    });
  }

  async downloadFile(fileId: string) {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', {
      file_id: fileId,
    });
    if (!file.file_path) throw new Error('telegram file has no path');
    if ((file.file_size ?? 0) > MAX_VOICE_BYTES) throw new Error('voice note too large');
    const res = await this.fetchFn(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
    );
    if (!res.ok) throw new Error(`telegram file download failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType =
      file.file_path.endsWith('.oga') || file.file_path.endsWith('.ogg')
        ? 'audio/ogg'
        : 'application/octet-stream';
    return { bytes, mimeType };
  }

  async sendAudio(chatId: number, audio: Uint8Array, mimeType: string, silent = false) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (silent) form.append('disable_notification', 'true');
    form.append('audio', new Blob([audio.slice()], { type: mimeType }), 'papi.wav');
    const res = await this.fetchFn(`${this.base}/sendAudio`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`telegram sendAudio failed: ${res.status}`);
  }

  async sendChatAction(chatId: number, action: 'typing' | 'record_voice') {
    await this.call('sendChatAction', { chat_id: chatId, action });
  }
}
