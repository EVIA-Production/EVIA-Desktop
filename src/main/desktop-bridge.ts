import http from 'http';
import { Server as WebSocketServer, WebSocket } from 'ws';
import { app, shell, BrowserWindow } from 'electron';
import { exec } from 'child_process';

const PORT = 17394; // EVIA on phone pad
const HOST = '127.0.0.1';

/**
 * Activate the default browser without opening a new tab
 * Tries common browsers in order of popularity
 * WINDOWS FIX (2025-12-05): Added Windows support for browser activation
 */
function activateBrowser(): void {
  if (process.platform === 'darwin') {
    // Try to activate common browsers - doesn't open new tab, just brings to front
    exec('open -a Arc 2>/dev/null || open -a "Google Chrome" 2>/dev/null || open -a Safari 2>/dev/null || open -a Firefox 2>/dev/null || open -a "Microsoft Edge" 2>/dev/null || true', (err) => {
      if (err) {
        console.log('[Bridge] ⚠️ Could not activate browser (non-fatal)');
      } else {
        console.log('[Bridge] 🪟 Activated browser (macOS)');
      }
    });
  } else if (process.platform === 'win32') {
    // WINDOWS FIX: Try to activate browser window using PowerShell
    // This brings the browser to foreground without opening a new tab
    // Try common browsers: Edge (default on Win11), Chrome, Firefox, Brave
    const command = `
      powershell -Command "
        $browsers = @('msedge', 'chrome', 'firefox', 'brave');
        foreach ($browser in $browsers) {
          $proc = Get-Process -Name $browser -ErrorAction SilentlyContinue | Select-Object -First 1;
          if ($proc) {
            Add-Type @'
              using System;
              using System.Runtime.InteropServices;
              public class WinAPI {
                [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);
                [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
              }
'@;
            [WinAPI]::ShowWindow($proc.MainWindowHandle, 9);
            [WinAPI]::SetForegroundWindow($proc.MainWindowHandle);
            Write-Host 'Activated:' $browser;
            break;
          }
        }
      "
    `.trim().replace(/\n/g, ' ');
    
    exec(command, (err, stdout, stderr) => {
      if (err) {
        console.log('[Bridge] ⚠️ Could not activate browser on Windows (non-fatal):', stderr);
      } else {
        console.log('[Bridge] 🪟 Activated browser (Windows):', stdout.trim());
      }
    });
  }
  // On Linux, we can't easily activate without opening URL
  // User will need to switch manually
}

class DesktopBridge {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private activeClients: Set<WebSocket> = new Set();

  constructor() {
    // Lazy start
  }

  public start() {
    if (this.httpServer) return; // Already running
    this.startServer();
  }

  private startServer() {
    try {
      // HTTP Server for status checks (CORS enabled)
      this.httpServer = http.createServer((req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.url === '/status' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            status: 'running',
            version: app.getVersion(),
            platform: process.platform
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      // WebSocket Server for tab communication
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws: WebSocket) => {
        console.log('[Bridge] 🔗 Frontend tab connected');
        this.activeClients.add(ws);

        // WINDOWS FIX (2025-12-05): Send desktop_open status immediately on connection
        // This allows the frontend to update "EVIA Desktop öffnen" button to reflect connection
        try {
          ws.send(JSON.stringify({ 
            type: 'status', 
            desktop_open: true, 
            platform: process.platform,
            version: require('electron').app.getVersion()
          }));
          console.log('[Bridge] 📡 Sent desktop_open status to frontend');
        } catch (err) {
          console.warn('[Bridge] ⚠️ Failed to send status:', err);
        }

        ws.on('close', () => {
          console.log('[Bridge] ❌ Frontend tab disconnected');
          this.activeClients.delete(ws);
        });

        ws.on('error', (err: Error) => {
          console.error('[Bridge] ⚠️ WebSocket error:', err);
        });
      });

      this.httpServer.listen(PORT, HOST, () => {
        console.log(`[Bridge] 🌉 Server running at http://${HOST}:${PORT}`);
      });

      this.httpServer.on('error', (err) => {
        console.error('[Bridge] ❌ Server error:', err);
      });
      
      // WINDOWS FIX (2025-12-05): Periodic ping to keep connections alive
      // Browsers may close stale WebSocket connections, so send heartbeat
      setInterval(() => {
        for (const client of this.activeClients) {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.ping();
            } catch (err) {
              console.warn('[Bridge] ⚠️ Failed to ping client:', err);
              this.activeClients.delete(client);
            }
          } else if (client.readyState !== WebSocket.CONNECTING) {
            // Connection is closed, remove it
            console.log('[Bridge] 🧹 Removing stale connection');
            this.activeClients.delete(client);
          }
        }
      }, 30000); // Every 30 seconds
      
    } catch (err) {
      console.error('[Bridge] ❌ Failed to start bridge:', err);
    }
  }

  /**
   * Navigates existing tab or opens new one
   * Uses WS for tab reuse, activates browser without opening new tab
   */
  public async navigateTo(url: string): Promise<void> {
    console.log(`[Bridge] 🧭 Requesting navigation to: ${url}`);
    console.log(`[Bridge] 📊 Active clients: ${this.activeClients.size}`);

    // WINDOWS FIX (2025-12-05): Better logging and connection checking
    if (this.activeClients.size > 0) {
      // Check for any open connection
      let openClient: WebSocket | null = null;
      
      for (const client of this.activeClients) {
        console.log(`[Bridge] 📊 Client state: ${client.readyState} (OPEN=${WebSocket.OPEN})`);
        if (client.readyState === WebSocket.OPEN) {
          openClient = client;
          break;
        }
      }
      
      if (openClient) {
        console.log('[Bridge] 📡 Sending navigation command to existing tab');
        openClient.send(JSON.stringify({ type: 'navigate', url }));
        
        // Activate the browser WITHOUT opening a new tab
        // Small delay to let WS message arrive first
        setTimeout(() => {
          activateBrowser();
        }, 100);
        return;
      } else {
        console.log('[Bridge] ⚠️ No open clients found, cleaning up stale connections');
        this.activeClients.clear();
      }
    }

    // No active clients, open new tab (this is the only case where we open a new tab)
    console.log('[Bridge] 📂 No active tabs, opening new window');
    await shell.openExternal(url);
  }

  public stop() {
    this.wss?.close();
    this.httpServer?.close();
  }
}

export const desktopBridge = new DesktopBridge();

