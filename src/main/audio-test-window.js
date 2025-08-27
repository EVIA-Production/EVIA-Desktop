/**
 * EVIA Desktop - Audio Test Window Manager
 * Creates and manages the audio test window
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

/**
 * Create and open the audio test window
 */
function createAudioTestWindow() {
  // Create the browser window
  const testWindow = new BrowserWindow({
    width: 800,
    height: 800,
    title: 'EVIA Audio Test',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Load the audio test HTML file
  const audioTestPath = url.format({
    pathname: path.join(__dirname, '../renderer/audio-test.html'),
    protocol: 'file:',
    slashes: true
  });
  
  testWindow.loadURL(audioTestPath);
  
  // Open DevTools in development mode
  if (process.env.EVIA_DEV) {
    testWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
  // Handle window close
  testWindow.on('closed', () => {
    console.log('Audio test window closed');
  });
  
  return testWindow;
}

module.exports = {
  createAudioTestWindow
};
