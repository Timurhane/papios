import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderSettingsSeed } from '../src/settings/seed-sql.ts';

const target = fileURLToPath(new URL('../../../supabase/seed/20_settings.sql', import.meta.url));
writeFileSync(target, renderSettingsSeed());
console.log(`wrote ${target}`);
