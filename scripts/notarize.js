#!/usr/bin/env node

const path = require('path');
const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Allow CI to skip notarization for fast internal builds.
  const notarizeEnabled = String(process.env.NOTARIZE_ENABLED || 'true').toLowerCase();
  if (notarizeEnabled === 'false' || notarizeEnabled === '0' || notarizeEnabled === 'no') {
    console.log('[notarize] Skipping notarization - NOTARIZE_ENABLED=false');
    return;
  }

  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] Skipping notarization - missing APPLE_ID/APPLE_ID_PASSWORD/APPLE_TEAM_ID');
    return;
  }

  const timeoutMinutesRaw = Number(process.env.NOTARIZE_TIMEOUT_MINUTES || '180');
  const timeoutMinutes = Number.isFinite(timeoutMinutesRaw) && timeoutMinutesRaw > 0 ? timeoutMinutesRaw : 180;
  const timeoutMs = timeoutMinutes * 60 * 1000;

  console.log('[notarize] Notarizing app:', appPath);
  await Promise.race([
    notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    }),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`[notarize] Timed out after ${timeoutMinutes} minutes (set NOTARIZE_TIMEOUT_MINUTES to adjust).`));
      }, timeoutMs);
    }),
  ]);
  console.log('[notarize] Notarization complete');
};
