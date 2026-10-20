import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH, parseSharedText } from './parseSharedText';

describe('parseSharedText: documented formats', () => {
  it.each([
    ['Смотри Дюна https://example.com/x', 'Дюна'],
    [
      'Посмотри «Дюна: Часть вторая» на Кинопоиске https://www.kinopoisk.ru/film/409424/',
      'Дюна: Часть вторая',
    ],
    ['Дюна (2021) https://www.kinopoisk.ru/film/409424/', 'Дюна'],
    ['Check out Dune: Part Two https://www.imdb.com/title/tt15239678/', 'Dune: Part Two'],
    ['Рекомендую!\nДюна\nhttps://example.com', 'Дюна'],
    ['https://www.kinopoisk.ru/film/409424/', ''],
  ])('%j -> %j', (input, expected) => {
    expect(parseSharedText(input)).toBe(expected);
  });
});

describe('parseSharedText: Russian shares', () => {
  it.each([
    ['Смотри Дюна', 'Дюна'],
    ['смотри дюна', 'дюна'],
    ['Посмотри Интерстеллар!', 'Интерстеллар'],
    ['Глянь-ка Начало', 'Начало'],
    ['Рекомендую Побег из Шоушенка', 'Побег из Шоушенка'],
    ['Советую: Во все тяжкие', 'Во все тяжкие'],
    ['Рекомендую, посмотри «Игра в кальмара»', 'Игра в кальмара'],
    [
      'Смотри «Во все тяжкие» (2008) на Кинопоиске: https://www.kinopoisk.ru/series/404900/',
      'Во все тяжкие',
    ],
    ['Дюна (2021, США) на КиноПоиске', 'Дюна'],
    ['Игра престолов (2011–2019) — Кинопоиск', 'Игра престолов'],
    ['Смотри Матрица на Okko', 'Матрица'],
    ['Бригада | Кинопоиск', 'Бригада'],
  ])('%j -> %j', (input, expected) => {
    expect(parseSharedText(input)).toBe(expected);
  });
});

describe('parseSharedText: English shares', () => {
  it.each([
    ['Check out Dune https://x.example', 'Dune'],
    ['Look at Blade Runner 2049', 'Blade Runner 2049'],
    ['Have you seen Parasite?', 'Parasite'],
    ['You should watch: The Bear', 'The Bear'],
    ['I recommend "Severance" on Apple TV+', 'Severance'],
    ['Oppenheimer (2023) - IMDb', 'Oppenheimer'],
    ['Watch Dogs', 'Watch Dogs'],
    ['Watchmen', 'Watchmen'],
  ])('%j -> %j', (input, expected) => {
    expect(parseSharedText(input)).toBe(expected);
  });
});

describe('parseSharedText: quoting and structure', () => {
  it('prefers a quoted title over the surrounding words', () => {
    expect(parseSharedText('Вчера смотрели «Остров проклятых», очень круто')).toBe(
      'Остров проклятых',
    );
    expect(parseSharedText('We loved “The Godfather” last night')).toBe('The Godfather');
    expect(parseSharedText('Look: "Heat" is great')).toBe('Heat');
    expect(parseSharedText('Сериал „Чернобыль“ топ')).toBe('Чернобыль');
  });

  it('uses the first quoted title when there are several', () => {
    expect(parseSharedText('«Дюна» лучше, чем «Звёздные войны»')).toBe('Дюна');
  });

  it('keeps apostrophes inside titles', () => {
    expect(parseSharedText("Check out Schindler's List")).toBe("Schindler's List");
  });

  it('takes the first line that has a title, skipping filler lines', () => {
    expect(parseSharedText('Рекомендую!\n\n  \nИнтерстеллар\nhttps://x.example\nещё текст')).toBe(
      'Интерстеллар',
    );
    expect(parseSharedText('\r\nСмотри!\r\nМатрица\r\n')).toBe('Матрица');
  });

  it('removes every URL form, including bare www links', () => {
    expect(
      parseSharedText('Дюна https://a.example/x?y=1#z http://b.example www.c.example/path'),
    ).toBe('Дюна');
    expect(parseSharedText('www.kinopoisk.ru/film/1/')).toBe('');
  });

  it('removes emoji and decoration', () => {
    expect(parseSharedText('🎬 Смотри Дюна 🍿')).toBe('Дюна');
    expect(parseSharedText('⭐️⭐️⭐️ «Бойцовский клуб» ⭐️')).toBe('Бойцовский клуб');
    expect(parseSharedText('--- Дюна ---')).toBe('Дюна');
  });

  it('keeps colons, digits and years that are part of the title', () => {
    expect(parseSharedText('Дюна: Часть вторая')).toBe('Дюна: Часть вторая');
    expect(parseSharedText('Смотри 1917')).toBe('1917');
    expect(parseSharedText('2012')).toBe('2012');
    expect(parseSharedText('Blade Runner 2049')).toBe('Blade Runner 2049');
    expect(parseSharedText('Мстители: Война бесконечности')).toBe('Мстители: Война бесконечности');
  });

  it('collapses whitespace', () => {
    expect(parseSharedText('Смотри   Начало \t  ')).toBe('Начало');
  });
});

describe('parseSharedText: page titles (subject of a browser share)', () => {
  it.each([
    ['Дюна (2021) — смотреть онлайн — Кинопоиск', 'Дюна'],
    ['Дюна (фильм, 2021) — Кинопоиск', 'Дюна'],
    ['Дюна — смотреть онлайн — Кинопоиск', 'Дюна'],
    ['Дюна смотреть онлайн бесплатно в хорошем качестве', 'Дюна'],
    ['Dune: Part Two (2024) - IMDb', 'Dune: Part Two'],
    ['Dune (2021) | Watch online | Netflix', 'Dune'],
    ['Игра престолов (сериал, 2011 – 2019) — Кинопоиск', 'Игра престолов'],
    ['Watch Dogs', 'Watch Dogs'],
    ['Watch Dogs (2014) - IMDb', 'Watch Dogs'],
  ])('%j -> %j', (input, expected) => {
    expect(parseSharedText(input)).toBe(expected);
  });
});

describe('parseSharedText: words that only describe the share', () => {
  it.each([
    ['Посмотри фильм'],
    ['Смотри сериал https://x.example'],
    ['Рекомендую кино'],
    ['Check out this movie'],
    ['Ссылка'],
  ])('%j -> empty', (input) => {
    expect(parseSharedText(input)).toBe('');
  });

  it('still keeps titles that merely contain such a word', () => {
    expect(parseSharedText('Смотри Фильм ужасов')).toBe('Фильм ужасов');
    expect(parseSharedText('Check out Movie 43')).toBe('Movie 43');
  });
});

describe('parseSharedText: nothing to search for', () => {
  it.each([
    [''],
    ['   '],
    ['\n\n'],
    ['https://example.com'],
    ['Смотри!'],
    ['Рекомендую'],
    ['«»'],
    ['🎬🍿'],
    ['(2021)'],
    ['!!! ??? ...'],
  ])('%j -> empty', (input) => {
    expect(parseSharedText(input)).toBe('');
  });

  it.each([[undefined], [null], [42], [{}], [['Дюна']], [true]])(
    'rejects non-string %j',
    (input) => {
      expect(parseSharedText(input)).toBe('');
    },
  );
});

describe('parseSharedText: hostile and oversized input', () => {
  it('treats scripts and markup as plain text (the UI escapes it) and drops their URLs', () => {
    // An unbalanced trailing bracket is edge decoration; the rest is just text to search for.
    expect(parseSharedText('javascript:alert(1)')).toBe('javascript:alert(1');
    expect(parseSharedText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    expect(parseSharedText('<a href="https://evil.example">Дюна</a>')).toBe('<a href=');
  });

  it('caps the query length', () => {
    const long = parseSharedText('Д'.repeat(5000));
    expect(long).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('is fast on pathological input (no catastrophic backtracking)', () => {
    const started = Date.now();
    parseSharedText('«' + 'а'.repeat(50_000));
    parseSharedText('(' + '2'.repeat(50_000));
    parseSharedText(' '.repeat(50_000) + 'x');
    parseSharedText('смотри '.repeat(10_000));
    parseSharedText('на '.repeat(10_000) + 'Кинопоиске');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('never throws on arbitrary strings', () => {
    const samples = [
      '\u0000',
      '\ud800',
      '«',
      '»',
      '"',
      '“',
      '„',
      '()',
      '(2021',
      'https://',
      'www.',
      '️',
      '‍',
    ];
    for (const sample of samples) expect(() => parseSharedText(sample)).not.toThrow();
  });
});
