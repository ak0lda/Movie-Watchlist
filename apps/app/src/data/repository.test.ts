import { isUtcIsoTimestamp, type MovieEntry } from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import { T0, createTestServices, makeDetails, makeItem } from '../testing/helpers';
import { EntryNotFoundError } from './repository';

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  let current = T0;
  const { services } = createTestServices({ now: () => current });
  return {
    repo: services.repo,
    setNow: (date: Date) => {
      current = date;
    },
  };
}

function entry(overrides: Partial<MovieEntry> = {}): MovieEntry {
  return {
    id: 'movie:1',
    tmdbId: 1,
    mediaType: 'movie',
    title: 'One',
    originalTitle: 'One',
    overview: '',
    genres: [],
    status: 'want',
    addedAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    deleted: false,
    ...overrides,
  };
}

describe('add', () => {
  it('creates a want-status entry with a deterministic id and UTC timestamps', async () => {
    const { repo } = setup();
    const added = await repo.add(makeItem(), ['Drama']);
    expect(added).toMatchObject({
      id: 'movie:438631',
      status: 'want',
      genres: ['Drama'],
      title: 'Dune',
      year: 2021,
      deleted: false,
    });
    expect(isUtcIsoTimestamp(added.addedAt)).toBe(true);
    expect(added.addedAt).toBe(added.updatedAt);
    expect(await repo.get('movie:438631')).toEqual(added);
  });

  it('is a no-op when the title is already listed', async () => {
    const { repo, setNow } = setup();
    const first = await repo.add(makeItem());
    setNow(new Date(T0.getTime() + DAY));
    expect(await repo.add(makeItem())).toEqual(first);
  });

  it('omits optional metadata that TMDB did not provide', async () => {
    const { repo } = setup();
    const added = await repo.add({
      mediaType: 'movie',
      tmdbId: 5,
      title: 'Bare',
      originalTitle: 'Bare',
      overview: '',
    });
    expect(added).not.toHaveProperty('year');
    expect(added).not.toHaveProperty('posterPath');
    expect(added).not.toHaveProperty('tmdbRating');
  });

  it('revives a tombstone with fresh user fields and a newer updatedAt', async () => {
    const { repo, setNow } = setup();
    await repo.add(makeItem());
    await repo.update('movie:438631', {
      status: 'watched',
      rating: 9,
      note: 'great',
      source: 'Vasya',
    });
    setNow(new Date(T0.getTime() + DAY));
    await repo.remove('movie:438631');
    const tombstone = await repo.get('movie:438631');

    setNow(new Date(T0.getTime() + 2 * DAY));
    const revived = await repo.add(makeItem());
    expect(revived).toMatchObject({ deleted: false, status: 'want' });
    expect(revived).not.toHaveProperty('rating');
    expect(revived).not.toHaveProperty('note');
    expect(revived).not.toHaveProperty('source');
    expect(Date.parse(revived.updatedAt)).toBeGreaterThan(Date.parse(tombstone!.updatedAt));
  });
});

describe('update', () => {
  it('changes fields and advances updatedAt', async () => {
    const { repo, setNow } = setup();
    const added = await repo.add(makeItem());
    setNow(new Date(T0.getTime() + DAY));
    const updated = await repo.update(added.id, {
      status: 'watching',
      rating: 7,
      note: 'so far so good',
      source: 'Vasya',
    });
    expect(updated).toMatchObject({
      status: 'watching',
      rating: 7,
      note: 'so far so good',
      source: 'Vasya',
    });
    expect(Date.parse(updated.updatedAt)).toBe(T0.getTime() + DAY);
    expect(updated.addedAt).toBe(added.addedAt);
  });

  it('clears rating with null and note/source with an empty string', async () => {
    const { repo } = setup();
    const added = await repo.add(makeItem());
    await repo.update(added.id, { rating: 5, note: 'x', source: 'y' });
    const cleared = await repo.update(added.id, { rating: null, note: '  ', source: '' });
    expect(cleared).not.toHaveProperty('rating');
    expect(cleared).not.toHaveProperty('note');
    expect(cleared).not.toHaveProperty('source');
  });

  it.each([0, 11, 5.5, Number.NaN])('rejects rating %s', async (rating) => {
    const { repo } = setup();
    const added = await repo.add(makeItem());
    await expect(repo.update(added.id, { rating })).rejects.toBeInstanceOf(RangeError);
  });

  it('throws EntryNotFoundError for unknown or removed entries', async () => {
    const { repo } = setup();
    await expect(repo.update('movie:404', { status: 'watched' })).rejects.toBeInstanceOf(
      EntryNotFoundError,
    );
    const added = await repo.add(makeItem());
    await repo.remove(added.id);
    await expect(repo.update(added.id, { status: 'watched' })).rejects.toBeInstanceOf(
      EntryNotFoundError,
    );
  });

  it('keeps updatedAt strictly increasing even if the clock goes backwards', async () => {
    const { repo, setNow } = setup();
    const added = await repo.add(makeItem());
    setNow(new Date(T0.getTime() - DAY));
    const updated = await repo.update(added.id, { status: 'watched' });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(added.updatedAt));
  });
});

describe('remove', () => {
  it('turns the entry into a tombstone that stays in getAll', async () => {
    const { repo, setNow } = setup();
    const added = await repo.add(makeItem());
    setNow(new Date(T0.getTime() + DAY));
    await repo.remove(added.id);
    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: added.id, deleted: true });
    expect(Date.parse(all[0]!.updatedAt)).toBe(T0.getTime() + DAY);
  });

  it('ignores unknown ids', async () => {
    const { repo } = setup();
    await expect(repo.remove('movie:404')).resolves.toBeUndefined();
    expect(await repo.getAll()).toEqual([]);
  });
});

describe('completeMetadata', () => {
  it('fills an empty genre list without touching updatedAt', async () => {
    const { repo, setNow } = setup();
    const added = await repo.add(makeItem(), []);
    setNow(new Date(T0.getTime() + DAY));
    await repo.completeMetadata(added.id, makeDetails({ genres: ['Drama'] }));
    const after = await repo.get(added.id);
    expect(after?.genres).toEqual(['Drama']);
    expect(after?.updatedAt).toBe(added.updatedAt);
  });

  it('keeps a complete copy in its original language', async () => {
    const { repo } = setup();
    const added = await repo.add(makeItem(), ['Фантастика']);
    await repo.completeMetadata(added.id, makeDetails({ genres: ['Science Fiction'] }));
    expect((await repo.get(added.id))?.genres).toEqual(['Фантастика']);
  });
});

describe('applyRemote (LocalStore contract)', () => {
  it('inserts unknown remote entries and replaces older local ones', async () => {
    const { repo } = setup();
    await repo.applyRemote(
      [entry({ title: 'Old', updatedAt: new Date(T0.getTime() - DAY).toISOString() })],
      T0,
    );
    await repo.applyRemote(
      [entry({ title: 'New' }), entry({ id: 'movie:2', tmdbId: 2, title: 'Two' })],
      T0,
    );
    const titles = (await repo.getAll()).map((e) => e.title).sort();
    expect(titles).toEqual(['New', 'Two']);
  });

  it('keeps a newer local edit over an older remote entry', async () => {
    const { repo } = setup();
    await repo.applyRemote([entry({ status: 'watched', updatedAt: T0.toISOString() })], T0);
    await repo.applyRemote(
      [entry({ status: 'want', updatedAt: new Date(T0.getTime() - DAY).toISOString() })],
      T0,
    );
    expect((await repo.get('movie:1'))?.status).toBe('watched');
  });

  it('applies a newer remote tombstone', async () => {
    const { repo } = setup();
    await repo.applyRemote([entry({ updatedAt: new Date(T0.getTime() - DAY).toISOString() })], T0);
    await repo.applyRemote([entry({ deleted: true })], T0);
    expect((await repo.get('movie:1'))?.deleted).toBe(true);
  });

  it('purges expired tombstones, local and remote', async () => {
    const { repo } = setup();
    const expired = new Date(T0.getTime() - 91 * DAY).toISOString();
    await repo.applyRemote(
      [entry({ id: 'movie:3', tmdbId: 3, deleted: true, updatedAt: expired })],
      new Date(T0.getTime() - 100 * DAY),
    );
    expect(await repo.getAll()).toHaveLength(1);
    await repo.applyRemote(
      [entry({ id: 'movie:4', tmdbId: 4, deleted: true, updatedAt: expired })],
      T0,
    );
    expect(await repo.getAll()).toEqual([]);
  });
});
