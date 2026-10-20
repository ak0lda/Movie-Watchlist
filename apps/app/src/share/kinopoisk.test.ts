import {
  NetworkError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import {
  KINOPOISK_API_BASE_URL,
  KinopoiskError,
  createKinopoiskResolver,
  extractKinopoiskId,
  pickTitle,
} from './kinopoisk';

describe('extractKinopoiskId', () => {
  it.each([
    ['https://www.kinopoisk.ru/film/535341/?socialAlias=MTg2OTg3MDE%3D', 535341],
    ['https://www.kinopoisk.ru/film/535341/', 535341],
    ['https://www.kinopoisk.ru/film/535341', 535341],
    ['https://kinopoisk.ru/film/409424/', 409424],
    ['https://m.kinopoisk.ru/film/409424/', 409424],
    ['http://www.kinopoisk.ru/series/404900/', 404900],
    ['www.kinopoisk.ru/film/1/', 1],
    ['https://www.kinopoisk.ru/level/1/film/535341/', 535341],
    ['https://www.kinopoisk.ru/film/535341/cast/', 535341],
    ['Смотри Дюна https://www.kinopoisk.ru/film/409424/ круто', 409424],
    ['(https://www.kinopoisk.ru/film/409424/).', 409424],
    ['<https://www.kinopoisk.ru/film/409424/>', 409424],
    ['HTTPS://WWW.KINOPOISK.RU/FILM/409424/'.toLowerCase(), 409424],
  ])('%j -> %j', (text, id) => {
    expect(extractKinopoiskId([text])).toBe(id);
  });

  it.each([
    ['https://hd.kinopoisk.ru/film/4f4a2e1c8b5d6a7e9c0b1a2d3e4f5a6b'],
    ['https://www.kinopoisk.ru/name/12345/'],
    ['https://www.kinopoisk.ru/lists/movies/top250/'],
    ['https://www.kinopoisk.ru/film/abc/'],
    ['https://www.kinopoisk.ru/film/0/'],
    ['https://www.kinopoisk.ru/film/12345678901/'],
    ['https://evil.example/film/535341/'],
    ['https://kinopoisk.ru.evil.example/film/535341/'],
    ['https://notkinopoisk.ru/film/535341/'],
    ['https://www.imdb.com/title/tt15239678/'],
    ['film/535341'],
    ['kinopoisk.ru/film/535341'],
    [''],
  ])('ignores %j', (text) => {
    expect(extractKinopoiskId([text])).toBeNull();
  });

  it('takes the first link that has a number and looks through all texts', () => {
    expect(
      extractKinopoiskId([
        'no links',
        'https://www.kinopoisk.ru/film/2/ https://www.kinopoisk.ru/film/3/',
      ]),
    ).toBe(2);
    expect(
      extractKinopoiskId([
        'https://www.kinopoisk.ru/name/1/',
        'https://www.kinopoisk.ru/series/9/',
      ]),
    ).toBe(9);
  });

  it('does not choke on huge or hostile input', () => {
    const started = Date.now();
    expect(extractKinopoiskId(['https://'.repeat(5000)])).toBeNull();
    expect(extractKinopoiskId(['a'.repeat(100_000)])).toBeNull();
    expect(extractKinopoiskId(['www.'.repeat(20_000)])).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('pickTitle', () => {
  const film = { nameRu: 'Дюна', nameEn: 'Dune EN', nameOriginal: 'Dune' };

  it('prefers the original title: it is what TMDB matches best ("Intouchables", not "1+1")', () => {
    expect(pickTitle({ nameRu: '1+1', nameEn: null, nameOriginal: 'Intouchables' }, 'ru')).toBe(
      'Intouchables',
    );
    expect(pickTitle(film, 'ru')).toBe('Dune');
    expect(pickTitle(film, 'en')).toBe('Dune');
  });

  it('without an original title, the UI language decides: Russian vs English', () => {
    const noOriginal = { nameRu: 'Дюна', nameEn: 'Dune EN' };
    expect(pickTitle(noOriginal, 'ru')).toBe('Дюна');
    expect(pickTitle(noOriginal, 'en')).toBe('Dune EN');
    expect(pickTitle(noOriginal, 'de')).toBe('Dune EN');
  });

  it('falls back through the other names', () => {
    expect(pickTitle({ nameRu: null, nameEn: '', nameOriginal: 'Dune' }, 'ru')).toBe('Dune');
    expect(pickTitle({ nameRu: null, nameEn: 'Dune EN', nameOriginal: ' ' }, 'ru')).toBe('Dune EN');
    expect(pickTitle({ nameRu: null, nameEn: 'Dune EN' }, 'ru')).toBe('Dune EN');
    expect(pickTitle({ nameRu: 'Дюна' }, 'en')).toBe('Дюна');
    expect(pickTitle({ nameRu: '   ', nameEn: ' Dune ' }, 'ru')).toBe('Dune');
  });

  it('understands the answer wrapped in "data"', () => {
    expect(pickTitle({ data: { nameRu: 'Дюна', nameEn: 'Dune' } }, 'ru')).toBe('Дюна');
    expect(pickTitle({ data: { nameRu: '1+1', nameOriginal: 'Intouchables' } }, 'ru')).toBe(
      'Intouchables',
    );
  });

  it.each([[null], [undefined], [42], ['text'], [[]], [{}], [{ data: {} }], [{ nameRu: 5 }]])(
    'finds nothing in %j',
    (payload) => {
      expect(pickTitle(payload, 'ru')).toBeUndefined();
    },
  );

  it('caps the title length', () => {
    expect(pickTitle({ nameRu: 'я'.repeat(1000) }, 'ru')).toHaveLength(200);
  });
});

function transportReturning(answer: HttpResponse | Error) {
  const requests: HttpRequest[] = [];
  const transport: HttpTransport = {
    request(request) {
      requests.push(request);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { transport, requests };
}

const json = (body: unknown, status = 200): HttpResponse => ({
  status,
  headers: {},
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const thrown = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (e: unknown) => e,
  );

describe('createKinopoiskResolver', () => {
  const KEY = 'secret-key-1234';

  function setup(answer: HttpResponse | Error, key = KEY) {
    const { transport, requests } = transportReturning(answer);
    return { requests, resolver: createKinopoiskResolver({ transport, getKey: () => key }) };
  }

  it('asks the API by id with the key in the header and returns the title', async () => {
    const { resolver, requests } = setup(json({ nameRu: 'Дюна', nameEn: 'Dune' }));
    expect(await resolver.resolve(535341, 'ru')).toBe('Дюна');
    expect(requests).toEqual([
      {
        method: 'GET',
        url: `${KINOPOISK_API_BASE_URL}/api/v2.2/films/535341`,
        headers: { 'X-API-KEY': KEY, Accept: 'application/json' },
      },
    ]);
  });

  it('picks the title by UI language when there is no original title', async () => {
    const answer = json({ nameRu: 'Дюна', nameEn: 'Dune' });
    expect(await setup(answer).resolver.resolve(1, 'en')).toBe('Dune');
    expect(await setup(answer).resolver.resolve(1, 'ru')).toBe('Дюна');
  });

  it('searches by the original title when the service has one', async () => {
    const answer = json({ nameRu: '1+1', nameEn: null, nameOriginal: 'Intouchables', year: 2011 });
    expect(await setup(answer).resolver.resolve(535341, 'ru')).toBe('Intouchables');
  });

  it('accepts the wrapped answer shape', async () => {
    expect(await setup(json({ data: { nameRu: 'Дюна' } })).resolver.resolve(1, 'ru')).toBe('Дюна');
  });

  it('reads the key at call time and trims it', async () => {
    let key = '  ';
    const { transport, requests } = transportReturning(json({ nameRu: 'Дюна' }));
    const resolver = createKinopoiskResolver({ transport, getKey: () => key });
    expect(await thrown(() => resolver.resolve(1, 'ru'))).toMatchObject({ code: 'no-key' });
    expect(requests).toHaveLength(0);
    key = '  abc  ';
    await resolver.resolve(1, 'ru');
    expect(requests[0]?.headers['X-API-KEY']).toBe('abc');
  });

  it('uses a custom base URL without a trailing slash', async () => {
    const { transport, requests } = transportReturning(json({ nameRu: 'x' }));
    await createKinopoiskResolver({
      transport,
      getKey: () => 'k',
      baseUrl: 'https://proxy.example/',
    }).resolve(7, 'ru');
    expect(requests[0]?.url).toBe('https://proxy.example/api/v2.2/films/7');
  });

  it.each([0, -1, 1.5, Number.NaN, 1e12])(
    'rejects the invalid id %s without a request',
    async (id) => {
      const { resolver, requests } = setup(json({}));
      expect(await thrown(() => resolver.resolve(id, 'ru'))).toMatchObject({ code: 'not-found' });
      expect(requests).toHaveLength(0);
    },
  );

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [402, 'rate-limited'],
    [429, 'rate-limited'],
    [500, 'network'],
    [503, 'network'],
    [301, 'network'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const error = await thrown(() => setup(json({}, status)).resolver.resolve(1, 'ru'));
    expect(error).toBeInstanceOf(KinopoiskError);
    expect((error as KinopoiskError).code).toBe(code);
  });

  it('maps transport failures to a network error and keeps the cause', async () => {
    const cause = new NetworkError('offline');
    const error = (await thrown(() => setup(cause).resolver.resolve(1, 'ru'))) as KinopoiskError;
    expect(error.code).toBe('network');
    expect(error.cause).toBe(cause);
  });

  it.each([[''], ['<html>'], ['null'], ['[]'], ['{}'], [JSON.stringify({ nameRu: null })]])(
    'reports an unusable body %j',
    async (body) => {
      const error = (await thrown(() =>
        setup(json(body)).resolver.resolve(1, 'ru'),
      )) as KinopoiskError;
      expect(error).toBeInstanceOf(KinopoiskError);
      expect(['network', 'not-found']).toContain(error.code);
    },
  );

  it('never puts the API key into an error message', async () => {
    const answers: (HttpResponse | Error)[] = [
      json({}, 401),
      json({}, 404),
      json({}, 429),
      json({}, 500),
      json('garbage'),
      new Error(`connect failed for ${KEY}`),
    ];
    for (const answer of answers) {
      const error = (await thrown(() => setup(answer).resolver.resolve(1, 'ru'))) as Error;
      expect(error.message).not.toContain(KEY);
    }
  });
});
