import {
  fetchPageSpeed,
  fetchSite,
  QuotaExhaustedError,
  scoreCompany,
  summarizeBatch,
  type FetchedSite,
  type LLMService,
  type PageSpeedResult,
  type SiteSignals,
  type SummaryOutput,
} from '@papi/core';
import type { CompanyRow, Repo } from '../repo/types.ts';

export type SiteFetcher = (url: string) => Promise<FetchedSite | null>;

export interface AnalistDeps {
  repo: Repo;
  llm: LLMService;
  fetchFn?: typeof fetch;
  pageSpeedKey?: string;
  /** Defaults to plain HTTP; the Actions worker passes a Playwright renderer for deep crawls. */
  siteFetcher?: SiteFetcher;
  now?: () => Date;
}

export interface AnalysisOutcome {
  companyId: string;
  name: string;
  status: 'ok' | 'partial' | 'failed';
  score: number | null;
  playbook: 'soguk_ana' | 'hafif_soguk' | null;
  strongestFinding: string | null;
  findings: string[];
  rationale: string[];
  /** The site could not be read over plain HTTP; a Playwright crawl is queued. */
  needsDeepCrawl: boolean;
  /** Raw checks, for the analysis tool report (K-12.3). */
  checks?: {
    site: SiteSignals | null;
    mobile: PageSpeedResult | null;
    desktop: PageSpeedResult | null;
  };
}

const SUMMARY_BATCH = 5;
const WAITLIST_DAYS = 90;
const DAY = 86_400_000;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Analist (K-9): code checks → one model call per batch (K-4.6) → score → next step (K-2.5, K-9.4).
 * Persists the analysis, score history, timeline, contacts and company memory.
 */
export async function analyzeCompanies(
  deps: AnalistDeps,
  companies: CompanyRow[],
  kind: 'light' | 'deep' = 'light',
): Promise<AnalysisOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const settings = await deps.repo.getSettings();
  const fetcher: SiteFetcher = deps.siteFetcher ?? ((u) => fetchSite(u, deps.fetchFn ?? fetch));

  for (const c of companies) await deps.repo.updateCompany(c.id, { stage: 'analyzing' });

  // 1) Code checks, in parallel per company.
  const gathered = await Promise.all(
    companies.map(async (c) => {
      const url = c.website_url ?? (c.domain ? `https://${c.domain}/` : null);
      const site = url ? await fetcher(url) : null;
      const [mobile, desktop] = site
        ? await Promise.all([
            fetchPageSpeed(site.finalUrl, 'mobile', deps.pageSpeedKey, deps.fetchFn ?? fetch),
            fetchPageSpeed(site.finalUrl, 'desktop', deps.pageSpeedKey, deps.fetchFn ?? fetch),
          ])
        : [null, null];
      return { c, url, site, mobile, desktop };
    }),
  );

  // 2) One model call per batch; a quota problem degrades to a rules-only analysis.
  const summaries = new Map<string, SummaryOutput>();
  let summaryError: string | null = null;
  for (let i = 0; i < gathered.length; i += SUMMARY_BATCH) {
    const batch = gathered.slice(i, i + SUMMARY_BATCH).filter((g) => g.site || !g.url);
    try {
      const out = await summarizeBatch(
        deps.llm,
        batch.map((g) => ({
          id: g.c.id,
          name: g.c.name,
          signals: g.site?.signals ?? null,
          mobile: g.mobile,
          knownSector: g.c.sector,
          knownCity: g.c.city,
        })),
      );
      for (const [id, s] of out) summaries.set(id, s);
    } catch (err) {
      summaryError =
        err instanceof QuotaExhaustedError
          ? 'Yapay zeka kotası dolu; özet sonra eklenecek'
          : err instanceof Error
            ? err.message
            : String(err);
    }
  }

  // 3) Score and persist.
  const outcomes: AnalysisOutcome[] = [];
  for (const g of gathered) {
    const { c } = g;
    if (g.url && !g.site && kind === 'light') {
      await deps.repo.addAnalysis({
        companyId: c.id,
        kind,
        status: 'failed',
        signals: {},
        pagespeed: null,
        findings: [],
        strongestFinding: null,
        error: 'site could not be fetched over HTTP',
      });
      await deps.repo.updateCompany(c.id, {
        stage: 'new',
        next_step_kind: 'waiting',
        waiting_reason: 'Site düz istekle okunamadı; derin tarama (Playwright) bekliyor',
        waiting_until: isoDate(new Date(now.getTime() + DAY)),
      });
      await deps.repo.enqueue('analysis.deep_crawl', { companyId: c.id }, { heavy: true });
      await deps.repo.addCompanyEvent(
        c.id,
        'analysis_deferred',
        'Site okunamadı, derin taramaya alındı',
      );
      outcomes.push({
        companyId: c.id,
        name: c.name,
        status: 'failed',
        score: null,
        playbook: null,
        strongestFinding: null,
        findings: [],
        rationale: [],
        needsDeepCrawl: true,
      });
      continue;
    }

    const summary = summaries.get(c.id) ?? null;
    const scored = scoreCompany({
      name: c.name,
      knownSector: c.sector,
      knownCity: c.city,
      address: c.address,
      knownPhone: c.phone_e164,
      knownEmail: c.emails[0] ?? null,
      instagram: c.instagram_handle,
      site: g.site?.signals ?? null,
      mobile: g.mobile,
      summary,
      activeSignals: await deps.repo.activeSignals(c.id),
      settings,
      now,
    });
    const status: AnalysisOutcome['status'] = summary ? 'ok' : 'partial';
    const findings = summary?.findings ?? [];
    const strongest = summary?.strongest_finding ?? null;

    await deps.repo.addAnalysis({
      companyId: c.id,
      kind,
      status,
      signals: g.site?.signals ?? { site: null },
      pagespeed: { mobile: g.mobile, desktop: g.desktop } satisfies {
        mobile: PageSpeedResult | null;
        desktop: PageSpeedResult | null;
      },
      findings,
      strongestFinding: strongest,
      error: summary ? null : summaryError,
    });
    await deps.repo.addScore(c.id, {
      total: scored.score.total,
      fit: scored.score.fit,
      pain: scored.score.pain,
      reach: scored.score.reach,
      rationale: scored.score.rationale,
    });

    const firstPhone = scored.contacts.phones[0] ?? null;
    const nextStep = scored.playbook
      ? {
          stage: 'analyzed' as const,
          next_step_kind: 'playbook' as const,
          assigned_playbook: scored.playbook,
          waiting_reason: null,
          waiting_until: null,
        }
      : {
          stage: 'waitlist' as const,
          next_step_kind: 'waiting' as const,
          assigned_playbook: null,
          waiting_reason: 'Puan eşiğin altında; yeni sinyal gelirse yeniden puanlanacak',
          waiting_until: isoDate(new Date(now.getTime() + WAITLIST_DAYS * DAY)),
        };
    await deps.repo.updateCompany(c.id, {
      ...nextStep,
      verified: Boolean(g.site),
      sector: scored.sector,
      sector_source: scored.sectorSource,
      city: scored.city,
      website_url: g.site?.finalUrl ?? c.website_url,
      phone_e164:
        c.phone_e164 ??
        (firstPhone && !(await phoneTaken(deps.repo, firstPhone, c.id)) ? firstPhone : null),
      emails: [...new Set([...c.emails, ...scored.contacts.emails])].slice(0, 5),
      instagram_handle: c.instagram_handle ?? g.site?.signals.socials.instagram ?? null,
      score: scored.score.total,
      score_fit: scored.score.fit,
      score_pain: scored.score.pain,
      score_reach: scored.score.reach,
      score_rationale: scored.score.rationale,
      last_analyzed_at: now.toISOString(),
    });
    for (const name of scored.contacts.decisionMakers.slice(0, 2)) {
      await deps.repo.addContact(c.id, {
        full_name: name,
        is_decision_maker: true,
        source: 'website',
      });
    }
    if (strongest) await deps.repo.addMemory(c.id, 'analysis', [strongest, ...findings].join('\n'));
    await deps.repo.addCompanyEvent(
      c.id,
      'analyzed',
      `Puan ${scored.score.total} → ${scored.playbook === 'soguk_ana' ? 'Soğuk Ana' : scored.playbook === 'hafif_soguk' ? 'Hafif Soğuk' : 'bekleme listesi'}`,
      { kind, status },
    );
    outcomes.push({
      companyId: c.id,
      name: c.name,
      status,
      score: scored.score.total,
      playbook: scored.playbook,
      strongestFinding: strongest,
      findings,
      rationale: scored.score.rationale,
      needsDeepCrawl: false,
      checks: { site: g.site?.signals ?? null, mobile: g.mobile, desktop: g.desktop },
    });
  }
  return outcomes;
}

async function phoneTaken(repo: Repo, phone: string, selfId: string): Promise<boolean> {
  const other = await repo.findCompany({
    domain: null,
    phone,
    instagram: null,
    nameNorm: '',
    city: null,
  });
  return Boolean(other && other.id !== selfId);
}

/** Telegram card for an analysed company (Turkish). */
export function formatOutcome(o: AnalysisOutcome, panelUrl?: string): string {
  if (o.needsDeepCrawl) {
    return `🔎 ${o.name}\nSite düz istekle okunamadı; derin taramaya aldım. Sonucu birazdan bildireceğim.`;
  }
  const next =
    o.playbook === 'soguk_ana'
      ? 'Soğuk Ana'
      : o.playbook === 'hafif_soguk'
        ? 'Hafif Soğuk'
        : 'Bekleme listesi';
  const lines = [
    `🏷️ ${o.name} — ${o.score}/100 → ${next}`,
    o.strongestFinding ? `\n💡 ${o.strongestFinding}` : null,
    o.findings.length ? `\n${o.findings.map((f) => `• ${f}`).join('\n')}` : null,
    `\nPuan gerekçesi:\n${o.rationale
      .slice(0, 6)
      .map((r) => `· ${r}`)
      .join('\n')}`,
    o.status === 'partial' ? '\n(Yapay zeka özeti şimdilik eksik; kurallarla puanlandı.)' : null,
    panelUrl ? `\n${panelUrl.replace(/\/$/, '')}/crm/${o.companyId}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
