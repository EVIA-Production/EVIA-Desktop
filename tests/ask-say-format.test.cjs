/**
 * The answer / divider / "Sag:" shape has to survive all the way to the DOM.
 *
 * Reported twice as not displaying. The markup was never the problem: the
 * backend emits "answer\n\n---\n\n**Sag:** line", marked turns that into
 * <p>…</p><hr><p><strong>Sag:</strong> …</p>, and both tags are in the live
 * allow-list. What could not be seen was the divider itself - a white border at
 * 0.18 alpha over a light desktop.
 *
 * So this pins three separate things, because each one has broken or could:
 *   1. marked still produces hr + strong from that exact input
 *   2. the DURING allow-list still admits hr and strong
 *   3. the live sanitiser's regex chain does not eat the divider
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const ASK = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'AskView.tsx'), 'utf8');
const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'overlay-glass.css'), 'utf8');

const DE = 'Der Einwand sitzt tief.\n\n---\n\n**Sag:** Zwei Agenturen ohne Ergebnis, was lief da schief?';
const EN = 'The objection is real.\n\n---\n\n**Say:** Two agencies and nothing to show for it.';

test('marked turns the backend shape into a rule plus a bold label', () => {
  for (const input of [DE, EN]) {
    const html = marked.parse(input).replace(/\n/g, '');
    assert.match(html, /<hr\s*\/?>/, 'the divider must survive');
    assert.match(html, /<strong>(Sag|Say):<\/strong>/, 'the label must be bold, not literal asterisks');
    assert.ok(html.indexOf('<hr') < html.indexOf('<strong>'), 'the divider comes before the line');
  }
});

test('the live allow-list still admits the two tags the shape needs', () => {
  const at = ASK.indexOf('ALLOWED_TAGS');
  assert.ok(at > 0);
  const during = ASK.slice(at, ASK.indexOf('ALLOWED_ATTR', at));
  const live = during.slice(during.indexOf("'during'"), during.indexOf(':', during.indexOf("'during'") + 20));
  assert.match(live, /'hr'/, "hr dropped from the during allow-list would delete the divider");
  assert.match(live, /'strong'/, "strong dropped would render **Sag:** as literal asterisks");
});

test('nothing in the live sanitiser eats a markdown horizontal rule', () => {
  // The list-marker strip is the dangerous one: /^\s*[-*]\s+/ would match a
  // dash followed by whitespace. "---" has no whitespace after the first dash,
  // so it survives - but only as long as that regex keeps requiring \s+.
  const start = ASK.indexOf('const sanitizeLiveAskMarkdown');
  const body = ASK.slice(start, ASK.indexOf('const sanitizeRichAskMarkdown'));
  assert.match(body, /\^\\s\*\[-\*\]\\s\+/,
    'the list-marker strip must keep requiring whitespace after the dash, or --- becomes ""');
  assert.ok(!/replace\(\/-{3}\//.test(body), 'nothing may target --- directly');
});

test('the divider is visible on a light desktop, not only on dark glass', () => {
  const rule = CSS.slice(CSS.indexOf('.markdown-content hr'), CSS.indexOf('.markdown-content hr') + 260);
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(rule),
    'a hardcoded white border disappears over a light background - the exact ' +
    'condition behind the reported "white background" problems');
  assert.match(rule, /currentColor/, 'the divider should follow the text colour');
});
