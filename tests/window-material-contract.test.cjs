const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main', 'window-material.ts'),
  'utf8'
);

test('persistent overlay material does not change when window focus changes', () => {
  assert.match(
    source,
    /function nativeMaterialActiveState[\s\S]*surface === 'overlay' \? true : windowIsActive/
  );
  assert.match(
    source,
    /applyNativeBridge\([\s\S]*nativeMaterialActiveState\(surface, win\.isFocused\(\)\)/
  );
  assert.match(
    source,
    /active: nativeMaterialActiveState\(configured\.surface, active\)/
  );
});
