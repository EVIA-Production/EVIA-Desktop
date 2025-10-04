// Create new file with full content
import { WS_BASE_URL } from '../config/config'; // Add if needed

interface WebSocketMessage {
  type?: string;
  command?: string;
  data?: {
    text?: string;
    speaker?: number | null;
    is_final?: boolean;
  } | string;
  content?: unknown;
  transcript?: string;
  suggestion?: string;
  error?: string;
}

function getBackendHttpBase(): string {
  const fromWin = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL;
  if (typeof fromWin === 'string' && fromWin.trim()) return String(fromWin).replace(/\/$/, '');
  return 'http://localhost:8000';
}

export async function getOrCreateChatId(backendUrl: string, token: string): Promise<string> {
  let chatId = localStorage.getItem('current_chat_id');
  if (chatId) {
    console.log('[Chat] Reusing existing chat id', chatId);
    return chatId;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`[Chat] Attempt ${attempt + 1} to create chat`);
      const res = await fetch(`${backendUrl}/chat/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      console.log('[Chat] Response status', res.status, res.type);
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Auth failed (401) - please re-login');
        }
        if (res.type === 'opaque') {
          throw new Error('CORS blocked request to backend');
        }
        throw new Error(`Chat create failed with status ${res.status}`);
      }
      const raw = await res.text();
      console.log('[Chat] Raw response', raw);
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.error('[Chat] JSON parse failed', err);
        throw new Error('Invalid JSON from chat create');
      }
      const newId = data?.id ?? data?.chat_id ?? data?.chatId;
      if (typeof newId !== 'number' || newId <= 0) {
        throw new Error(`Invalid chat id: ${JSON.stringify(data)}`);
      }
      chatId = String(newId);
      localStorage.setItem('current_chat_id', chatId);
      try { await (window as any).evia?.prefs?.set?.({ current_chat_id: chatId }); } catch {}
      console.log('[Chat] Created chat id', chatId);
      break;
    } catch (err) {
      console.error(`[Chat] Create failed attempt ${attempt + 1}`, err);
      if (attempt === 2) throw err instanceof Error ? err : new Error(String(err));
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  if (!chatId) throw new Error('Failed to create chat after retries');
  return chatId;
}

export class ChatWebSocket {
  private chatId: string;
  private source?: 'mic' | 'system';
  private ws: WebSocket | null = null;
  private isConnectedFlag: boolean = false;
  private lastAudioLevel: number = 0;
  private silenceThreshold: number = 0.01;
  private audioDetected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect: boolean = true;
  private queue: ArrayBuffer[] = [];

  constructor(chatId: string, source?: 'mic' | 'system') {
    this.chatId = chatId;
    this.source = source;
    console.log('ChatWebSocket initialized with chatId:', chatId);
  }

  async connect(attempt: number = 1): Promise<void> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.warn('WebSocket already connected');
        return;
      }
      const token = localStorage.getItem('auth_token') || '';
      if (!token) {
        console.error('[WS] Missing auth token. Please login.');
        return;
      }
      const backendUrl = getBackendHttpBase();
      const chatId = await getOrCreateChatId(backendUrl, token);
      if (!chatId) {
        console.error('[WS] Missing chat ID even after creation');
        return;
      }
      this.chatId = chatId;
      const sourceParam = this.source ? `&source=${this.source}` : '';
      // MUP FIX: Use backend URL, not location.host (which is Vite dev server in dev mode)
      const backendHttp = getBackendHttpBase();
      const wsBase = backendHttp.replace(/^http/, 'ws'); // http://localhost:8000 → ws://localhost:8000
      // TRANSCRIPTION FIX: Match audio capture sample rate (24kHz, not 16kHz default)
      const wsUrl = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}${sourceParam}&sample_rate=24000`;
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => reject(new Error('Connect timeout')), 10000);
        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.flushQueue();
          resolve();
        };
        this.ws.onclose = (event) => {
          console.log(`[WS] Closed: code=${event.code} reason=${event.reason}`);
          this.isConnectedFlag = false;
          this.connectionChangeHandlers.forEach(h => h(false));
          if (this.shouldReconnect) this.scheduleReconnect();
        };
        this.ws.onerror = (ev: Event) => {
          console.error('[WS] Error:', ev);
          this.isConnectedFlag = false;
          const errorMsg = (ev as ErrorEvent).message || 'Unknown error';
          reject(new Error(`WS Error: ${errorMsg}`));
        };
        this.ws.onmessage = (event) => {
          try {
            let payload: any = event.data;
            if (typeof payload === 'string') {
              payload = JSON.parse(payload);
            }
            this.messageHandlers.forEach(h => h(payload));
          } catch (e) {
            console.warn('[WS] Failed to parse message', e);
          }
        };
      });
    } catch (err: unknown) {
      if (attempt < 3 && err instanceof Error && err.message === 'Connect timeout') {
        const delay = 1000 * Math.pow(2, attempt-1);
        console.log(`[WS] Timeout, retry ${attempt} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        return this.connect(attempt+1);
      }
      throw err;
    }
  }

  private messageHandlers: ((message: WebSocketMessage) => void)[] = [];
  private connectionChangeHandlers: ((connected: boolean) => void)[] = [];

  sendMessage(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      console.log('Message sent:', message);
    } else {
      console.warn('WebSocket is not connected, cannot send message:', message);
    }
  }

  sendBinaryData(data: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.queue.push(data);
      return;
    }
    // Check audio levels in the buffer to detect audio
    const int16Data = new Int16Array(data);
    const audioLevel = this.calculateAudioLevel(int16Data);
    
    // Detect if audio is present
    const hasAudio = audioLevel > this.silenceThreshold;
    
    // Log when audio state changes (from silence to sound or vice versa)
    if (hasAudio && !this.audioDetected) {
      console.log(`[Audio Logger] Audio detected - Level: ${audioLevel.toFixed(4)}`);
      this.audioDetected = true;
    } else if (!hasAudio && this.audioDetected) {
      console.log(`[Audio Logger] Audio ended - Level dropped to ${audioLevel.toFixed(4)}`);
      this.audioDetected = false;
    }
    
    // Update last audio level
    this.lastAudioLevel = audioLevel;
    
    // Send the data
    this.ws.send(data);
    console.log(`[Audio Logger] Audio data sent - Size: ${data.byteLength} bytes, Level: ${audioLevel.toFixed(4)}`);
  }

  sendAudio(chunk: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    } else {
      console.warn('WS not open; queueing audio chunk');
      // Basic queue: for prod add proper buffering
      setTimeout(() => this.sendAudio(chunk), 100);
    }
  }

  // Calculate audio level (RMS) from int16 audio buffer
  private calculateAudioLevel(buffer: Int16Array): number {
    let sum = 0;
    // Calculate sum of squares
    for (let i = 0; i < buffer.length; i++) {
      // Normalize to range -1 to 1
      const sample = buffer[i] / 32767;
      sum += sample * sample;
    }
    // Return RMS (root mean square)
    return Math.sqrt(sum / buffer.length);
  }

  onMessage(handler: (message: WebSocketMessage) => void) {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    this.connectionChangeHandlers.push(handler);
    // Immediately call with current status
    handler(this.isConnectedFlag);
    return () => {
      this.connectionChangeHandlers = this.connectionChangeHandlers.filter(h => h !== handler);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 32000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnecting attempt ${this.reconnectAttempts}...`);
      this.connect();
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close(1000, 'User stopped');
      this.ws = null;
      this.isConnectedFlag = false;
      this.connectionChangeHandlers.forEach(h => h(false));
    }
  }

  isConnected(): boolean {
    return this.isConnectedFlag;
  }

  private flushQueue() {
    while (this.queue.length > 0) {
      this.ws!.send(this.queue.shift()!);
    }
  }
}

// Map to store WebSocket instances by chat ID
const wsInstances = new Map<string, ChatWebSocket>();

export const getWebSocketInstance = (chatId: string, source?: 'mic' | 'system'): ChatWebSocket => {
  const key = source ? `${chatId}:${source}` : chatId;
  if (wsInstances.has(key)) {
    return wsInstances.get(key)!;
  }
  const ws = new ChatWebSocket(chatId, source);
  wsInstances.set(key, ws);
  return ws;
};

export const closeWebSocketInstance = (chatId: string, source?: 'mic' | 'system') => {
  const key = source ? `${chatId}:${source}` : chatId;
  const ws = wsInstances.get(key);
  if (ws) {
    ws.disconnect();
    wsInstances.delete(key);
  }
};

export const closeAllWebSocketInstances = () => {
  wsInstances.forEach((ws, chatId) => {
    ws.disconnect();
    wsInstances.delete(chatId);
  });
};
