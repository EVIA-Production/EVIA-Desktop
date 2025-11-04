#!/usr/bin/env node

/**
 * electron-builder afterPack hook
 * 
 * This script runs after electron-builder packs the app but before signing.
 * It ensures SystemAudioDump binary is:
 * 1. Executable
 * 2. Signed with entitlements so it can request Screen Recording permission
 * 
 * This is CRITICAL for system audio capture to work!
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

exports.default = async function(context) {
  const { appOutDir, packager } = context;
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔧 afterPack: Signing SystemAudioDump binary');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Only run on macOS builds
  if (packager.platform.name !== 'mac') {
    console.log('⏭️  Skipping: Not a macOS build');
    return;
  }
  
  // Paths
  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
  const systemAudioDumpPath = path.join(
    appPath,
    'Contents/Resources/app.asar.unpacked/src/main/assets/SystemAudioDump'
  );
  const entitlementsPath = path.join(__dirname, '../build/entitlements.mac.plist');
  
  console.log('📂 App path:', appPath);
  console.log('📂 SystemAudioDump path:', systemAudioDumpPath);
  console.log('📂 Entitlements path:', entitlementsPath);
  console.log('');
  
  // Step 1: Verify SystemAudioDump exists
  if (!fs.existsSync(systemAudioDumpPath)) {
    console.error('❌ SystemAudioDump binary NOT found!');
    console.error('   Expected at:', systemAudioDumpPath);
    console.error('   This will cause system audio capture to fail!');
    throw new Error('SystemAudioDump binary missing');
  }
  
  console.log('✅ SystemAudioDump binary found');
  
  // Step 2: Make executable
  try {
    fs.chmodSync(systemAudioDumpPath, 0o755);
    console.log('✅ Made SystemAudioDump executable (chmod 755)');
  } catch (error) {
    console.error('❌ Failed to make SystemAudioDump executable:', error.message);
    throw error;
  }
  
  // Step 3: Remove quarantine (if present)
  try {
    execSync(`xattr -cr "${systemAudioDumpPath}"`, { stdio: 'ignore' });
    console.log('✅ Removed quarantine attribute');
  } catch (error) {
    // Not fatal - might not have quarantine attribute
    console.log('ℹ️  No quarantine attribute to remove (this is normal)');
  }
  
  // Step 4: Ad-hoc sign with entitlements
  try {
    console.log('🔐 Signing SystemAudioDump with entitlements...');
    
    const signCommand = `codesign --force --deep --sign - --entitlements "${entitlementsPath}" "${systemAudioDumpPath}"`;
    
    console.log('   Command:', signCommand);
    execSync(signCommand, { stdio: 'pipe' });
    
    console.log('✅ SystemAudioDump signed with entitlements');
  } catch (error) {
    console.error('❌ Failed to sign SystemAudioDump:', error.message);
    console.error('   System audio capture may not work!');
    throw error;
  }
  
  // Step 5: Verify signature
  try {
    const verifyOutput = execSync(`codesign -dv --entitlements - "${systemAudioDumpPath}" 2>&1`, { 
      encoding: 'utf8' 
    });
    console.log('✅ Signature verified');
    console.log('   Details:', verifyOutput.split('\n')[0]);
  } catch (error) {
    console.warn('⚠️  Could not verify signature, but this may be OK');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ afterPack: SystemAudioDump ready for permissions!');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('📋 What this means for users:');
  console.log('   1. When they first press "Listen", EVIA will request Screen Recording');
  console.log('   2. Then SystemAudioDump will request Screen Recording again');
  console.log('   3. Both permissions are needed for system audio capture');
  console.log('   4. This is normal and expected!');
  console.log('');
};

