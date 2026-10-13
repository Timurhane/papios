import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { playwrightFetcher } from './render.ts';

const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const enabled = Boolean(exe || process.env.RUN_BROWSER_TESTS);

describe.skipIf(!enabled)('playwrightFetcher (real browser)', () => {
  it('reads content that only exists after JavaScript runs', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/iletisim')
        return res.end('<a href="https://wa.me/905321234567">WhatsApp</a>');
      res.end(`<title>JS Klinik</title><div id="app"></div>
        <script>document.getElementById('app').innerHTML = '<a href="/iletisim">İletişim</a><form><input type="email"></form>';</script>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const browser = await chromium.launch(exe ? { executablePath: exe } : {});
    try {
      const site = await playwrightFetcher(browser)(`http://127.0.0.1:${port}/`);
      expect(site?.signals).toMatchObject({
        title: 'JS Klinik',
        hasContactForm: true,
        whatsapp: true,
      });
    } finally {
      await browser.close();
      server.close();
    }
  });
});
