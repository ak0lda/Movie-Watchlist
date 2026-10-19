import { describe, expect, it } from 'vitest';
import { compareTimestamps, isUtcIsoTimestamp } from './timestamp';

describe('isUtcIsoTimestamp', () => {
  it('accepts strict UTC ISO with milliseconds', () => {
    expect(isUtcIsoTimestamp('2026-10-19T12:00:00.000Z')).toBe(true);
  });

  it.each([
    '2026-10-19T12:00:00Z',
    '2026-10-19T12:00:00.000+03:00',
    '2026-10-19 12:00:00.000Z',
    '2026-02-31T12:00:00.000Z',
    '2026-10-19T24:00:00.000Z',
    '',
  ])('rejects %j', (value) => {
    expect(isUtcIsoTimestamp(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isUtcIsoTimestamp(1760875200000)).toBe(false);
    expect(isUtcIsoTimestamp(undefined)).toBe(false);
  });
});

describe('compareTimestamps', () => {
  it('orders by instant', () => {
    expect(
      compareTimestamps('2026-01-01T00:00:00.001Z', '2026-01-01T00:00:00.000Z'),
    ).toBeGreaterThan(0);
    expect(compareTimestamps('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.001Z')).toBeLessThan(
      0,
    );
    expect(compareTimestamps('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(0);
  });
});
