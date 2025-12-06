// Create new file with full content
import { BACKEND_URL, WS_BASE_URL } from '../config/config';

interface WebSocketMessage {
  type?: string;
  command?: string;
  language?: string; // For change_language command
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
  return BACKEND_URL.replace(/\/$/, '');
}

export async function getOrCreateChatId(backendUrl: string, token: string, forceCreate: boolean = false): Promise<string> {
  let chatId = localStorage.getItem('current_chat_id');

  // somehow i had an invalid chatid (over int32 large)
  const int32Max = 2147483647;
  if (chatId && (!Number.isInteger(Number(chatId)) || Number(chatId) > int32Max)){
    console.log("[Chat] Removing excesively large chatID")
    localStorage.removeItem('current_chad_id');
    chatId = null;
  } else if (chatId && !forceCreate) {
    console.log('[Chat] Reusing existing chat id', chatId);
    return chatId;
  }
  
  if (forceCreate) {
    console.log('[Chat] Force creating new chat (forceCreate=true)');
    localStorage.removeItem('current_chat_id');
    chatId = null;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`[Chat] Attempt ${attempt + 1} to create chat`);
      
      // 🔥 CRITICAL FIX: Get language from i18n and send to backend
      const { i18n } = await import('../i18n/i18n');
      const currentLang = i18n.getLanguage();
      console.log(`[Chat] Creating chat with language: ${currentLang}`);
      
      const res = await fetch(`${backendUrl}/chat/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: currentLang }),
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
      
      // 🔐 Get token from secure keytar storage (not localStorage!)
      console.log('[WS] Getting auth token from keytar...');
      const token = await (window.evia as any).auth.getToken();
      if (!token) {
        console.error('[WS] Missing auth token. Please login first.');
        return;
      }
      
      // 🔧 FIX: Check token validity before connecting
      const validity = await (window.evia as any).auth.checkTokenValidity();
      if (!validity.valid) {
        console.error('[WS] ❌ Token invalid:', validity.reason);
        // Signal to UI that re-authentication is needed
        throw new Error(`Token invalid: ${validity.reason}. Please re-login.`);
      }
      if (validity.reason === 'expiring_soon') {
        console.warn('[WS] ⚠️ Token expires in', validity.expiresIn, 'seconds - consider refresh');
      }
      
      console.log('[WS] ✅ Got auth token (length:', token.length, 'chars)');
      const backendUrl = getBackendHttpBase();
      const chatId = await getOrCreateChatId(backendUrl, token);
      if (!chatId) {
        console.error('[WS] Missing chat ID even after creation');
        return;
      }
      this.chatId = chatId;
      const sourceParam = this.source ? `&source=${this.source}` : '';
      // 🔧 FIX: Get current language from i18n for backend transcription
      const i18nModule = await import('../i18n/i18n');
      const currentLang = i18nModule.i18n.getLanguage() || 'de';
      const langParam = `&dg_lang=${currentLang}`;  // 🎯 FIXED: dg_lang (not lang) for Deepgram
      console.log('[WS] 🌐 Connecting with language:', currentLang);
      
      // WINDOWS FIX (2025-11-28): Add platform query param for backend detection
      const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
      const platformParam = isWindows ? '&platform=windows' : '&platform=mac';
      console.log('[WS] Platform:', isWindows ? 'Windows' : 'Mac');
      
// MUP FIX: Use WS_BASE_URL from config (already http/ws protocol handled)
      const wsUrl = `${WS_BASE_URL}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}${sourceParam}${langParam}${platformParam}&sample_rate=24000`;
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';
        const timeout = setTimeout(() => reject(new Error('Connect timeout')), 10000);
        this.ws.onopen = () => {
          console.log('[WS Debug] Connected for chatId:', this.chatId, 'URL:', wsUrl);
          clearTimeout(timeout);
          this.isConnectedFlag = true;
          this.connectionChangeHandlers.forEach(h => h(true));
          this.flushQueue();
          resolve();
        };
        this.ws.onclose = (event) => {
          console.log(`[WS] Closed: code=${event.code} reason=${event.reason}`);
          this.isConnectedFlag = false;
          this.connectionChangeHandlers.forEach(h => h(false));
          
          // 🔧 FIX: Detect auth/not found errors (close code 1008 = policy violation, 4xxx = app errors)
          if (event.code === 1008 || (event.code >= 4000 && event.code < 5000)) {
            console.error('[WS] Auth/not found error detected - chat may not exist');
            // Clear invalid chat_id and signal for recreation
            localStorage.removeItem('current_chat_id');
            // Still schedule reconnect - the ensureMicWs/ensureSystemWs will handle recreation
          }
          
          if (this.shouldReconnect) this.scheduleReconnect();
        };
        this.ws.onerror = (ev: Event) => {
          console.error('[WS] Error:', ev);
          this.isConnectedFlag = false;
          const errorMsg = (ev as ErrorEvent).message || 'Unknown error';
          
          // 🔥 CRITICAL FIX: Emit user-facing error notification
          this.emitErrorNotification(`Connection error: ${errorMsg}. Attempting to reconnect...`);
          
          reject(new Error(`WS Error: ${errorMsg}`));
        };
        this.ws.onmessage = (event) => {
          try {
            let payload: any = event.data;
            console.log('[WS Debug] Raw message received:', typeof payload, payload);
            if (typeof payload === 'string') {
              payload = JSON.parse(payload);
              console.log('[WS Debug] Parsed payload:', payload);
            }
            console.log('[WS Debug] Invoking', this.messageHandlers.length, 'handlers for message type:', payload?.type);
            this.messageHandlers.forEach((h, idx) => {
              console.log('[WS Debug] Calling handler', idx);
              h(payload);
            });
          } catch (e) {
            console.error('[WS Debug] Failed to parse/handle message:', e, 'Raw:', event.data);
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
  private errorNotificationHandlers: ((error: string) => void)[] = [];

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
    console.log('[WS Debug] Registering message handler for chatId:', this.chatId, 'Total handlers after:', this.messageHandlers.length + 1);
    this.messageHandlers.push(handler);
    return () => {
      console.log('[WS Debug] Unregistering message handler for chatId:', this.chatId, 'Total handlers before:', this.messageHandlers.length);
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
    
    // 🔥 CRITICAL FIX: Cap exponential backoff at 32 seconds + max 10 attempts
    const MAX_RECONNECT_ATTEMPTS = 10;
    const MAX_DELAY = 32000;
    
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WS] ❌ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
      this.emitErrorNotification('Connection lost. Please check your network and restart recording.');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_DELAY);
    console.log(`[WS] 🔄 Scheduling reconnect attempt ${this.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`[WS] Reconnecting attempt ${this.reconnectAttempts}...`);
      this.connect().catch(err => {
        console.error('[WS] Reconnect failed:', err);
        // scheduleReconnect will be called again by onclose handler
      });
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
  
  // 🔥 CRITICAL FIX: Error notification system for user feedback
  onErrorNotification(handler: (error: string) => void) {
    this.errorNotificationHandlers.push(handler);
    return () => {
      this.errorNotificationHandlers = this.errorNotificationHandlers.filter(h => h !== handler);
    };
  }
  
  private emitErrorNotification(error: string) {
    console.error('[WS] 🚨 Error notification:', error);
    this.errorNotificationHandlers.forEach(h => {
      try {
        h(error);
      } catch (err) {
        console.error('[WS] Error notification handler failed:', err);
      }
    });
  }
}

// Map to store WebSocket instances by chat ID
const wsInstances = new Map<string, ChatWebSocket>();

export const getWebSocketInstance = (chatId: string, source?: 'mic' | 'system'): ChatWebSocket => {
  const key = source ? `${chatId}:${source}` : chatId;
  console.log('[WS Instance] Getting for key:', key, 'Existing:', wsInstances.has(key), 'Total instances:', wsInstances.size);
  if (wsInstances.has(key)) {
    const existing = wsInstances.get(key)!;
    console.log('[WS Instance] Reusing existing instance for key:', key);
    return existing;
  }
  console.log('[WS Instance] Creating NEW instance for key:', key);
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

/**
 * 🔧 GLASS PARITY: Fetch chat transcripts for Ask context
 * Backend stores final transcripts in DB, we fetch them for context
 */
export interface TranscriptEntry {
  speaker: number | null;
  text: string;
  timestamp?: number;
  created_at?: string;
}

export async function getChatTranscripts(chatId: number, token: string, limit: number = 30): Promise<TranscriptEntry[]> {
  try {
    const backendUrl = getBackendHttpBase();
    console.log('[Transcripts] 📄 Fetching last', limit, 'transcripts for chat:', chatId);
    
    const res = await fetch(`${backendUrl}/chat/${chatId}/transcripts/?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!res.ok) {
      if (res.status === 404) {
        console.log('[Transcripts] ⚠️ Chat not found or no transcripts yet');
        return [];
      }
      throw new Error(`Transcript fetch failed: HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const transcripts = Array.isArray(data) ? data : (data.transcripts || []);
    console.log('[Transcripts] ✅ Fetched', transcripts.length, 'transcripts');
    
    return transcripts.map((t: any) => ({
      speaker: t.speaker ?? null,
      text: t.text || t.content || '',
      timestamp: t.timestamp,
      created_at: t.created_at,
    }));
  } catch (error) {
    console.error('[Transcripts] ❌ Failed to fetch:', error);
    return []; // Return empty on error - graceful degradation
  }
}
