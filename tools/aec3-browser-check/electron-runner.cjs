/**
 * Execute the browser check in the runtime production actually uses.
 *
 * Plain Chrome blocks file:// ES-module imports before application code runs.
 * Electron's BrowserWindow.loadFile is the packaged app path, so this runner
 * copies the production window's security settings and fails unless the page
 * reaches its explicit success line with no renderer errors.
 */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const CHECK_FILE = path.join(__dirname, 'dist', 'index.html');
const TIMEOUT_MS = 30_000;

async function run() {
  await app.whenReady();
  const errors = [];
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
    },
  });

  win.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') errors.push(details.message);
  });
  await win.loadFile(CHECK_FILE);

  const deadline = Date.now() + TIMEOUT_MS;
  let output = '';
  while (Date.now() < deadline) {
    output = await win.webContents.executeJavaScript(
      "document.getElementById('out')?.innerText || ''",
      true,
    );
    if (output.includes('AEC3 loads and cancels in the renderer environment.') || output.includes('FAILED:')) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  process.stdout.write(`${output}\n`);
  if (!output.includes('AEC3 loads and cancels in the renderer environment.')) {
    throw new Error(output.includes('FAILED:') ? 'renderer check reported failure' : 'renderer check timed out');
  }
  if (errors.length) {
    throw new Error(`renderer emitted console errors:\n${errors.join('\n')}`);
  }

  win.destroy();
  app.quit();
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  app.exit(1);
});
