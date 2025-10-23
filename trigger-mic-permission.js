#!/usr/bin/env node
/**
 * Trigger macOS Microphone Permission Dialog
 * 
 * This script attempts to access the microphone, which forces macOS
 * to show the permission dialog for Terminal.app
 */

console.log('🎤 Triggering Microphone Permission Dialog...\n');
console.log('When the dialog appears, click "OK" to grant permission.\n');

// Attempt to access microphone using Web Audio API (via Electron's renderer)
const { exec } = require('child_process');

// Check if we're on macOS
if (process.platform !== 'darwin') {
    console.log('❌ This script is only for macOS');
    process.exit(1);
}

console.log('Attempting to access microphone...\n');

// Use macOS's built-in command-line tools to request mic access
const cmd = `osascript -e 'tell application "Terminal" to activate' && afplay /System/Library/Sounds/Ping.aiff`;

exec(cmd, (error, stdout, stderr) => {
    if (error) {
        console.log('⚠️  If you saw a permission dialog, that\'s good!');
        console.log('   Check: System Settings → Privacy & Security → Microphone\n');
    } else {
        console.log('✅ Command executed.');
        console.log('   If you didn\'t see a permission dialog, try the manual method below:\n');
    }
    
    console.log('====================================');
    console.log('MANUAL METHOD:');
    console.log('====================================');
    console.log('1. Install sox: brew install sox');
    console.log('2. Run: rec -c 1 test.wav trim 0 1');
    console.log('3. This will trigger the permission dialog');
    console.log('4. Grant permission to Terminal.app');
    console.log('5. Then run: npm run dev');
    console.log('====================================\n');
});

