import type { LLMService } from '@papi/core';
import type { KnowledgeHit, Repo } from '@papi/server';

/** Rule before model (K-2.3): cheap keyword search first, vector search only if that finds nothing. */
export async function searchKnowledge(
  repo: Repo,
  llm: LLMService,
  query: string,
  limit = 3,
): Promise<KnowledgeHit[]> {
  const byText = await repo.searchKnowledgeByText(query, limit);
  if (byText.length > 0) return byText;
  try {
    const [embedding] = await llm.embed([query], {
      agent: 'papi',
      task: 'knowledge.search',
      dataClass: 'internal',
    });
    if (!embedding) return [];
    return (await repo.searchKnowledgeByVector(embedding, limit)).filter((h) => h.score > 0.35);
  } catch {
    return [];
  }
}
