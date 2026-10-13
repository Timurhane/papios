import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultSettings } from '../settings/defaults.ts';
import { MemoryLLMStore } from '../llm/memory-store.ts';
import { LLMService } from '../llm/service.ts';
import type { LLMProvider, ProviderGenerateInput } from '../llm/types.ts';
import { defineTool, runAgent } from './agent.ts';

function scriptedLLM(replies: string[]) {
  const inputs: ProviderGenerateInput[] = [];
  const provider: LLMProvider = {
    id: 'gemini',
    async generate(input) {
      inputs.push(input);
      return {
        text: replies.shift() ?? '{"action":"reply","text":"son"}',
        usage: { tokensIn: 1, tokensOut: 1 },
      };
    },
  };
  const settings = structuredClone(defaultSettings.llm);
  settings.quotas.gemini = { ...settings.quotas.gemini!, rpm: 1000, rpd: 1000 };
  return {
    llm: new LLMService({ providers: { gemini: provider }, settings, store: new MemoryLLMStore() }),
    inputs,
  };
}

const searchTool = defineTool({
  name: 'search_knowledge',
  description: 'Bilgi bankasında arar.',
  argsHint: '{"query": "metin"}',
  args: z.object({ query: z.string().min(1) }),
  run: async ({ query }) => [
    { title: 'Slogan', content: `${query}: Personel değil, refleks kuruyoruz.` },
  ],
});

const base = {
  agent: 'papi',
  task: 'papi.turn',
  tier: 'medium' as const,
  dataClass: 'internal' as const,
  system: { id: 'papi.system', version: 1, text: 'Sen Papi.' },
  history: [],
  maxSteps: 4,
};

describe('runAgent', () => {
  it('calls a tool, feeds the result back and replies', async () => {
    const { llm, inputs } = scriptedLLM([
      '{"action":"tool","tool":"search_knowledge","args":{"query":"slogan"}}',
      '{"action":"reply","text":"Sloganımız: Personel değil, refleks kuruyoruz."}',
    ]);
    const out = await runAgent({ ...base, llm, tools: [searchTool], input: 'Sloganımız neydi?' });
    expect(out.reply).toContain('refleks');
    expect(out.steps).toEqual([expect.objectContaining({ tool: 'search_knowledge', ok: true })]);
    expect(inputs[1]?.messages.at(-1)?.content).toContain(
      'ARAÇ SONUCU (search_knowledge, başarılı)',
    );
    expect(inputs[0]?.system).toContain('search_knowledge');
  });

  it('reports unknown tools and invalid args back to the model instead of crashing', async () => {
    const { llm, inputs } = scriptedLLM([
      '{"action":"tool","tool":"send_email","args":{}}',
      '{"action":"tool","tool":"search_knowledge","args":{"query":""}}',
      '{"action":"reply","text":"tamam"}',
    ]);
    const out = await runAgent({ ...base, llm, tools: [searchTool], input: 'x' });
    expect(out.steps.map((s) => s.ok)).toEqual([false, false]);
    expect(inputs[1]?.messages.at(-1)?.content).toContain('Bilinmeyen araç');
    expect(out.reply).toBe('tamam');
  });

  it('stops at the step limit and forces a final answer', async () => {
    const loop = '{"action":"tool","tool":"search_knowledge","args":{"query":"a"}}';
    const { llm, inputs } = scriptedLLM([loop, loop, loop, loop, loop]);
    const out = await runAgent({ ...base, llm, tools: [searchTool], input: 'x', maxSteps: 3 });
    expect(inputs).toHaveLength(3);
    expect(inputs[2]?.system).toContain('yalnızca cevap ver');
    expect(out.reply).toContain('tamamlayamadım');
    expect(out.steps).toHaveLength(2);
  });

  it('tool exceptions become error results', async () => {
    const failing = defineTool({
      ...searchTool,
      run: async () => {
        throw new Error('db down');
      },
    });
    const { llm } = scriptedLLM([
      '{"action":"tool","tool":"search_knowledge","args":{"query":"a"}}',
      '{"action":"reply","text":"ok"}',
    ]);
    const out = await runAgent({ ...base, llm, tools: [failing], input: 'x' });
    expect(out.steps[0]).toMatchObject({ ok: false, result: 'Araç hatası: db down' });
  });
});
