/**
 * The number that claims the product works, and therefore the number most worth
 * being suspicious of.
 *
 * Under-reporting costs a data point. Over-reporting says a rep delivered a
 * suggestion they never read, and that is what someone would point at to decide
 * the product is working. So every ambiguous case here resolves to "no".
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  judgeImplementation,
  extractKeywords,
  MIN_MATCHED_KEYWORDS,
} = require('../dist/main/insight-implementation.js');

test('a suggestion the rep actually delivered counts', () => {
  const suggestion = 'Welche Hausmischungen setzen Sie aktuell in Ihren Filialen ein?';
  const spoken = 'Welche Hausmischungen setzen Sie denn aktuell in Ihren Filialen ein?';
  const verdict = judgeImplementation(suggestion, spoken);
  assert.equal(verdict.implemented, true);
  assert.ok(verdict.matched >= MIN_MATCHED_KEYWORDS);
  assert.ok(verdict.confidence >= 30);
});

test('German filler alone can never clear the bar', () => {
  // The defect this guards: the stop list was English-only in a German-first
  // product, and the filter keeps every word over four characters. "haben",
  // "werden", "koennen", "wirklich" all scored as content words.
  const suggestion = 'Wir haben wirklich koennen werden natuerlich eigentlich';
  const spoken = 'Wir haben das wirklich koennen und werden natuerlich eigentlich';
  const verdict = judgeImplementation(suggestion, spoken);
  assert.equal(verdict.total, 0, 'nothing in that sentence is content');
  assert.equal(verdict.implemented, false);
});

test('one incidental keyword is not an implementation', () => {
  // "Kennen Sie das von Ihren Hausmischungen?" reduces to ONE keyword after
  // stop words. Before MIN_MATCHED_KEYWORDS, a rep merely discussing house
  // mixes scored 100% confidence and counted as having delivered the line.
  const suggestion = 'Kennen Sie das von Ihren Hausmischungen?';
  const spoken = 'Ja unsere Hausmischungen sind seit Jahren gleich';
  const verdict = judgeImplementation(suggestion, spoken);

  // Exactly one content word overlaps - the topic - however many the suggestion
  // yields in total. Asserted on the overlap rather than on the keyword count,
  // which moves whenever the stop list does.
  assert.equal(verdict.matched, 1, `matched ${verdict.matched} of ${verdict.total}`);
  assert.equal(
    verdict.implemented,
    false,
    'a topic mention must not be reported as delivering the suggestion',
  );
});

test('silence is not an implementation', () => {
  const verdict = judgeImplementation('Welche Hausmischungen setzen Sie ein?', '');
  assert.equal(verdict.implemented, false);
  assert.equal(verdict.matched, 0);
});

test('an empty suggestion cannot be implemented', () => {
  const verdict = judgeImplementation('', 'irgendwas ueber Hausmischungen und Limonade');
  assert.equal(verdict.total, 0);
  assert.equal(verdict.implemented, false);
  assert.equal(verdict.confidence, 0, 'no keywords must not divide into a score');
});

test('matching is case-insensitive, as speech-to-text casing is arbitrary', () => {
  const suggestion = 'Welche Hausmischungen setzen Sie in Ihren Filialen ein?';
  const verdict = judgeImplementation(suggestion, 'WELCHE HAUSMISCHUNGEN IN DEN FILIALEN');
  assert.equal(verdict.implemented, true);
});

test('keyword extraction drops digits deliberately', () => {
  // Speech is compared un-normalised, so a "3.990" keyword could never match
  // "3990" in a transcript. Dropping numbers costs a keyword and avoids a
  // class of silent non-match that would look like under-delivery.
  assert.deepEqual(extractKeywords('Der Einstieg liegt bei 3.990 Euro'), ['einstieg', 'liegt']);
});

test('keywords are capped so one long suggestion cannot dominate', () => {
  const long = Array.from({ length: 40 }, (_, i) => `stichwort${i}`).join(' ');
  assert.ok(extractKeywords(long).length <= 10);
});
