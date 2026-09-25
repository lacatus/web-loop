import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

/** Walks up from this module until it finds the api package root (works from src/ and dist/). */
function packageRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate the api package root');
    dir = parent;
  }
  return dir;
}

export const MIGRATIONS_DIR = join(packageRoot(), 'drizzle');

/**
 * Opens (or creates) a SQLite database and applies all pending migrations.
 * Pass ':memory:' for an isolated throwaway database (used by tests).
 */
export function createDb(url: string): Db {
  if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}
