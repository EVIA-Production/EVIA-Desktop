/**
 * Transpile one src/renderer/lib/*.ts module in memory and require it, so the
 * tests run against the code that ships rather than a hand copy of it.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

function loadRendererTs(relativePath) {
  const src = path.join(__dirname, '..', 'src', 'renderer', relativePath);
  const js = ts.transpileModule(fs.readFileSync(src, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(src, null);
  m.filename = src;
  m.paths = Module._nodeModulePaths(path.dirname(src));
  m._compile(js, src);
  return m.exports;
}

module.exports = { loadRendererTs };
