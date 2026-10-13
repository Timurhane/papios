import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'jobs',
    environment: 'node',
    testTimeout: 30_000,
  },
});
