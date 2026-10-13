import { clientConfigSchema } from './config.ts';
import config from '../papi-config.json';
import { handle, pushMetrics, type Env } from './handler.ts';

// The client's configuration is validated at startup; a wrong file fails loudly instead of answering badly.
const cfg = clientConfigSchema.parse(config);

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, { config: cfg, env });
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await pushMetrics({ config: cfg, env });
  },
};
