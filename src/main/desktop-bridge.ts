import http from 'http';
import { Server as WebSocketServer, WebSocket } from 'ws';
import { app, shell, BrowserWindow } from 'electron';
import { exec } from 'child_process';

const PORT = 17394; // EVIA on phone pad
const HOST = '127.0.0.1';

/**
 * Activate the default browser without opening a new tab
 * Tries common browsers in order of popularity
 */
function activateBrowser(): void {
  if (process.platform === 'darwin') {
    // Try to activate common browsers - doesn't open new tab, just brings to front
    exec('open -a Arc 2>/dev/null || open -a "Google Chrome" 2>/dev/null || open -a Safari 2>/dev/null || open -a Firefox 2>/dev/null || open -a "Microsoft Edge" 2>/dev/null || true', (err) => {
      if (err) {
        console.log('[Bridge] ⚠️ Could not activate browser (non-fatal)');
      } else {
        console.log('[Bridge] 🪟 Activated browser');
      }
    });
  }
  // On Windows/Linux, we can't easily activate without opening URL
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

    if (this.activeClients.size > 0) {
      // We have connected tabs! Send navigation command to the most recent one
      const client = [...this.activeClients].pop(); // Get last connected
      if (client && client.readyState === WebSocket.OPEN) {
        console.log('[Bridge] 📡 Sending navigation command to existing tab');
        client.send(JSON.stringify({ type: 'navigate', url }));
        
        // Activate the browser WITHOUT opening a new tab
        // Small delay to let WS message arrive first
        setTimeout(() => {
          activateBrowser();
        }, 100);
        return;
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

