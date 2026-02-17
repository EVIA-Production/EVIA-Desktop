#!/usr/bin/env node

const path = require('path');
const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
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

  console.log('[notarize] Notarizing app:', appPath);
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log('[notarize] Notarization complete');
};
