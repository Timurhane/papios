// Writes <module>/config.schema.json from the zod schema (K-14.1). Run: pnpm --filter @papi/modules gen:schemas
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES } from '../src/catalog.ts';
import { clientConfigJsonSchema } from '../src/config.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = `${JSON.stringify(clientConfigJsonSchema(), null, 2)}\n`;
for (const m of MODULES) writeFileSync(join(root, m.code, 'config.schema.json'), text);
console.log(`wrote config.schema.json for ${MODULES.length} modules`);
