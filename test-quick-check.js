/**
 * Quick Windows EVIA Check
 * Run: node test-quick-check.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Output to both console and file
const outputFile = path.join(__dirname, 'check-result.txt');
let output = '';
const log = (msg) => {
  console.log(msg);
  output += msg + '\n';
};

log('='.repeat(60));
log('EVIA Windows Quick Check');
log('='.repeat(60));

// Check 1: Platform
log('\n1. Platform: ' + os.platform() + ' ' + os.release());

// Check 2: node_modules
const nmPath = path.join(__dirname, 'node_modules');
const nmExists = fs.existsSync(nmPath);
log('\n2. node_modules exists: ' + nmExists);

if (nmExists) {
  // Check key deps
  const deps = ['electron', 'keytar', 'ws', 'vite'];
  deps.forEach(dep => {
    const depPath = path.join(nmPath, dep);
    const exists = fs.existsSync(depPath);
    log('   - ' + dep + ': ' + (exists ? '✓' : '✗'));
  });
}

// Check 3: WASAPILoopback.exe
const wasapiPath = path.join(__dirname, 'src', 'main', 'assets', 'WASAPILoopback.exe');
const wasapiExists = fs.existsSync(wasapiPath);
log('\n3. WASAPILoopback.exe exists: ' + wasapiExists);
if (wasapiExists) {
  const stats = fs.statSync(wasapiPath);
  log('   Size: ' + stats.size + ' bytes');
}

// Check 4: TypeScript files
const tsFiles = [
  'src/main/main.ts',
  'src/main/system-audio-windows-service.ts',
  'src/renderer/audio-processor-glass-parity.ts'
];
log('\n4. Key TypeScript files:');
tsFiles.forEach(f => {
  const fullPath = path.join(__dirname, f);
  log('   - ' + f + ': ' + (fs.existsSync(fullPath) ? '✓' : '✗'));
});

// Check 5: Config
log('\n5. package.json version:');
try {
  const pkg = require('./package.json');
  log('   Name: ' + pkg.name);
  log('   Version: ' + pkg.version);
} catch (e) {
  log('   Error reading package.json');
}

log('\n' + '='.repeat(60));
log('If node_modules is missing, run: npm install');
log('Then run: npm run dev');
log('='.repeat(60));

// Write output to file
fs.writeFileSync(outputFile, output);
log('\nResults written to: ' + outputFile);
