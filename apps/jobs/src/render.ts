import {
  extractSignals,
  mergeSignals,
  USER_AGENT,
  type FetchedSite,
  type SiteSignals,
} from '@papi/core';
import type { Browser } from 'playwright';

/** Deep crawl with a real browser (K-3.6): for JavaScript-built sites that plain HTTP cannot read. */
export function playwrightFetcher(browser: Browser) {
  return async (url: string): Promise<FetchedSite | null> => {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'tr-TR',
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (!res || res.status() >= 400) return null;
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      const finalUrl = page.url();
      const home = extractSignals(await page.content(), finalUrl);
      let contact: SiteSignals | null = null;
      if (home.contactPageUrl && home.contactPageUrl !== finalUrl) {
        const r = await page
          .goto(home.contactPageUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          .catch(() => null);
        if (r && r.status() < 400) contact = extractSignals(await page.content(), page.url());
      }
      return { finalUrl, signals: mergeSignals(home, contact) };
    } catch {
      return null;
    } finally {
      await context.close();
    }
  };
}
