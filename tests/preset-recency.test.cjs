const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const entries = new Map();
  const localStorage = {getItem:key=>entries.get(key) ?? null,setItem:(key,value)=>entries.set(key,value)};
  const exports = {};
  const source = fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/lib/preset-recency.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,localStorage});
  return exports;
}

test('active preset comes first, previous activation second, without mutating the input',()=>{
  const {orderPresets}=load();
  const presets=[{id:1},{id:2,is_active:true},{id:3}];
  assert.equal(JSON.stringify(orderPresets(presets,['3','2'])),JSON.stringify([presets[1],presets[2],presets[0]]));
  assert.deepEqual(presets.map(p=>p.id),[1,2,3]);
});

test('history survives reads, deduplicates activations and isolates accounts',()=>{
  const {rememberPresetUse,readPresetRecency}=load();
  rememberPresetUse('one',1);rememberPresetUse('one',2);rememberPresetUse('one',1);
  assert.equal(JSON.stringify(readPresetRecency('one')),JSON.stringify(['1','2']));
  assert.equal(JSON.stringify(readPresetRecency('two')),'[]');
});

test('deleted presets do not appear and never-used presets keep their existing order',()=>{
  const {orderPresets}=load();
  assert.equal(JSON.stringify(orderPresets([{id:5},{id:7},{id:9}],['deleted','7'])),JSON.stringify([{id:7},{id:5},{id:9}]));
});
