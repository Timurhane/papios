export interface PageSpeedResult {
  strategy: 'mobile' | 'desktop';
  performance: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
}

const FIELDS =
  'lighthouseResult(categories/performance/score,audits/largest-contentful-paint/numericValue,audits/total-blocking-time/numericValue,audits/cumulative-layout-shift/numericValue)';

/** PSI request URL asking only for the fields we use, which keeps the response tiny (Workers CPU). */
export function pageSpeedUrl(
  target: string,
  strategy: 'mobile' | 'desktop',
  apiKey?: string,
): string {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', target);
  u.searchParams.set('strategy', strategy);
  u.searchParams.set('category', 'performance');
  u.searchParams.set('fields', FIELDS);
  if (apiKey) u.searchParams.set('key', apiKey);
  return u.toString();
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number }>;
  };
}

export function parsePageSpeed(json: unknown, strategy: 'mobile' | 'desktop'): PageSpeedResult {
  const lr = (json as PsiResponse).lighthouseResult;
  const score = lr?.categories?.performance?.score;
  const audit = (k: string) => lr?.audits?.[k]?.numericValue ?? null;
  return {
    strategy,
    performance: typeof score === 'number' ? Math.round(score * 100) : null,
    lcpMs: audit('largest-contentful-paint'),
    tbtMs: audit('total-blocking-time'),
    cls: audit('cumulative-layout-shift'),
  };
}
