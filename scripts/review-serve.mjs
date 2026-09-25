#!/usr/bin/env node
/**
 * Review server for the validator (and humans):
 *
 *   pnpm review:serve   start api :3001 + web :5173 on a fresh throwaway SQLite DB, in the
 *                       background; returns once http://127.0.0.1:5173/api/health is up.
 *   pnpm review:stop    stop it (kills the whole process group — no orphaned watchers).
 *
 * Logs: artifacts/review/server.log  ·  DB: artifacts/review/review.db
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'artifacts/review');
const pidFile = join(dir, 'server.pid');
const logFile = join(dir, 'server.log');
const HEALTH = 'http://127.0.0.1:5173/api/health';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};
const healthy = () =>
  fetch(HEALTH)
    .then((r) => r.ok)
    .catch(() => false);

async function stop() {
  if (!existsSync(pidFile)) return console.log('review server not running');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (alive(pid)) {
    process.kill(-pid, 'SIGTERM');
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(250);
    if (alive(pid)) process.kill(-pid, 'SIGKILL');
  }
  rmSync(pidFile, { force: true });
  console.log('review server stopped');
}

async function start() {
  if (existsSync(pidFile)) await stop();
  if (await healthy()) {
    console.error(`Something else is already serving ${HEALTH} — stop it first (e.g. pnpm dev).`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const log = openSync(logFile, 'a');
  const child = spawn('pnpm', ['dev'], {
    detached: true, // own process group, so review:stop can kill every descendant
    stdio: ['ignore', log, log],
    env: { ...process.env, DATABASE_URL: join(dir, 'review.db'), LOG_LEVEL: 'info' },
  });
  writeFileSync(pidFile, String(child.pid));
  child.unref();

  for (let i = 0; i < 120; i++) {
    if (await healthy()) {
      console.log(`review server ready: http://127.0.0.1:5173 (api :3001)`);
      console.log(`logs: ${logFile}`);
      return;
    }
    if (!alive(child.pid)) break;
    await sleep(500);
  }
  console.error(`review server failed to start — see ${logFile}:\n`);
  console.error(readFileSync(logFile, 'utf8').split('\n').slice(-30).join('\n'));
  await stop();
  process.exit(1);
}

await (process.argv.includes('--stop') ? stop() : start());
