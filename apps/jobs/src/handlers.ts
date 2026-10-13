import { fetchSite, JobRegistry, type FetchedSite, type LLMService } from '@papi/core';
import {
  analyzeCompanies,
  applySiteScan,
  formatOutcome,
  geocodeCompanies,
  groundedSearch,
  intelDigest,
  newsScan,
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
  /** Injected in tests (Nominatim's 1 request/second pause). */
  sleep?: (ms: number) => Promise<void>;
}

const BATCH = 10;
/** Nominatim at 1 req/s (K-3.18): one run geocodes at most this many companies. */
const GEOCODE_PER_RUN = 60;
/** Overpass etiquette: at most this many area × sector queries per weekly run. */
const OSM_PAIRS_PER_RUN = 6;

interface OsmCoverage {
  covered: string[];
  cursor: number;
}

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

  const queueGeocode = () => repo.enqueue('geo.geocode', {}, { heavy: true, unique: true });

  return (
    new JobRegistry()
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
        await queueGeocode();
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
        await queueGeocode();
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
      })
      // K-8.11 (a): weekly rescan of high-score sites; changes become signals.
      .register('signals.site_scan', async (job) => {
        const { limit } = z.object({ limit: z.number().int().min(1).max(100) }).parse(job.payload);
        const s = await repo.getSettings();
        const fetcher = bestEffortFetcher(deps);
        const found: string[] = [];
        for (const c of await repo.companiesForSignalScan(s.intelligence.signal_min_score, limit)) {
          if (!c.website_url) continue;
          const site = await fetcher(c.website_url).catch(() => null);
          if (!site) continue;
          for (const d of await applySiteScan({ repo }, c, site.signals))
            found.push(`• ${c.name}: ${d}`);
        }
        await queueGeocode();
        if (found.length)
          await tell(deps, ['📡 Site değişiklikleri:', ...found.slice(0, 20)].join('\n'));
      })
      // K-8.11 (b): grounded news for at most `limit` top companies a week.
      .register('signals.news', async (job) => {
        const { limit } = z.object({ limit: z.number().int().min(1).max(20) }).parse(job.payload);
        const s = await repo.getSettings();
        const found: string[] = [];
        for (const c of await repo.topCompanies(s.intelligence.signal_min_score, limit)) {
          const items = await newsScan({ repo, llm }, c).catch(() => []);
          for (const d of items) found.push(`• ${c.name}: ${d}`);
        }
        if (found.length)
          await tell(deps, ['📰 Haber sinyalleri:', ...found.slice(0, 20)].join('\n'));
      })
      // K-8.11 (c): businesses that appear in OSM after an area × sector was first covered are new openings.
      .register('signals.osm_new', async () => {
        const s = await repo.getSettings();
        const pairs = s.night_shift.areas.flatMap((a) =>
          s.night_shift.sectors.map((sec) => `${a}|${sec}`),
        );
        if (!pairs.length) return;
        const cov = (await repo.getState<OsmCoverage>('osm_coverage')) ?? {
          covered: [],
          cursor: 0,
        };
        const covered = new Set(cov.covered);
        const fresh: string[] = [];
        const n = Math.min(OSM_PAIRS_PER_RUN, pairs.length);
        for (let i = 0; i < n; i++) {
          const pair = pairs[(cov.cursor + i) % pairs.length] as string;
          const [area = '', sector = ''] = pair.split('|');
          const summary = await osmSearch(
            { repo, llm, ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}) },
            area,
            [sector],
          );
          await queueAnalysis(summary.created);
          if (covered.has(pair)) {
            for (const id of summary.created) {
              await repo.addSignal({
                companyId: id,
                kind: 'new_opening',
                description: "OpenStreetMap'te yeni görünen işletme",
                fingerprint: 'osm-new',
              });
              const c = await repo.getCompany(id);
              if (c) fresh.push(`• ${c.name} (${area})`);
            }
          }
          covered.add(pair);
        }
        await repo.setState('osm_coverage', {
          covered: [...covered],
          cursor: (cov.cursor + n) % pairs.length,
        } satisfies OsmCoverage);
        await queueGeocode();
        if (fresh.length)
          await tell(deps, ['🆕 Yeni açılan işletmeler:', ...fresh.slice(0, 20)].join('\n'));
      })
      .register('intel.competitors', async () => {
        await tell(deps, await intelDigest({ repo, llm }, 'competitors'));
      })
      .register('intel.sector_news', async () => {
        await tell(deps, await intelDigest({ repo, llm }, 'sector'));
      })
      // K-3.18: Nominatim, 1 request/second, cached; the map shows OSM attribution.
      .register('geo.geocode', async () => {
        const r = await geocodeCompanies(
          { repo },
          GEOCODE_PER_RUN,
          deps.fetchFn ?? fetch,
          deps.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms))),
        );
        // a running job blocks a unique enqueue of its own type, so the follow-up is a plain one
        if (r.found + r.missing === GEOCODE_PER_RUN)
          await repo.enqueue('geo.geocode', {}, { heavy: true });
      })
  );
}
