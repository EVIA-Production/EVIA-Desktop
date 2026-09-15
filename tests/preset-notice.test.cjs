/**
 * Which preset notice the Listen window shows, and what it says.
 *
 * Production, 30 days to 2026-09-15: the old banner fired for 13 chats, 10 of
 * them with NO preset bound, every one worded "your preset is still the blank
 * template". These pin the four states apart and the precedence between them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererTs } = require('./_load-renderer-ts.cjs');

const {
  noticeFromContextStatus,
  noticeFromInsights,
  pickPresetNotice,
  presetNoticeCopy,
  presetNoticeKey,
} = loadRendererTs('lib/preset-notice.ts');

const en = require('../src/renderer/i18n/en.json');
const de = require('../src/renderer/i18n/de.json');
const tFor = (dict) => (key) => key.split('.').reduce((v, k) => (v && v[k] !== undefined ? v[k] : key), dict);

test('no preset bound and none active is "missing": one header, no action, guidance tone', () => {
  const notice = noticeFromInsights({ preset_unusable: true, preset_status: 'missing', preset_missing: true });
  assert.equal(notice.kind, 'missing');
  const copy = presetNoticeCopy(notice, tFor(en));
  assert.equal(copy.title, 'No Preset Active');
  assert.equal(copy.detail, undefined, 'headers only');
  assert.equal(copy.action, undefined, 'a preset cannot be changed during a call');
  assert.equal(copy.tone, 'guidance', 'guidance, not caution: nothing is broken');
});

test('the untouched template is "blank" and the header names the preset', () => {
  const notice = noticeFromInsights({ preset_unusable: true, preset_status: 'blank', preset_name: 'Test Vorlage' });
  assert.equal(notice.kind, 'blank');
  const copy = presetNoticeCopy(notice, tFor(de));
  assert.equal(copy.title, '„Test Vorlage“ ist noch leer');
  assert.equal(copy.detail, undefined);
  const unnamed = presetNoticeCopy({ kind: 'blank' }, tFor(de));
  assert.equal(unnamed.title, 'Vorlage ist noch leer');
});

test('a backend without preset_status still yields a blank header, not its sentence', () => {
  const sentence = 'Dein Preset ist noch die leere Vorlage - Fülle es aus.';
  const notice = noticeFromInsights({ preset_unusable: true, preset_warning: sentence });
  assert.equal(notice.kind, 'blank');
  const copy = presetNoticeCopy(notice, tFor(de));
  assert.equal(copy.title, 'Vorlage ist noch leer');
  assert.equal(copy.detail, undefined);
});

test('a usable preset produces no notice at all', () => {
  assert.equal(noticeFromInsights({ preset_unusable: false }), null);
  assert.equal(noticeFromInsights({}), null);
  assert.equal(noticeFromInsights(null), null);
});

test('context_status: an older backend without active_preset_id never reports a mismatch', () => {
  const r = noticeFromContextStatus({ preset_id: null, version: 'default', available: true });
  assert.equal(r.unavailable, false);
  assert.equal(r.mismatch, null);
});

test('context_status: bound to A while B is active is a mismatch naming both', () => {
  const r = noticeFromContextStatus({
    preset_id: 164, preset_name: 'Corvin Wucher - Demo', available: true,
    active_preset_id: 210, active_preset_name: 'SESES DRINKS',
  });
  assert.equal(r.mismatch.kind, 'mismatch');
  const copy = presetNoticeCopy(r.mismatch, tFor(en));
  assert.equal(copy.title, 'Another Preset Is Active');
  assert.match(copy.detail, /“Corvin Wucher - Demo”/);
  assert.match(copy.detail, /“SESES DRINKS” applies from the next conversation/);
});

test('context_status: bound to nothing while B is active says so, without inventing a name', () => {
  const r = noticeFromContextStatus({ preset_id: null, available: true, active_preset_id: 210, active_preset_name: 'SESES DRINKS' });
  assert.equal(r.mismatch.kind, 'mismatch');
  const copy = presetNoticeCopy(r.mismatch, tFor(de));
  assert.match(copy.detail, /ohne Vorlage/);
  assert.match(copy.detail, /„SESES DRINKS“ gilt ab dem nächsten Gespräch/);
});

test('context_status: bound to A while nothing is active is NOT a mismatch (the call still has A)', () => {
  const r = noticeFromContextStatus({ preset_id: 164, preset_name: 'A', available: true, active_preset_id: null, active_preset_name: null });
  assert.equal(r.mismatch, null);
});

test('context_status: the same preset under different id types matches', () => {
  const r = noticeFromContextStatus({ preset_id: '210', available: true, active_preset_id: 210 });
  assert.equal(r.mismatch, null);
});

test('precedence: unavailable beats mismatch beats the insight notice', () => {
  const mismatch = { kind: 'mismatch', boundName: 'A', activeName: 'B' };
  const missing = { kind: 'missing' };
  assert.equal(pickPresetNotice({ unavailable: true, mismatch, insight: missing }).kind, 'unavailable');
  assert.equal(pickPresetNotice({ unavailable: false, mismatch, insight: missing }).kind, 'mismatch');
  assert.equal(pickPresetNotice({ unavailable: false, mismatch: null, insight: missing }).kind, 'missing');
  assert.equal(pickPresetNotice({ unavailable: false, mismatch: null, insight: null }), null);
});

test('unavailable is the only caution-toned notice: one header', () => {
  const copy = presetNoticeCopy({ kind: 'unavailable' }, tFor(en));
  assert.equal(copy.tone, 'caution');
  assert.equal(copy.detail, undefined);
  assert.equal(copy.title, 'Preset Context Unavailable');
});

test('only the mismatch keeps a second line', () => {
  const mismatch = noticeFromContextStatus({ preset_id: 1, preset_name: 'A', available: true, active_preset_id: 2, active_preset_name: 'B' }).mismatch;
  assert.equal(typeof presetNoticeCopy(mismatch, tFor(en)).detail, 'string');
  for (const notice of [{ kind: 'missing' }, { kind: 'blank', boundName: 'X' }, { kind: 'unavailable' }]) {
    assert.equal(presetNoticeCopy(notice, tFor(en)).detail, undefined, `${notice.kind} must be header-only`);
  }
});

test('dismissal identity: same notice stays closed, a different preset shows again', () => {
  const a = { kind: 'blank', boundName: 'A' };
  const aAgain = { kind: 'blank', boundName: 'A' };
  const b = { kind: 'blank', boundName: 'B' };
  assert.equal(presetNoticeKey(a), presetNoticeKey(aAgain));
  assert.notEqual(presetNoticeKey(a), presetNoticeKey(b));
  assert.notEqual(presetNoticeKey({ kind: 'missing' }), presetNoticeKey({ kind: 'unavailable' }));
});

test('every notice key exists in both languages', () => {
  for (const dict of [en, de]) {
    const block = dict.overlay.listen.presetNotice;
    for (const key of [
      'unavailableTitle', 'mismatchTitle', 'mismatchDetailBound', 'mismatchDetailNone',
      'missingTitle', 'blankTitle', 'blankTitleNamed', 'unnamedPreset', 'dismiss',
    ]) {
      assert.equal(typeof block[key], 'string', `missing ${key}`);
      assert.ok(block[key].length > 0, `empty ${key}`);
    }
  }
});

test('HIG writing rules: no "we", no exclamation marks, titles without end punctuation', () => {
  for (const dict of [en, de]) {
    const block = dict.overlay.listen.presetNotice;
    for (const [key, value] of Object.entries(block)) {
      assert.doesNotMatch(value, /!/, `${key} shouts`);
      assert.doesNotMatch(value, /\b[Ww]e\b|\b[Ww]ir\b/, `${key} uses "we"`);
      if (/Title(Named)?$/.test(key)) assert.doesNotMatch(value, /[.!?]$/, `${key} ends with punctuation`);
      if (/Detail$/.test(key)) assert.match(value, /\.$/, `${key} must be a complete sentence`);
    }
  }
});
