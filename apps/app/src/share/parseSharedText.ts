/** Longest title we will ever search for; real titles are far shorter. */
export const MAX_QUERY_LENGTH = 200;
/** Only the start of a share is inspected: the title is always near the top. */
const MAX_INSPECTED_LENGTH = 2000;

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/giu;

// «title», “title”, „title“ and "title". Apostrophes are left alone: they occur inside titles.
const QUOTED_PATTERN = /«([^»]{1,200})»|“([^”]{1,200})”|„([^“”]{1,200})[“”]|"([^"]{1,200})"/u;

/** Calls to action at the start of a share ("Смотри Дюна", "Check out Dune"), repeated if stacked. */
const LEADING_PHRASES =
  /^(?:(?:смотри(?:те)?|посмотри(?:те)?|глянь(?:-ка)?|рекомендую|рекомендуем|советую|советуем|можешь посмотреть|стоит посмотреть|check out|look at|have you seen|you should watch|must[- ]watch|i recommend|recommended)(?![\p{L}\p{N}])[\s:,!.\-—–]*)+/iu;

const SERVICES =
  'кинопоиск(?:е|а)?|imdb|tmdb|netflix|okko|иви|ivi|kion|кион|more\\.tv|premier|wink|amazon prime(?: video)?|disney\\+|apple tv\\+?|hbo(?: max)?|max|letterboxd';

/** "… на Кинопоиске", "… on IMDb": the service the share came from, not part of the title. */
const TRAILING_SERVICE = new RegExp(
  `\\s+(?:на|в|on|at|via)\\s+(?:${SERVICES})(?![\\p{L}\\p{N}]).*$`,
  'iu',
);
/** "… | Кинопоиск", "… — IMDb". */
const TRAILING_SITE_SUFFIX = new RegExp(`\\s*[|—–-]\\s*(?:${SERVICES})\\s*$`, 'iu');

/** "(2021)", "(2021, США)", "(2019–2023)": a parenthesised group that starts with a year. */
const PARENTHESISED_YEAR = /\s*\((?:19|20)\d{2}[^)]*\)/gu;

const EMOJI_AND_JOINERS = /[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu;
const EDGE_JUNK = /^[\s:;,.!?\-—–"'«»“”„()[\]]+|[\s:;,.!?\-—–"'«»“”„()[\]]+$/gu;

function cleanTitle(raw: string): string {
  let text = raw.replace(EMOJI_AND_JOINERS, ' ');
  text = text.replace(PARENTHESISED_YEAR, '');
  text = text.replace(TRAILING_SITE_SUFFIX, '');
  text = text.replace(TRAILING_SERVICE, '');
  text = text.replace(EDGE_JUNK, '');
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Turns the text of an Android "Share" ("Смотри Дюна https://…", «Дюна (2021)», ...) into a search
 * query. Returns an empty string when no title can be found (for example, a bare link).
 *
 * Order: drop URLs; a quoted title wins; otherwise the first line that still has text after
 * removing leading calls to action, the source service, a year in parentheses and decoration.
 */
export function parseSharedText(input: unknown): string {
  if (typeof input !== 'string') return '';
  const text = input.slice(0, MAX_INSPECTED_LENGTH).replace(URL_PATTERN, ' ');

  const quoted = QUOTED_PATTERN.exec(text);
  const inner = quoted?.slice(1).find((group) => group !== undefined);
  if (inner !== undefined) {
    const title = cleanTitle(inner);
    if (title) return title.slice(0, MAX_QUERY_LENGTH);
  }

  for (const line of text.split(/[\r\n]+/u)) {
    const stripped = line.replace(EMOJI_AND_JOINERS, ' ').trim().replace(LEADING_PHRASES, '');
    const title = cleanTitle(stripped);
    if (title) return title.slice(0, MAX_QUERY_LENGTH);
  }
  return '';
}
