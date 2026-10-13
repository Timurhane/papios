import {
  defaultSettings,
  LLMService,
  type LLMProvider,
  type ProviderGenerateInput,
  type TgUpdate,
} from '@papi/core';
import { MemoryRepo } from '../repo/memory.ts';
import type { SendOptions, TelegramApi } from '../telegram/client.ts';

export const OWNER = 4242;
export const STRANGER = 9999;

export class FakeTelegram implements TelegramApi {
  sent: { chatId: number; text: string; opts?: SendOptions }[] = [];
  answered: { id: string; text?: string }[] = [];
  audio = 0;
  async sendMessage(chatId: number, text: string, opts?: SendOptions) {
    this.sent.push({ chatId, text, opts });
    return { message_id: this.sent.length };
  }
  async editReplyMarkup() {}
  async answerCallback(id: string, text?: string) {
    this.answered.push({ id, text });
  }
  async downloadFile() {
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg' };
  }
  async sendAudio() {
    this.audio++;
  }
  async sendChatAction() {}
  texts() {
    return this.sent.map((s) => s.text);
  }
}

/** LLM whose Gemini replies follow a script; Groq transcribes to `transcript`. */
export function scriptedLLM(script: (string | Error)[], transcript = '') {
  const inputs: ProviderGenerateInput[] = [];
  const gemini: LLMProvider = {
    id: 'gemini',
    async generate(input) {
      inputs.push(input);
      const next = script.shift() ?? '{"action":"reply","text":"tamam"}';
      if (next instanceof Error) throw next;
      return { text: next, usage: { tokensIn: 1, tokensOut: 1 } };
    },
    async embed({ texts }) {
      return texts.map(() => [1, 0]);
    },
    async listModels() {
      return ['models/gemini-flash-latest', 'models/gemini-embedding-001'];
    },
  };
  const groq: LLMProvider = {
    id: 'groq',
    async generate() {
      return { text: '{"action":"reply","text":"groq"}', usage: { tokensIn: 1, tokensOut: 1 } };
    },
    async transcribe() {
      return transcript;
    },
  };
  return { gemini, groq, inputs };
}

export function setup(script: (string | Error)[] = [], transcript = '') {
  const repo = new MemoryRepo();
  repo.knowledge.push(
    {
      id: 'k1',
      kind: 'brand',
      title: 'Slogan',
      content: 'Personel değil, refleks kuruyoruz.',
      embedding: null,
    },
    {
      id: 'k2',
      kind: 'service',
      title: 'Hizmet kolları',
      content: 'AJNA Systems, AJNA Growth, AJNA Creative.',
      embedding: null,
    },
  );
  const tg = new FakeTelegram();
  const { gemini, groq, inputs } = scriptedLLM(script, transcript);
  const llm = new LLMService({
    providers: { gemini, groq },
    settings: structuredClone(defaultSettings.llm),
    store: repo.llmStore,
  });
  return { repo, tg, llm, inputs, deps: { repo, tg, llm, ownerId: OWNER } };
}

export function textUpdate(from: number, text: string, id = 1): TgUpdate {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      from: { id: from },
      chat: { id: from, type: 'private' },
      text,
    },
  };
}

export function voiceUpdate(from: number): TgUpdate {
  return {
    update_id: 2,
    message: {
      message_id: 2,
      date: 0,
      from: { id: from },
      chat: { id: from, type: 'private' },
      voice: { file_id: 'v1', duration: 4, mime_type: 'audio/ogg' },
    },
  };
}

export function callbackUpdate(from: number, data: string): TgUpdate {
  return {
    update_id: 3,
    callback_query: {
      id: 'cb1',
      from: { id: from },
      data,
      message: { message_id: 9, date: 0, chat: { id: from, type: 'private' } },
    },
  };
}
