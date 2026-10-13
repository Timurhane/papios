import { z } from 'zod';
import type { LLMService } from '../llm/service.ts';
import type { ChatMessage, DataClass, Tier } from '../llm/types.ts';

export interface AgentTool<A = unknown> {
  name: string;
  description: string;
  /** Short JSON hint of the arguments shown to the model, e.g. {"query": "metin"}. */
  argsHint: string;
  args: z.ZodType<A>;
  run(args: A): Promise<unknown>;
}

/** Erases the argument type so tools with different shapes fit in one list. */
export function defineTool<A>(tool: AgentTool<A>): AgentTool<unknown> {
  return tool as AgentTool<unknown>;
}

const stepSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('tool'),
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({ action: z.literal('reply'), text: z.string().min(1) }),
]);

const STEP_HINT =
  '{"action":"tool","tool":"<araç adı>","args":{...}} veya {"action":"reply","text":"<Timurhan\'a cevap>"}';

export interface AgentStep {
  tool: string;
  args: unknown;
  ok: boolean;
  result: unknown;
}

export interface AgentRunResult {
  reply: string;
  steps: AgentStep[];
}

const TOOL_RESULT_LIMIT = 4000;

/**
 * Provider-agnostic agent loop (K-5.1): one JSON protocol that works with any model, an allow-list
 * of tools per agent, and a hard step limit that keeps a turn inside the Workers subrequest budget.
 */
export async function runAgent(opts: {
  llm: LLMService;
  agent: string;
  task: string;
  tier: Tier;
  dataClass: DataClass;
  system: { id: string; version: number; text: string };
  tools: AgentTool<unknown>[];
  history: ChatMessage[];
  input: string;
  maxSteps: number;
}): Promise<AgentRunResult> {
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));
  const toolList = opts.tools
    .map((t) => `- ${t.name}: ${t.description} Argümanlar: ${t.argsHint}`)
    .join('\n');
  const system = `${opts.system.text}\n\nKullanabileceğin araçlar:\n${toolList || '(yok)'}\n\nHer adımda ya bir araç çağır ya da cevap ver.`;

  const messages: ChatMessage[] = [...opts.history, { role: 'user', content: opts.input }];
  const steps: AgentStep[] = [];

  for (let i = 0; i < opts.maxSteps; i++) {
    const last = i === opts.maxSteps - 1;
    const { data } = await opts.llm.generateStructured({
      agent: opts.agent,
      task: opts.task,
      tier: opts.tier,
      dataClass: opts.dataClass,
      promptId: opts.system.id,
      promptVersion: opts.system.version,
      system: last ? `${system}\n\nAraç kullanma hakkın bitti: şimdi yalnızca cevap ver.` : system,
      messages: [...messages],
      schema: stepSchema,
      schemaHint: STEP_HINT,
      noCache: true,
    });

    if (data.action === 'reply') return { reply: data.text, steps };
    if (last) break;

    const tool = toolMap.get(data.tool);
    let step: AgentStep;
    if (!tool) {
      step = {
        tool: data.tool,
        args: data.args,
        ok: false,
        result: `Bilinmeyen araç: ${data.tool}`,
      };
    } else {
      const parsed = tool.args.safeParse(data.args);
      if (!parsed.success) {
        step = {
          tool: tool.name,
          args: data.args,
          ok: false,
          result: `Geçersiz argüman: ${parsed.error.issues[0]?.message ?? ''}`,
        };
      } else {
        try {
          step = {
            tool: tool.name,
            args: parsed.data,
            ok: true,
            result: await tool.run(parsed.data),
          };
        } catch (err) {
          step = {
            tool: tool.name,
            args: parsed.data,
            ok: false,
            result: `Araç hatası: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }
    steps.push(step);
    messages.push(
      { role: 'assistant', content: JSON.stringify(data) },
      {
        role: 'user',
        content: `ARAÇ SONUCU (${step.tool}, ${step.ok ? 'başarılı' : 'hata'}): ${truncate(JSON.stringify(step.result))}`,
      },
    );
  }

  return {
    reply:
      'Bu isteği izin verilen adım sayısı içinde tamamlayamadım. Daha dar bir şekilde sorar mısın?',
    steps,
  };
}

function truncate(s: string | undefined): string {
  if (!s) return 'null';
  return s.length > TOOL_RESULT_LIMIT ? `${s.slice(0, TOOL_RESULT_LIMIT)}…(kısaltıldı)` : s;
}
