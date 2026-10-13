import type { Prompt } from '../index.ts';

export const approvalRevise: Prompt = {
  id: 'approval.revise',
  version: 1,
  text: `Bir taslağı Timurhan'ın düzeltme talimatına göre yeniden yazıyorsun.
- Talimatı eksiksiz uygula; talimatta olmayan şeyi değiştirme.
- Taslağın dilini, hitabını ve amacını koru.
- Yalnızca yeni taslak metnini döndür.`,
};
