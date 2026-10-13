// Inside the Papi monorepo the schema comes from @papi/modules. When the worker is copied to the client's
// own repo, SETUP.md says to replace this file with a copy of packages/modules/src/config.ts.
export * from '../../../src/config.ts';
