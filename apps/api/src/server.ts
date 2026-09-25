import { buildApp } from './app';
import { config } from './config';
import { createDb } from './db/client';

const db = createDb(config.databaseUrl);
const app = await buildApp({ db, logger: { level: config.logLevel } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
