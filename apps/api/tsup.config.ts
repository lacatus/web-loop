import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  // The shared contract ships as TS source, so it must be bundled in.
  noExternal: ['@web-loop/shared'],
});
