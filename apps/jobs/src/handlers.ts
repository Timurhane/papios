import { fetchSite, JobRegistry, type FetchedSite, type LLMService } from '@papi/core';
import {
  analyzeCompanies,
  formatOutcome,
  groundedSearch,
  importRows,
  osmSearch,
  type ImportSummary,
  type InstagramDiscovery,
  type Repo,
  type SiteFetcher,
  type TelegramApi,
} from '@papi/server';
import { z } from 'zod';

export interface HeavyDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi | null;
  ownerChatId: number | null;
  /** Playwright renderer; null when no browser is available. */
  render: SiteFetcher | null;
  fetchFn?: typeof fetch;
  pageSpeedKey?: string;
  panelUrl?: string;
  instagram?: InstagramDiscovery | null;
}

const BATCH = 10;

const rowSchema = z.object({
  name: z.string(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  address: z.string().optional(),
  instagram: z.string().optional(),
  sector: z.string().optional(),
});

/** HTTP first (cheap); Playwright only when plain HTTP fails. */
function bestEffortFetcher(deps: HeavyDeps): SiteFetcher {
  return async (url) => {
    const plain: FetchedSite | null = await fetchSite(url, deps.fetchFn ?? fetch).catch(() => null);
    if (plain) return plain;
    return deps.render ? deps.render(url) : null;
  };
}

async function tell(deps: HeavyDeps, text: string) {
  if (deps.tg && deps.ownerChatId) await deps.tg.sendMessage(deps.ownerChatId, text);
}

function importMessage(what: string, s: ImportSummary) {
  return `📥 ${what}: ${s.created.length} yeni firma, ${s.duplicates} zaten kayıtlı${s.invalid ? `, ${s.invalid} geçersiz satır` : ''}. Analizleri sıraya aldım.`;
}

export function buildHeavyRegistry(deps: HeavyDeps): JobRegistry {
  const { repo, llm } = deps;
  const analist = {
    repo,
    llm,
    pageSpeedKey: deps.pageSpeedKey,
    siteFetcher: bestEffortFetcher(deps),
  };

  const queueAnalysis = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += BATCH)
      await repo.enqueue(
        'analysis.batch',
        { companyIds: ids.slice(i, i + BATCH) },
        { heavy: true },
      );
  };

  return new JobRegistry()
    .register('analysis.deep_crawl', async (job) => {
      const company = await repo.getCompany(String(job.payload.companyId ?? ''));
      if (!company) return;
      const fetcher: SiteFetcher = deps.render ?? (() => Promise.resolve(null));
      const [o] = await analyzeCompanies({ ...analist, siteFetcher: fetcher }, [company], 'deep');
      if (!o) return;
      if (o.needsDeepCrawl || o.status === 'failed') {
        // Even a browser could not open it: score it as "no working website" so it still has a next step.
        const [fallback] = await analyzeCompanies(
          { ...analist, siteFetcher: async () => null },
          [{ ...company, website_url: null, domain: null }],
          'deep',
        );
        if (fallback) await tell(deps, formatOutcome(fallback, deps.panelUrl));
        return;
      }
      await tell(deps, formatOutcome(o, deps.panelUrl));
    })
    .register('analysis.batch', async (job) => {
      const ids = z.array(z.string()).optional().parse(job.payload.companyIds);
      const companies = ids
        ? (await Promise.all(ids.map((id) => repo.getCompany(id)))).filter((c) => c !== null)
        : await repo.companiesAwaitingAnalysis(BATCH);
      if (companies.length === 0) return;
      const outcomes = await analyzeCompanies({ ...analist }, companies, 'deep');
      const good = outcomes.filter((o) => o.playbook).length;
      await tell(
        deps,
        `📊 ${outcomes.length} firma analiz edildi: ${good} tanesi playbook'a uygun, ${outcomes.length - good} tanesi bekleme listesinde.`,
      );
    })
    .register('kasif.csv_import', async (job) => {
      const rows = z.array(rowSchema).parse(job.payload.rows);
      const summary = await importRows(repo, rows, 'csv');
      await queueAnalysis(summary.created);
      await tell(deps, importMessage('CSV içe aktarma', summary));
    })
    .register('kasif.osm_search', async (job) => {
      const { area, sectors } = z
        .object({ area: z.string(), sectors: z.array(z.string()) })
        .parse(job.payload);
      const summary = await osmSearch(
        { repo, llm, ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}) },
        area,
        sectors,
      );
      await queueAnalysis(summary.created);
      await tell(deps, importMessage(`OpenStreetMap (${area})`, summary));
    })
    .register('kasif.grounded_search', async (job) => {
      const { query } = z.object({ query: z.string() }).parse(job.payload);
      const summary = await groundedSearch(
        { repo, llm, ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}) },
        query,
      );
      await queueAnalysis(summary.created);
      await tell(deps, importMessage(`Web araması "${query}"`, summary));
    });
}
