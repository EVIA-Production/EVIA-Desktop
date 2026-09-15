/**
 * The preset notice is cleared at every session boundary and rendered pinned
 * above the scroll area, next to the capture alert - not inside the content.
 *
 * Before: `presetEmptyWarning` was set only from an insights response and
 * cleared only by the next one, so a "blank preset" banner from the previous
 * call stayed on screen into a new call that HAD a preset until its first
 * insights arrived. Source-level, like listen-view-selection.test.cjs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const listenView = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'), 'utf8');
const settingsView = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'SettingsView.tsx'), 'utf8');
const glassCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'overlay-glass.css'), 'utf8');
const liquidCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'liquid-glass.css'), 'utf8');

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('resetSessionPresentation clears all notice state, including a dismissal', () => {
  const reset = block(listenView, 'const resetSessionPresentation = (reason: string) => {', 'const handleTranscriptMessage');
  assert.match(reset, /setPresetContextWarning\(false\)/);
  assert.match(reset, /setPresetMismatch\(null\)/);
  assert.match(reset, /setPresetInsightNotice\(null\)/);
  assert.match(reset, /setDismissedPresetNotice\(null\)/);
});

test('recording_stopped clears the notices before the post-call view', () => {
  const stopped = block(listenView, "if (msg.type === 'recording_stopped') {", "if (msg.type === 'context_status') {");
  assert.match(stopped, /setPresetContextWarning\(false\)/);
  assert.match(stopped, /setPresetMismatch\(null\)/);
  assert.match(stopped, /setPresetInsightNotice\(null\)/);
  assert.match(stopped, /setDismissedPresetNotice\(null\)/);
});

test('context_status feeds the notice model, not a bare boolean', () => {
  const ctx = block(listenView, "if (msg.type === 'context_status') {", "if (msg.type !== 'transcript_segment')");
  assert.match(ctx, /noticeFromContextStatus\(msg\.data\)/);
  assert.match(ctx, /setPresetMismatch\(status\.mismatch\)/);
});

test('the notice renders pinned above the scroll area, and the old strip is gone', () => {
  const render = block(listenView, 'return (\n    <div className="assistant-container"', '<div className="glass-scroll" ref={viewportRef}>');
  assert.match(render, /<PresetNoticeView notice=\{presetNotice\} onDismiss=\{dismissPresetNotice\} \/>/);
  assert.doesNotMatch(listenView, /handlePresetNoticeAction|openPersonalizePage/, 'no actions during a call');
  assert.doesNotMatch(listenView, /listen-context-warning/);
  assert.doesNotMatch(listenView, /presetEmptyWarning/);
  assert.doesNotMatch(glassCss, /\.listen-context-warning/);
});

test('the notice component is a status region with a hover-revealed dismiss, real SF Symbols, never 10px text', () => {
  const component = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'PresetNotice.tsx'), 'utf8');
  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /className="taylos-status-alert__dismiss"/);
  assert.match(component, /aria-label=\{dismissLabel\}/);
  assert.match(component, /<SFSymbol name="xmark"/);
  assert.doesNotMatch(component, /taylos-status-alert__action/, 'no action buttons');
  const symbols = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'sf-symbols.tsx'), 'utf8');
  for (const name of ['text.document', 'document', 'document.on.document', 'exclamationmark.triangle', 'xmark']) {
    assert.match(symbols, new RegExp(`'${name.replace(/\./g, '\\.')}': \\{`), `${name} outline present`);
  }
  assert.match(symbols, /wght 590\.8/);
  assert.match(symbols, /isApplePlatform/);
  const dismissCss = block(liquidCss, '.taylos-status-alert__dismiss {', '.taylos-status-alert__dismiss > svg');
  assert.match(dismissCss, /opacity: 0;/);
  assert.match(dismissCss, /\.taylos-status-alert:hover \.taylos-status-alert__dismiss,\s*\.taylos-status-alert__dismiss:focus-visible \{\s*opacity: 1;/);
  const styles = block(liquidCss, '.taylos-status-alert {', '.taylos-status-alert__dismiss > svg');
  assert.doesNotMatch(styles, /font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/, 'nothing below 11px on a notice');
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(block(liquidCss, '.taylos-status-alert {', '@keyframes'), /backdrop-filter/, 'standard material inside the content layer, not a second lens');
});

test('the Settings toggle ignores a deactivate within the activation window', () => {
  const toggleOff = block(settingsView, '// Toggle off: clicking the already-active preset deactivates it', 'const result = await presetBridge.deactivate(preset.id);');
  assert.match(toggleOff, /isAccidentalDeactivate\(recentActivationRef\.current, preset\.id, Date\.now\(\)\)/);
  assert.match(settingsView, /recentActivationRef\.current = recordActivation\(preset\.id, Date\.now\(\)\)/);
});
