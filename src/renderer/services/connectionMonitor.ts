// Connection Monitor - Detects backend availability and manages offline mode
import { showToast } from '../components/ToastNotification';

export interface ConnectionStatus {
  isOnline: boolean;
  lastCheckTime: number;
  consecutiveFailures: number;
}

const CHECK_INTERVAL = 30000; // Check every 30 seconds
const MAX_RETRIES = 3;

class ConnectionMonitor {
  private status: ConnectionStatus = {
    isOnline: true,
    lastCheckTime: Date.now(),
    consecutiveFailures: 0
  };
  
  private listeners: ((status: ConnectionStatus) => void)[] = [];
  private checkTimer: NodeJS.Timeout | null = null;
  private wasOffline = false;

  start() {
    console.log('[ConnectionMonitor] Starting connection monitoring');
    this.checkConnection(); // Immediate check
    this.checkTimer = setInterval(() => this.checkConnection(), CHECK_INTERVAL);
  }

  stop() {
    console.log('[ConnectionMonitor] Stopping connection monitoring');
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private async checkConnection() {
    try {
      const backend = this.getBackendUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`${backend}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // Backend is online
        if (this.status.consecutiveFailures > 0) {
          console.log('[ConnectionMonitor] ✅ Backend back online');
          showToast('Connected to backend', 'success', 3000);
          this.wasOffline = false;
        }

        this.status = {
          isOnline: true,
          lastCheckTime: Date.now(),
          consecutiveFailures: 0
        };
      } else {
        throw new Error(`Health check failed: ${response.status}`);
      }
    } catch (error) {
      this.status.consecutiveFailures++;
      console.warn(`[ConnectionMonitor] Health check failed (${this.status.consecutiveFailures}/${MAX_RETRIES}):`, error);

      if (this.status.consecutiveFailures >= MAX_RETRIES && !this.wasOffline) {
        // Mark as offline
        this.status.isOnline = false;
        this.wasOffline = true;
        console.error('[ConnectionMonitor] ❌ Backend offline - entering offline mode');
        showToast('Backend offline - some features unavailable', 'warning', 10000);
      }

      this.status.lastCheckTime = Date.now();
    }

    // Notify listeners
    this.notifyListeners();
  }

  private getBackendUrl(): string {
    const fromWin = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL;
    if (typeof fromWin === 'string' && fromWin.trim()) return String(fromWin).replace(/\/$/, '');
    return 'http://localhost:8000';
  }

  private notifyListeners() {
    this.listeners.forEach(fn => fn(this.status));
  }

  subscribe(listener: (status: ConnectionStatus) => void) {
    this.listeners.push(listener);
    // Immediately notify with current status
    listener(this.status);
  }

  unsubscribe(listener: (status: ConnectionStatus) => void) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }
}

export const connectionMonitor = new ConnectionMonitor();

