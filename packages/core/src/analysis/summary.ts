import { analistSummary } from '@papi/prompts';
import { z } from 'zod';
import type { LLMService } from '../llm/service.ts';
import type { SiteSignals } from './html.ts';
import type { PageSpeedResult } from './pagespeed.ts';

export interface SummaryInput {
  id: string;
  name: string;
  signals: SiteSignals | null;
  mobile: PageSpeedResult | null;
  knownSector: string | null;
  knownCity: string | null;
}

const itemSchema = z.object({
  id: z.string(),
  sector: z.string().min(2).max(60).nullable(),
  city: z.string().min(2).max(40).nullable(),
  findings: z.array(z.string().min(10).max(300)).length(3),
  strongest_finding: z.string().min(10).max(300),
});
const batchSchema = z.object({ results: z.array(itemSchema) });
export type SummaryOutput = z.infer<typeof itemSchema>;

const HINT =
  '{"results":[{"id":"<verilen id>","sector":"<kısa sektör adı veya null>","city":"<il veya null>","findings":["...","...","..."],"strongest_finding":"..."}]}';

/** Compact, public-only facts for the model: no raw HTML, no personal names (K-4.7). */
function facts(i: SummaryInput) {
  const s = i.signals;
  return {
    id: i.id,
    name: i.name,
    known_sector: i.knownSector,
    known_city: i.knownCity,
    site: s
      ? {
          title: s.title,
          description: s.description,
          https: s.https,
          mobile_speed: i.mobile?.performance ?? null,
          whatsapp: s.whatsapp,
          online_booking: s.booking,
          online_order: s.onlineOrder,
          contact_form: s.hasContactForm,
          chat_widget: Boolean(s.chatWidget),
          social: Object.keys(s.socials),
          last_copyright_year: s.copyrightYear,
          branches: s.branches,
          text_excerpt: s.textSample.slice(0, 1200),
        }
      : 'Web sitesi yok veya açılmadı',
  };
}

/** One model call for several companies (K-4.6). Missing items are simply absent from the map. */
export async function summarizeBatch(
  llm: LLMService,
  items: SummaryInput[],
): Promise<Map<string, SummaryOutput>> {
  if (items.length === 0) return new Map();
  const { data } = await llm.generateStructured({
    agent: 'analist',
    task: 'analysis.summary',
    tier: 'medium',
    dataClass: 'public',
    promptId: analistSummary.id,
    promptVersion: analistSummary.version,
    system: analistSummary.text,
    messages: [{ role: 'user', content: JSON.stringify(items.map(facts)) }],
    schema: batchSchema,
    schemaHint: HINT,
  });
  const wanted = new Set(items.map((i) => i.id));
  return new Map(data.results.filter((r) => wanted.has(r.id)).map((r) => [r.id, r]));
}
