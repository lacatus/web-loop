import { describe, expect, it } from 'vitest';
import { renderStatusLine, statusLineFromStdin } from '../src/statusline';

const FULL = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  effort: 'high',
  context_window: {
    used_percentage: 42.2,
    current_usage: {
      input_tokens: 40,
      cache_read_input_tokens: 910,
      cache_creation_input_tokens: 50,
    },
  },
  prompt_cache: { ttl: '1h' },
  cost: { total_cost_usd: 1.2345 },
};

const noJunk = (line: string) => {
  expect(line).not.toMatch(/undefined|NaN|null/);
  expect(line).not.toMatch(/·\s*·/); // no empty separators
  expect(line).not.toMatch(/^\s*·|·\s*$/);
};

describe('status line', () => {
  it('Scenario: Status line renders session data — one line with model, effort, context, cache and list-price estimate', () => {
    const line = renderStatusLine(FULL);
    expect(line).toBe('Opus · high · ctx 42% · cache 91% · ~$1.23 list');
    expect(line.split('\n')).toHaveLength(1);
    // effort may also arrive as an object
    expect(renderStatusLine({ ...FULL, effort: { level: 'medium' } })).toBe(
      'Opus · medium · ctx 42% · cache 91% · ~$1.23 list',
    );
    // stdin path used by settings.json → statusLine
    expect(statusLineFromStdin(JSON.stringify(FULL))).toBe(line);
  });

  it('Scenario: Missing fields are omitted — no "undefined", "NaN" or empty separators', () => {
    const withoutCostAndCache = {
      model: { display_name: 'Sonnet' },
      effort: 'high',
      context_window: { used_percentage: 7 },
    };
    const line = renderStatusLine(withoutCostAndCache);
    expect(line).toBe('Sonnet · high · ctx 7%');
    noJunk(line);

    // Zero-token usage cannot yield a percentage; non-numeric values are dropped.
    const odd = renderStatusLine({
      model: { display_name: 'Opus' },
      context_window: {
        used_percentage: 'n/a',
        current_usage: { input_tokens: 0, cache_read_input_tokens: 0 },
      },
      cost: { total_cost_usd: null },
    });
    expect(odd).toBe('Opus');
    noJunk(odd);

    // A numeric prompt_cache rate is used when current_usage is absent.
    expect(
      renderStatusLine({ model: { display_name: 'Opus' }, prompt_cache: { hit_rate: 0.5 } }),
    ).toBe('Opus · cache 50%');
    expect(renderStatusLine({})).toBe('');
    expect(statusLineFromStdin('not json')).toBe('');
  });
});
