/**
 * EVIA Windows Pipeline Diagnostic Tool
 * 
 * Purpose: Verify Windows audio pipeline and WASAPI helper functionality
 * Run on Windows with: node scripts/test-windows-pipeline.js
 * 
 * This script checks:
 * 1. Platform detection
 * 2. WASAPILoopback.exe availability and execution
 * 3. Audio device enumeration
 * 4. Network connectivity to backend
 * 5. Dependencies availability
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         EVIA Windows Pipeline Diagnostic Tool              ║');
console.log('║                   Version 1.0 (2025-12-05)                 ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Check platform
if (os.platform() !== 'win32') {
  console.log('⚠️  This script is designed for Windows. Current platform:', os.platform());
  console.log('   Some tests may not work correctly.\n');
}

// System info
console.log('📋 SYSTEM INFORMATION');
console.log('─'.repeat(60));
console.log(`   OS:           ${os.platform()} ${os.release()} (${os.arch()})`);
console.log(`   Node.js:      ${process.version}`);
console.log(`   Memory:       ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB total`);
console.log(`   Free Memory:  ${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`);
console.log(`   CPUs:         ${os.cpus().length} cores`);
console.log('');

// Check WASAPILoopback.exe
const wasapiPath = path.join(__dirname, '..', 'src', 'main', 'assets', 'WASAPILoopback.exe');
console.log('🔊 WASAPI HELPER CHECK');
console.log('─'.repeat(60));
console.log(`   Path: ${wasapiPath}`);

function testWasapiHelper() {
  return new Promise((resolve) => {
    if (!fs.existsSync(wasapiPath)) {
      console.log(`   Status: ❌ NOT FOUND`);
      console.log(`   Action: Compile from WASAPILoopback.cpp or obtain binary`);
      resolve(false);
      return;
    }
    
    const stats = fs.statSync(wasapiPath);
    console.log(`   Status: ✅ EXISTS`);
    console.log(`   Size: ${stats.size} bytes`);
    console.log(`   Modified: ${stats.mtime.toISOString()}`);
    
    if (os.platform() !== 'win32') {
      console.log('   Execution Test: ⏭️ SKIPPED (not Windows)');
      resolve(true);
      return;
    }
    
    // Test if it can be executed
    console.log('\n   Testing execution (5 seconds)...');
    
    const proc = spawn(wasapiPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    let chunkCount = 0;
    let totalBytes = 0;
    
    proc.stdout.on('data', (data) => {
      chunkCount++;
      totalBytes += data.length;
    });
    
    proc.stderr.on('data', (data) => {
      console.log(`   STDERR: ${data.toString().trim()}`);
    });
    
    setTimeout(() => {
      proc.kill();
      console.log(`   Chunks received: ${chunkCount}`);
      console.log(`   Total bytes: ${totalBytes}`);
      console.log(`   Expected rate: ~50 chunks/5sec (4800 bytes each at 100ms)`);
      
      if (chunkCount >= 40 && chunkCount <= 60) {
        console.log(`   Status: ✅ WORKING CORRECTLY`);
        resolve(true);
      } else if (chunkCount > 0) {
        console.log(`   Status: ⚠️  WORKING (but rate may be off)`);
        resolve(true);
      } else {
        console.log(`   Status: ❌ NO OUTPUT - Check audio drivers`);
        resolve(false);
      }
    }, 5000);
  });
}

async function checkAudioDevices() {
  console.log('');
  console.log('🎤 AUDIO DEVICES');
  console.log('─'.repeat(60));
  
  if (os.platform() === 'win32') {
    try {
      const output = execSync(
        'powershell -Command "Get-CimInstance Win32_SoundDevice | Select-Object Name, Status | Format-Table -AutoSize"',
        { encoding: 'utf8', timeout: 10000 }
      );
      console.log(output);
    } catch (e) {
      console.log('   Could not query audio devices:', e.message);
    }
  } else {
    console.log('   Audio device check: ⏭️ SKIPPED (not Windows)');
  }
}

async function checkNetworkConnectivity() {
  console.log('');
  console.log('🌐 NETWORK CONNECTIVITY');
  console.log('─'.repeat(60));
  
  const hosts = [
    { name: 'EVIA Backend', host: 'backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io' },
    { name: 'Deepgram API', host: 'api.deepgram.com' }
  ];
  
  for (const { name, host } of hosts) {
    try {
      if (os.platform() === 'win32') {
        execSync(`ping -n 1 -w 3000 ${host}`, { encoding: 'utf8', timeout: 5000 });
      } else {
        execSync(`ping -c 1 -W 3 ${host}`, { encoding: 'utf8', timeout: 5000 });
      }
      console.log(`   ${name} (${host}): ✅ REACHABLE`);
    } catch (e) {
      console.log(`   ${name} (${host}): ❌ UNREACHABLE`);
    }
  }
}

async function checkDependencies() {
  console.log('');
  console.log('📦 DEPENDENCIES');
  console.log('─'.repeat(60));
  
  const deps = ['electron', 'keytar', 'ws'];
  
  for (const dep of deps) {
    try {
      const pkgPath = require.resolve(`${dep}/package.json`, { paths: [path.join(__dirname, '..')] });
      const pkg = require(pkgPath);
      console.log(`   ${dep}: ✅ v${pkg.version}`);
    } catch (e) {
      try {
        // Try from node_modules directly
        const pkgPath = path.join(__dirname, '..', 'node_modules', dep, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = require(pkgPath);
          console.log(`   ${dep}: ✅ v${pkg.version}`);
        } else {
          console.log(`   ${dep}: ❌ NOT FOUND`);
        }
      } catch (e2) {
        console.log(`   ${dep}: ❌ NOT FOUND`);
      }
    }
  }
}

async function printTestInstructions() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('═'.repeat(60));
  console.log('');
  console.log('🧪 NEXT STEPS FOR TESTING:');
  console.log('─'.repeat(60));
  console.log('1. Run the app in development mode:');
  console.log('   npm run dev');
  console.log('');
  console.log('2. Open DevTools in the Header window (F12)');
  console.log('');
  console.log('3. Click "Listen" to start recording');
  console.log('');
  console.log('4. In DevTools Console, check pipeline health:');
  console.log('   > window.eviaHealthCheck()');
  console.log('');
  console.log('   Expected output when healthy:');
  console.log('   {');
  console.log('     platform: "windows",');
  console.log('     sessionDuration: "30s",');
  console.log('     micChunks: 300,');
  console.log('     systemChunks: 300,');
  console.log('     healthy: true');
  console.log('   }');
  console.log('');
  console.log('5. Look for these console logs:');
  console.log('   - [Pipeline] 📊 Status: ... (every 100 chunks)');
  console.log('   - [AudioCapture] 📤 Sent MIC chunk #N');
  console.log('   - [AudioCapture] 🧹 Buffer maintenance: ...');
  console.log('');
  console.log('6. If stall occurs, check for:');
  console.log('   - [AudioCapture] 🪟 ... WebSocket STALE - AUTO-RECOVERY');
  console.log('   - [EviaBar] 🔄 Audio recovery triggered');
  console.log('');
  console.log('═'.repeat(60));
}

async function runDiagnostics() {
  await testWasapiHelper();
  await checkAudioDevices();
  await checkNetworkConnectivity();
  await checkDependencies();
  await printTestInstructions();
}

runDiagnostics().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
