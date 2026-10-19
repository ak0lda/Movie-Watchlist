import type { MovieEntry } from './types';

/** Plain object with keys in code-unit order and `undefined` values dropped. */
export function canonicalObject(entry: MovieEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(entry).sort()) {
    const value = (entry as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Canonical serialization: used for the merge tie-break and for equality checks. */
export function canonicalize(entry: MovieEntry): string {
  return JSON.stringify(canonicalObject(entry));
}

export function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
