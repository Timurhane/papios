import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULES } from './catalog.ts';
import { clientConfigJsonSchema } from './config.ts';

const root = join(__dirname, '..');

describe('K-14.1 every module ships README, SETUP, TESTS and an up-to-date config schema', () => {
  for (const m of MODULES)
    it(m.code, () => {
      for (const f of ['README.md', 'SETUP.md', 'TESTS.md'])
        expect(existsSync(join(root, m.code, f)), `${m.code}/${f}`).toBe(true);
      const schema = JSON.parse(readFileSync(join(root, m.code, 'config.schema.json'), 'utf8'));
      // run `pnpm --filter @papi/modules gen:schemas` after changing src/config.ts
      expect(schema).toEqual(clientConfigJsonSchema());
    });

  it('the reference implementation exists for cevap asistanı (K-14.3)', () => {
    expect(MODULES.filter((m) => m.reference).map((m) => m.code)).toEqual(['cevap-asistani']);
    expect(existsSync(join(root, 'cevap-asistani/worker/src/worker.ts'))).toBe(true);
  });
});
