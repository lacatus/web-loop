import { resolve } from 'node:path';

/** Repository root (this file lives in packages/loop-tools/src). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Where CLI output goes; injectable so tests can capture it. */
export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const processIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** Collects output lines in memory (tests). */
export function memoryIo(): Io & { stdout: string[]; stderr: string[]; text: () => string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    text: () => [...stdout, ...stderr].join('\n'),
  };
}

/** Renders rows as a left-aligned plain-text table. */
export function textTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)];
}

/** Renders rows as a GitHub-flavoured markdown table. */
export function markdownTable(header: string[], rows: string[][]): string[] {
  const esc = (c: string) => c.replace(/\|/g, '\\|');
  return [
    `| ${header.map(esc).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ];
}
