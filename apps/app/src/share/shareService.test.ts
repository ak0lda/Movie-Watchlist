import { describe, expect, it, vi } from 'vitest';
import { parseRoute, routeHref } from '../hooks/useHashRoute';
import {
  MAX_RECEIVED_LENGTH,
  parseShare,
  shareHref,
  startShareHandling,
  type ShareEvent,
  type ShareTargetPlugin,
} from './shareService';

type Listener = (event: ShareEvent) => void;

/** Capacitor semantics: a retained event is delivered when the first listener is added. */
class FakePlugin implements ShareTargetPlugin {
  listeners: Listener[] = [];
  retained: ShareEvent[] = [];
  removed = 0;

  addListener(_event: 'shareReceived', listener: Listener) {
    this.listeners.push(listener);
    const pending = this.retained.splice(0);
    setTimeout(() => pending.forEach((event) => listener(event)), 0);
    return Promise.resolve({
      remove: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        this.removed += 1;
        return Promise.resolve();
      },
    });
  }

  emit(event: ShareEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const searchFor = (query: string) => routeHref({ name: 'search', query });

describe('parseShare', () => {
  it('uses the text when it has a title', () => {
    expect(parseShare({ text: 'Смотри Дюна https://x.example' }).query).toBe('Дюна');
  });

  it('falls back to the subject when the text is only a link (Chrome-style share)', () => {
    const shared = parseShare({
      text: 'https://www.kinopoisk.ru/film/409424/',
      subject: 'Дюна (2021) — смотреть онлайн — Кинопоиск',
    });
    expect(shared.query).toBe('Дюна');
  });

  it('falls back to the title field after text and subject', () => {
    expect(parseShare({ text: 'https://x.example', subject: '', title: 'Dune' }).query).toBe(
      'Dune',
    );
    expect(parseShare({ subject: 'https://x.example', title: 'Parasite' }).query).toBe('Parasite');
  });

  it('prefers the text over the subject when both have a title', () => {
    expect(parseShare({ text: 'Смотри Дюна', subject: 'Другое' }).query).toBe('Дюна');
  });

  it('works with a subject only', () => {
    expect(parseShare({ subject: 'Интерстеллар' }).query).toBe('Интерстеллар');
  });

  it('reports every received field (de-duplicated) when no title is found', () => {
    expect(parseShare({ text: 'https://a.example/1', subject: 'https://a.example/1' })).toEqual({
      query: '',
      received: 'https://a.example/1',
    });
    expect(parseShare({ text: 'https://a.example/1', title: 'https://b.example' }).received).toBe(
      'https://a.example/1 | https://b.example',
    );
  });

  it('truncates what it echoes back', () => {
    const long = parseShare({ text: `https://a.example/${'x'.repeat(1000)}` });
    expect(long.received).toHaveLength(MAX_RECEIVED_LENGTH);
  });

  it.each([
    [undefined],
    [null],
    [42],
    ['Смотри Дюна'],
    [[]],
    [{}],
    [{ text: 5, subject: {}, title: null }],
  ])('finds nothing in the malformed event %j', (event) => {
    expect(parseShare(event)).toEqual({ query: '', received: '' });
  });
});

describe('shareHref', () => {
  it('points at the search with the parsed title', () => {
    expect(shareHref({ text: 'Смотри Дюна https://x.example' })).toBe(searchFor('Дюна'));
    expect(shareHref({ text: 'Check out Dune: Part Two' })).toBe(searchFor('Dune: Part Two'));
  });

  it('uses the subject for link-only shares', () => {
    expect(
      shareHref({ text: 'https://x.example/film/1', subject: 'Дюна (2021) — Кинопоиск' }),
    ).toBe(searchFor('Дюна'));
  });

  it('tells the search screen what was received when there is no title', () => {
    const href = shareHref({ text: 'https://www.imdb.com/title/tt15239678/' });
    expect(href).toBe(
      `#/search?notFound=1&got=${encodeURIComponent('https://www.imdb.com/title/tt15239678/')}`,
    );
    expect(parseRoute(href)).toEqual({
      name: 'search',
      notFound: true,
      received: 'https://www.imdb.com/title/tt15239678/',
    });
  });

  it.each([[undefined], [null], [42], [{}], [{ text: '' }], [{ text: '   ', subject: '\n' }]])(
    'reports "nothing received" for %j',
    (event) => {
      expect(shareHref(event)).toBe('#/search?notFound=1');
      expect(parseRoute(shareHref(event))).toEqual({ name: 'search', notFound: true });
    },
  );

  it('survives special characters in the received text', () => {
    const received = 'https://x.example/?a=1&b=2#frag%20x';
    expect(parseRoute(shareHref({ text: received }))).toMatchObject({ received });
  });
});

describe('startShareHandling', () => {
  it('navigates for every share, in order', async () => {
    const plugin = new FakePlugin();
    const navigate = vi.fn();
    startShareHandling(plugin, navigate);
    await tick();
    plugin.emit({ text: 'Смотри Дюна' });
    plugin.emit({ text: 'Check out Parasite' });
    expect(navigate.mock.calls).toEqual([[searchFor('Дюна')], [searchFor('Parasite')]]);
  });

  it('delivers a share that launched the app (retained until JS subscribes)', async () => {
    const plugin = new FakePlugin();
    plugin.retained.push({ text: 'Рекомендую «Интерстеллар»' });
    const navigate = vi.fn();
    startShareHandling(plugin, navigate);
    expect(navigate).not.toHaveBeenCalled();
    await tick();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(searchFor('Интерстеллар'));
  });

  it('subscribes exactly once and unsubscribes on dispose', async () => {
    const plugin = new FakePlugin();
    const dispose = startShareHandling(plugin, vi.fn());
    await tick();
    expect(plugin.listeners).toHaveLength(1);
    dispose();
    await tick();
    expect(plugin.listeners).toHaveLength(0);
    expect(plugin.removed).toBe(1);
  });

  it('reports a share without a title instead of ignoring it', async () => {
    const plugin = new FakePlugin();
    const navigate = vi.fn();
    startShareHandling(plugin, navigate);
    await tick();
    plugin.emit({ text: 'https://www.imdb.com/title/tt15239678/' });
    expect(navigate).toHaveBeenCalledWith(
      `#/search?notFound=1&got=${encodeURIComponent('https://www.imdb.com/title/tt15239678/')}`,
    );
  });
});

describe('Kinopoisk links', () => {
  const LINK = 'https://www.kinopoisk.ru/film/535341/?socialAlias=MTg2OTg3MDE%3D';

  it('a link-only share becomes a lookup of the Kinopoisk number', () => {
    expect(parseShare({ text: LINK })).toEqual({ query: '', received: LINK, kinopoiskId: 535341 });
    const href = shareHref({ text: LINK });
    expect(href).toBe(`#/search?kp=535341&got=${encodeURIComponent(LINK)}`);
    expect(parseRoute(href)).toEqual({ name: 'search', kinopoiskId: 535341, received: LINK });
  });

  it('series links work too and the link may sit in any field', () => {
    expect(parseShare({ subject: 'https://www.kinopoisk.ru/series/404900/' }).kinopoiskId).toBe(
      404900,
    );
    expect(parseShare({ title: 'https://m.kinopoisk.ru/film/1/' }).kinopoiskId).toBe(1);
  });

  it('a title in the text, subject or title field wins over the lookup', () => {
    expect(shareHref({ text: `Смотри Дюна ${LINK}` })).toBe(searchFor('Дюна'));
    expect(shareHref({ text: LINK, subject: 'Дюна (2021) — Кинопоиск' })).toBe(searchFor('Дюна'));
    expect(parseShare({ text: `Смотри Дюна ${LINK}` }).kinopoiskId).toBeUndefined();
  });

  it('words that only describe the share ("фильм") are not a title', () => {
    const href = shareHref({ text: `Посмотри фильм ${LINK}` });
    expect(href.startsWith('#/search?kp=535341')).toBe(true);
    expect(shareHref({ text: 'Рекомендую сериал' })).toBe(
      '#/search?notFound=1&got=%D0%A0%D0%B5%D0%BA%D0%BE%D0%BC%D0%B5%D0%BD%D0%B4%D1%83%D1%8E%20%D1%81%D0%B5%D1%80%D0%B8%D0%B0%D0%BB',
    );
  });

  it.each([
    ['https://hd.kinopoisk.ru/film/4f4a2e1c8b5d6a7e9c0b1a2d3e4f5a6b'],
    ['https://www.kinopoisk.ru/name/12345/'],
    ['https://evil.example/film/535341/'],
  ])('does not look up %j', (url) => {
    const href = shareHref({ text: url });
    expect(href.startsWith('#/search?notFound=1')).toBe(true);
    expect(parseShare({ text: url }).kinopoiskId).toBeUndefined();
  });
});
