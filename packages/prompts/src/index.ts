/**
 * Agent and task prompts, versioned. Each prompt is identified by id + version so llm_calls can
 * record exactly which prompt produced an output. Bump `version` whenever the text changes.
 */
export interface Prompt {
  id: string;
  version: number;
  text: string;
}

export { papiSystem } from './papi/system.ts';
export { approvalRevise } from './papi/approval-revise.ts';
