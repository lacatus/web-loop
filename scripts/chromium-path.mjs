import { existsSync } from 'node:fs';

/**
 * Resolves a pre-installed Chromium to use instead of Playwright's bundled download.
 * Order: $PLAYWRIGHT_CHROMIUM_EXECUTABLE, then known container locations.
 * Returns undefined when none is found, so Playwright falls back to its own browser
 * (e.g. in CI after `playwright install chromium`).
 */
export function chromiumExecutable() {
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/opt/pw-browsers/chromium'];
  return candidates.find((p) => p && existsSync(p));
}
