/**
 * Did the rep actually say the thing Taylos suggested?
 *
 * This produces the number that claims the product works, which makes it the
 * number most worth being suspicious of. Two rules follow from that:
 *
 *   1. Under-reporting beats over-reporting. A missed implementation costs a
 *      data point. A false one says a seller used a suggestion they never read,
 *      and that is the metric people make decisions on.
 *   2. The decision has to be testable in isolation, which is why it lives here
 *      rather than inside posthogService, where it cannot be reached from Node.
 */

/** Filler that survives a length filter and carries no meaning either way. */
const STOP_WORDS = new Set([
  // English
  'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'his',
  'from', 'they', 'say', 'she', 'will', 'one', 'all', 'would', 'there', 'their',
  'what', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'work', 'first', 'well', 'way', 'even', 'new', 'want',
  'because', 'any', 'these', 'give', 'day', 'most', 'use', 'about',
  // German. The product sells in German and the filter keeps everything over
  // four characters, so without these "haben"/"werden"/"koennen" scored as
  // content and a suggestion could clear the threshold on filler alone.
  'haben', 'hatte', 'hatten', 'werden', 'wurde', 'wurden', 'wird', 'sein',
  'seine', 'seinen', 'ihre', 'ihren', 'ihrem', 'unser', 'unsere', 'unseren',
  'koennen', 'können', 'konnte', 'sollen', 'sollte', 'muessen', 'müssen',
  'wollen', 'wollte', 'moechten', 'möchten', 'dieser', 'diese', 'dieses',
  'welche', 'welcher', 'nicht', 'auch', 'schon', 'noch', 'aber', 'oder',
  'wenn', 'dann', 'dass', 'weil', 'damit', 'durch', 'gegen', 'ohne',
  'ueber', 'über', 'unter', 'zwischen', 'immer', 'wieder', 'sehr', 'mehr',
  'viele', 'vielen', 'einfach', 'gerne', 'genau', 'natuerlich', 'natürlich',
  'eigentlich', 'wirklich', 'vielleicht', 'sagen', 'gesagt', 'machen',
  'gemacht', 'geht', 'gehen', 'kommt', 'kommen', 'sehen', 'gerade', 'kennen',
]);

export const MATCH_RATIO_THRESHOLD = 0.3;

/**
 * At least this many keywords must appear before a ratio means anything.
 *
 * "Kennen Sie das von Ihren Hausmischungen?" reduces to ONE keyword after stop
 * words. A single incidental mention of that word then scored 100% confidence -
 * a suggestion counted as implemented because the rep happened to be talking
 * about the topic it named. Below two matches there is no way to tell reading
 * the line from discussing the subject, so we decline to guess.
 */
export const MIN_MATCHED_KEYWORDS = 2;

export const MAX_KEYWORDS = 10;

export function extractKeywords(text: string): string[] {
  return (text || '')
    .toLowerCase()
    // Digits go deliberately. Speech is compared un-normalised, so "3.990" in a
    // suggestion would never match "3990" in a transcript; dropping numbers
    // costs a keyword and avoids a class of silent non-match.
    .replace(/[^a-zäöüß\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 4 && !STOP_WORDS.has(word))
    .slice(0, MAX_KEYWORDS);
}

export type ImplementationVerdict = {
  implemented: boolean;
  matched: number;
  total: number;
  /** 0-100, and only meaningful when `implemented` is true. */
  confidence: number;
};

/** Whether `speech` reads as the rep having delivered `insightText`. */
export function judgeImplementation(insightText: string, speech: string): ImplementationVerdict {
  const keywords = extractKeywords(insightText);
  const haystack = (speech || '').toLowerCase();
  const matched = keywords.filter((keyword) => haystack.includes(keyword)).length;
  const ratio = keywords.length > 0 ? matched / keywords.length : 0;
  return {
    implemented: matched >= MIN_MATCHED_KEYWORDS && ratio >= MATCH_RATIO_THRESHOLD,
    matched,
    total: keywords.length,
    confidence: Math.round(ratio * 100),
  };
}
