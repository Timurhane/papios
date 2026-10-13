/**
 * Agent and task prompts live here, versioned. Each prompt is identified by id + version so
 * llm_calls can record exactly which prompt produced an output. Prompts arrive in Phase 1.
 */
export interface PromptRef {
  id: string;
  version: number;
}
