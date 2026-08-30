// Create new file with full content
import { BACKEND_URL, WS_BASE_URL } from '../config/config';
import {
  type AudioChunkMetadata,
  serializeAudioChunkMetaControlEnvelope,
} from '../../main/capture-timeline';

interface WebSocketMessage {
  type?: string;
  command?: string;
  language?: string; // For change_language command
  source?: 'mic' | 'system';
  sequence?: number;
  client_ts_ms?: number;
  data?: {
    dg_open?: boolean;
    text?: string;
    speaker?: number | null;
    is_final?: boolean;
    is_turn_complete?: boolean;
    source?: 'mic' | 'system';
    trace?: {
      provider_received_at_ms?: number;
      server_sent_at_ms?: number;
      activity_sequence?: number;
    };
  } | string;
  content?: unknown;
  transcript?: string;
  suggestion?: string;
  error?: string;
}

export type BinarySendResult = 'sent' | 'queued' | 'dropped';

type QueuedAudioChunk = {
  data: ArrayBuffer;
  metadata: AudioChunkMetadata;
};

function getBackendHttpBase(): string {
  return BACKEND_URL.replace(/\/$/, '');
}

export async function getOrCreateChatId(backendUrl: string, token: string, forceCreate: boolean = false): Promise<string> {
  let chatId = localStorage.getItem('current_chat_id');

  const int32Max = 2147483647;
  const validChatId = (value: unknown): string | null => {
    const normalized = String(value ?? '').trim();
    const numeric = Number(normalized);
    return normalized && normalized !== '0' && Number.isInteger(numeric) && numeric <= int32Max
      ? normalized
      : null;
  };

  chatId = validChatId(chatId);
  if (!chatId && localStorage.getItem('current_chat_id')) {
    console.log('[Chat] Removing invalid chat ID');
    localStorage.removeItem('current_chat_id');
  }
  
  if (forceCreate) {
    console.log('[Chat] Force creating new chat (forceCreate=true)');
    localStorage.removeItem('current_chat_id');
    chatId = null;
  }

  // Before minting a new chat, ask the SHARED store.
  //
  // localStorage is per window, and nine code paths delete this key. Every one
  // of those deletions used to become a brand new chat: in the 2026-08-13 call
  // capture was pinned to 1622 while other windows walked 1629 -> 0 -> 1641.
  // The transcript went to 1622 and Ask then asked about 1641, an empty chat -
  // which is why the answer read "Das Gespräch ist bereits beendet" in the
  // middle of a live call. It had no transcript to see, so it inferred there
  // was nothing left to say.
  //
  // `prefs` lives in the main process and is already written on every chat
  // creation, so it is the one view of "which chat is this call" that a window
  // reload or a stray removeItem cannot destroy.
  // Never on forceCreate: recreateChatId exists precisely to mint a new chat,
  // and adopting the old one here would silently defeat it.
  if (!forceCreate) {
    try {
      const shared = await (window as any).evia?.prefs?.get?.();
      // `prefs:get` returns `{ ok, data }`. Reading the envelope itself made
      // every child window miss the active call and mint its own chat.
      const sharedState = shared?.data ?? shared;
      const sharedHasChatId = Boolean(
        sharedState && Object.prototype.hasOwnProperty.call(sharedState, 'current_chat_id')
      );
      const sharedChatId = validChatId(sharedState?.current_chat_id);

      if (sharedChatId) {
        if (chatId && chatId !== sharedChatId) {
          console.warn(`[Chat] Replacing divergent local chat ${chatId} with shared active chat ${sharedChatId}`);
        }
        chatId = sharedChatId;
        localStorage.setItem('current_chat_id', chatId);
        console.log('[Chat] Adopted live chat id from shared prefs:', chatId);
        return chatId;
      }

      // An explicit null is a deliberate session boundary. Do not resurrect a
      // stale per-window key after Done, logout, language change, or a restart.
      if (sharedHasChatId) {
        localStorage.removeItem('current_chat_id');
        chatId = null;
      } else if (chatId) {
        await (window as any).evia?.prefs?.set?.({ current_chat_id: chatId });
        console.log('[Chat] Promoted local chat id into shared prefs:', chatId);
        return chatId;
      }
    } catch (error) {
      if (chatId) {
        console.warn('[Chat] Shared prefs unavailable; reusing valid local chat', error);
        return chatId;
      }
      console.warn('[Chat] Shared prefs unavailable; falling back to creation', error);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`[Chat] Attempt ${attempt + 1} to create chat`);
      
      // CRITICAL FIX: Get language from i18n and send to backend
      const { i18n } = await import('../i18n/i18n');
      const currentLang = i18n.getLanguage();
      console.log(`[Chat] Creating chat with language: ${currentLang}`);
      
      // Bounded, because an unbounded fetch is what made a bad connection cost
      // the rep the whole start.
      //
      // Measured in the user's audio-diagnostics.log 2026-08-21: two
      // "TypeError: Failed to fetch" failures at 23:25:05 and 23:25:16, and the
      // first working capture at 23:25:56. Fifty-one seconds. The three retries
      // here only add 1s + 2s of backoff, so the rest was fetch() sitting on a
      // dead socket until macOS gave up - the default is tens of seconds, and
      // the same session shows five PostHog resources dying
      // ERR_CONNECTION_CLOSED, so the connection was genuinely degraded.
      //
      // POST /chat/ is a small write against a warm container. Four seconds is
      // already far beyond its normal cost (measured: /health at 0.6-0.8 s cold
      // from this machine), so anything past it is a broken connection, not a
      // slow one. Failing fast lets capture start without the id - which it
      // now tolerates - instead of holding the microphone hostage.
      const res = await fetch(`${backendUrl}/chat/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: currentLang }),
        signal: AbortSignal.timeout(4000),
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

/**
 * End this chat everywhere, deliberately.
 *
 * `localStorage.removeItem('current_chat_id')` alone is no longer enough:
 * getOrCreateChatId falls back to the shared main-process prefs so that an
 * ACCIDENTAL loss of the key (a window reload, a socket close handler, an auth
 * resync) cannot fragment a live call across several chats. That fallback must
 * not outlive a session the user actually finished, or the next call would be
 * appended to the previous one. Deliberate endings - Done, language change,
 * logout, completing an orphaned session - clear both.
 */
export async function clearChatIdEverywhere(reason: string): Promise<void> {
  localStorage.removeItem('current_chat_id');
  try {
    await (window as any).evia?.prefs?.set?.({ current_chat_id: null });
    console.log(`[Chat] Cleared chat id from localStorage and shared prefs (${reason})`);
  } catch (error) {
    console.warn('[Chat] Could not clear shared prefs chat id', error);
  }
}

/** Replace a stale capture chat, bounded to one caller-controlled retry. */
export async function recreateChatId(backendUrl: string, token: string): Promise<string> {
  localStorage.removeItem('current_chat_id');
  return getOrCreateChatId(backendUrl, token, true);
}

export class ChatWebSocket {
  private chatId: string;
  private source?: 'mic' | 'system';
  private ws: WebSocket | null = null;
  private isConnectedFlag: boolean = false;
  private lastAudioLevel: number = 0;
  private silenceThreshold: number = 0.003;
  private audioDetected: boolean = false;
  private silentDurationMs: number = 0;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;
  private shouldReconnect: boolean = true;
  private queue: QueuedAudioChunk[] = [];
  private audioActivitySequence: number = 0;

  constructor(chatId: string, source?: 'mic' | 'system') {
    this.chatId = chatId;
    this.source = source;
    this.silenceThreshold = source === 'system' ? 0.0025 : 0.003;
    console.log('ChatWebSocket initialized with chatId:', chatId);
  }

  async connect(attempt: number = 1): Promise<void> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isConnectedFlag) {
        console.warn('WebSocket provider already ready');
        return;
      }

      if (this.connectPromise) {
        return this.connectPromise;
      }

      // An OPEN browser transport is not sufficient: the backend still has to
      // open and prime Deepgram. Never inherit a transport whose provider-ready
      // attempt already failed or timed out.
      if (
        this.ws &&
        (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
      ) {
        this.ws.close(1000, 'Replacing unready transport');
        this.ws = null;
      }
      
      this.shouldReconnect = true;

      // Get token from secure keytar storage (not localStorage!)
      console.log('[WS] Getting auth token from keytar...');
      const token = await (window.evia as any).auth.getToken();
      if (!token) {
        console.error('[WS] Missing auth token. Please login first.');
        throw new Error('Missing auth token. Please login first.');
      }
      
      // FIX: Check token validity before connecting
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
      // The socket owns the chat passed to its constructor. A reconnect is a
      // transport replacement inside the same capture session, never a reason
      // to consult mutable cross-window storage or move one speaker elsewhere.
      const chatId = this.chatId.trim();
      if (!chatId) {
        console.error('[WS] Missing constructor-bound chat ID');
        throw new Error('Missing constructor-bound chat ID');
      }
      const sourceParam = this.source ? `&source=${this.source}` : '';
      // FIX: Get current language from i18n for backend transcription
      const i18nModule = await import('../i18n/i18n');
      const currentLang = i18nModule.i18n.getLanguage() || 'de';
      const langParam = `&dg_lang=${currentLang}`;  // FIXED: dg_lang (not lang) for Deepgram
      console.log('[WS] 🌐 Connecting with language:', currentLang);
      
      // WINDOWS FIX (2025-11-28): Add platform query param for backend detection
      const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
      const platformParam = isWindows ? '&platform=windows' : '&platform=mac';
      console.log('[WS] Platform:', isWindows ? 'Windows' : 'Mac');
      
// MUP FIX: Use WS_BASE_URL from config (already http/ws protocol handled)
      const wsUrl = `${WS_BASE_URL}/ws/transcribe?chat_id=${encodeURIComponent(chatId)}&token=${encodeURIComponent(token)}${sourceParam}${langParam}${platformParam}&sample_rate=24000&capture_protocol=1`;
      const connectionAttempt = new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        this.ws = socket;
        socket.binaryType = 'arraybuffer';
        let settled = false;
        let providerReadyEver = false;
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const rejectOnce = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        const timeout = setTimeout(() => {
          if (
            socket.readyState === WebSocket.CONNECTING ||
            socket.readyState === WebSocket.OPEN
          ) {
            socket.close(1000, 'Provider ready timeout');
          }
          rejectOnce(new Error('Provider ready timeout'));
        }, 15000);
        socket.onopen = () => {
          console.log('[WS Debug] Transport open; waiting for Deepgram readiness:', this.chatId);
        };
        socket.onclose = (event) => {
          clearTimeout(timeout);
          console.log(`[WS] Closed: code=${event.code} reason=${event.reason}`);
          if (this.ws === socket) {
            this.ws = null;
          }
          const wasReady = this.isConnectedFlag || providerReadyEver;
          this.isConnectedFlag = false;
          this.emitLiveState(false);
          if (wasReady) {
            this.connectionChangeHandlers.forEach(h => h(false));
          }
          
          // Detect auth/not-found errors without deleting the session binding.
          // The capture owner may replace a genuinely stale chat during its one
          // bounded startup retry; a socket close cannot rebind half a call.
          if (event.code === 1008 || (event.code >= 4000 && event.code < 5000)) {
            console.error('[WS] Auth/not found error detected - chat may not exist');
          }

          if (!providerReadyEver) {
            rejectOnce(new Error(
              `WebSocket closed before provider ready (${event.code}): ${event.reason || 'no reason'}`
            ));
          } else if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };
        socket.onerror = (ev: Event) => {
          clearTimeout(timeout);
          console.error('[WS] Error:', ev);
          const wasReady = this.isConnectedFlag || providerReadyEver;
          this.isConnectedFlag = false;
          this.emitLiveState(false);
          if (wasReady) {
            this.connectionChangeHandlers.forEach(h => h(false));
          }
          const errorMsg = (ev as ErrorEvent).message || 'Unknown error';
          
          // CRITICAL FIX: Emit user-facing error notification
          this.emitErrorNotification(`Connection error: ${errorMsg}. Attempting to reconnect...`);

          rejectOnce(new Error(`WS Error: ${errorMsg}`));
        };
        socket.onmessage = (event) => {
          try {
            let payload: any = event.data;
            if (typeof payload === 'string') {
              payload = JSON.parse(payload);
            }

            const statusData = payload?.type === 'status' && typeof payload?.data === 'object'
              ? payload.data
              : null;
            if (statusData?.dg_open === true) {
              const becameReady = !this.isConnectedFlag;
              providerReadyEver = true;
              this.isConnectedFlag = true;
              this.emitLiveState(true);
              clearTimeout(timeout);
              if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
              }
              this.reconnectAttempts = 0;
              if (becameReady) {
                this.connectionChangeHandlers.forEach(h => h(true));
              }
              console.log('[WS Debug] Deepgram provider ready for chatId:', this.chatId);
              this.sendAudioActivity(this.audioDetected, true);
              this.flushQueue();
              resolveOnce();
            } else if (statusData?.dg_open === false) {
              const wasReady = this.isConnectedFlag;
              this.isConnectedFlag = false;
              this.emitLiveState(false);
              if (wasReady) {
                this.connectionChangeHandlers.forEach(h => h(false));
              }
            }

            if (payload?.type === 'error' && !providerReadyEver && !settled) {
              const detail = typeof payload?.data === 'string'
                ? payload.data
                : payload?.error || 'Deepgram provider startup failed';
              clearTimeout(timeout);
              rejectOnce(new Error(String(detail)));
              if (
                socket.readyState === WebSocket.CONNECTING ||
                socket.readyState === WebSocket.OPEN
              ) {
                socket.close(1000, 'Provider startup failed');
              }
            }
            this.messageHandlers.forEach((handler) => handler(payload));
          } catch (e) {
            console.error('[WS Debug] Failed to parse/handle message:', e, 'Raw:', event.data);
          }
        };
      });

      this.connectPromise = connectionAttempt;
      try {
        await connectionAttempt;
      } finally {
        if (this.connectPromise === connectionAttempt) {
          this.connectPromise = null;
        }
      }
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
  /**
   * Whether audio is actually reaching the server right now.
   *
   * Reported 2026-08-20: "Wenn die Transkription abbricht sieht man das nicht.
   * Es laeuft einfach weiter und sieht optisch so aus als wenn es aufnimmt, am
   * Ende fehlt aber das Transkript." The UI could not show the problem because
   * nothing ever told it - the socket knew, and kept it to itself. A rep who
   * can see the gap can repeat the sentence; one who cannot loses the call.
   */
  private liveHandlers: ((live: boolean) => void)[] = [];
  private lastLiveEmit: boolean | null = null;

  sendMessage(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      console.log('[WS] Control message sent:', message.command || message.type || 'unknown');
    } else {
      console.warn('[WS] WebSocket is not connected; control message was not sent:', message.command || message.type || 'unknown');
    }
  }

  private sendAudioActivity(active: boolean, force: boolean = false) {
    if (!force && active === this.audioDetected) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnectedFlag) return;

    this.audioActivitySequence += 1;
    this.ws.send(JSON.stringify({
      command: 'audio_activity',
      active,
      source: this.source || 'mic',
      sequence: this.audioActivitySequence,
      client_ts_ms: Date.now(),
    }));
  }

  sendAudioChunk(data: ArrayBuffer, metadata: AudioChunkMetadata): BinarySendResult {
    if (metadata.source !== this.source) {
      throw new Error(
        `Audio source mismatch: socket=${this.source || 'unset'} chunk=${metadata.source}`
      );
    }
    if (metadata.byte_length !== data.byteLength) {
      throw new Error(
        `Audio byte length mismatch: metadata=${metadata.byte_length} actual=${data.byteLength}`
      );
    }
    const chunkDurationMs = Math.max(0, metadata.capture_end_ms - metadata.capture_start_ms);

    // Check audio levels in the buffer to detect audio
    const int16Data = new Int16Array(data);
    const audioLevel = this.calculateAudioLevel(int16Data);
    
    // Detect if audio is present
    const hasAudio = audioLevel > this.silenceThreshold;
    
    // Preserve a short silence tail so provider endpointing receives the end of
    // an utterance. Activity markers carry no transcript/audio content.
    if (hasAudio) {
      this.silentDurationMs = 0;
      if (!this.audioDetected) {
      console.log(`[Audio Logger] Audio detected - Level: ${audioLevel.toFixed(4)}`);
      this.audioDetected = true;
        this.sendAudioActivity(true, true);
      }
    } else {
      this.silentDurationMs += chunkDurationMs;
      const HANGOVER_MS = 500;
      if (this.audioDetected && this.silentDurationMs > HANGOVER_MS) {
        console.log(`[Audio Logger] Audio ended - Level dropped to ${audioLevel.toFixed(4)}`);
        this.audioDetected = false;
        this.sendAudioActivity(false, true);
      }
    }
    
    // Update last audio level
    this.lastAudioLevel = audioLevel;

    // NO SILENCE SUPPRESSION. Every captured frame is transmitted.
    //
    // This used to drop any chunk whose RMS fell below `silenceThreshold` once
    // 500ms of "silence" had accumulated. The threshold is 0.003 for the mic,
    // and RMS here is normalised to 0..1, so the gate sat at -50.5 dBFS. In the
    // 2026-08-13 session the microphone measured -53, -55, -56, -57, -58 and
    // -59 dBFS across most telemetry windows: a normal speaking voice on a
    // MacBook Air's built-in mic lives BELOW that gate. The user's speech was
    // being classified as silence and deleted before it ever reached Deepgram.
    //
    // Three reported symptoms, one cause:
    //   - "only 10% was transcribed"  - quiet speech never left the machine
    //   - "everything in one bubble"  - Deepgram closes an utterance when it
    //     HEARS silence. Deleting the silence removes the endpointing cue, so
    //     words minutes apart arrive adjacent and merge into one utterance.
    //   - finals arriving 10-15s late  - the same missing endpoint.
    //
    // It also bought nothing: Deepgram streaming is billed by connection time,
    // not by bytes, so suppressing audio saved no money and cost the product
    // its transcript. A voice-activity decision belongs to the transcriber,
    // which has a real VAD; an amplitude threshold in the transport layer is
    // guessing at speech with the one signal that cannot distinguish a quiet
    // talker from an empty room.
    if (this.ws?.readyState !== WebSocket.OPEN || !this.isConnectedFlag) {
      // Queue speech and its short trailing context, but never let sustained
      // silence displace recoverable speech while a reconnect is in flight.
      this.queue.push({ data, metadata });
      // Hold the whole outage, not three seconds of it.
      //
      // Reported 2026-08-20: "am Ende fehlt aber das Transkript." Reconnecting
      // was never enough on its own - at 3 s, a twenty-second lift ride threw
      // away seventeen seconds of the prospect talking before the socket was
      // even back, so the gap was unrecoverable by the time it could be sent.
      //
      // This is the practical answer to "offline transcription": the audio does
      // not need to be transcribed locally, it needs to not be discarded. Two
      // minutes covers a lift, a tunnel or a wifi handover, and costs about
      // 4 MB - 16 kHz mono 16-bit is ~32 KB/s. The cap stays, because an
      // unbounded queue during a long outage would grow until the tab died.
      const MAX_QUEUED_AUDIO_MS = 120000;
      let queuedMs = this.queue.reduce(
        (total, item) => total + Math.max(0, item.metadata.capture_end_ms - item.metadata.capture_start_ms),
        0,
      );
      while (queuedMs > MAX_QUEUED_AUDIO_MS && this.queue.length > 0) {
        const dropped = this.queue.shift()!;
        queuedMs -= Math.max(0, dropped.metadata.capture_end_ms - dropped.metadata.capture_start_ms);
        console.warn(
          `[Audio Logger] Dropped stale queued ${dropped.metadata.source} chunk ` +
          `${dropped.metadata.capture_session_id}/${dropped.metadata.capture_generation}/${dropped.metadata.chunk_seq}`
        );
      }
      while (this.queue.length > 0 && queuedMs > MAX_QUEUED_AUDIO_MS) {
        this.queue.shift();
      }

      const socketNeedsReconnect =
        !this.ws ||
        this.ws.readyState === WebSocket.CLOSING ||
        this.ws.readyState === WebSocket.CLOSED;
      if (socketNeedsReconnect && !this.isConnectedFlag && this.shouldReconnect) {
        this.scheduleReconnect();
      }
      return 'queued';
    }
    
    this.sendChunkPair({ data, metadata });
    return 'sent';
  }

  /**
   * Legacy naked-PCM transport is deliberately rejected. Without capture
   * identity and a source-independent interval, provider offsets cannot be
   * mapped into dialogue order after silence suppression or reconnects.
   */
  sendBinaryData(_data: ArrayBuffer): BinarySendResult {
    throw new Error('sendBinaryData is unsupported; use sendAudioChunk with capture metadata');
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
    // Audio callbacks can arrive every ~100 ms while disconnected. Preserve
    // the first scheduled retry instead of postponing it on every chunk.
    if (this.reconnectTimer) return;

    // Retry for as long as the rep is still recording. Only Stop ends it.
    //
    // Reported 2026-08-20: "Bei instabilem Internet / kurzem Disconnect bricht
    // die Transkription ab." It did, permanently: ten attempts with backoff
    // capped at 32 s gave up after about three minutes and never tried again,
    // so a tunnel or a lift ended the transcript for the rest of the call. The
    // rep is still talking; there is no moment where the right answer is to
    // stop trying to record them.
    //
    // The cap is now on the DELAY, not on the number of attempts, so a long
    // outage costs one retry every 15 s instead of silence.
    const MAX_DELAY = 15000;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_DELAY);
    console.log(`[WS] 🔄 Scheduling reconnect attempt ${this.reconnectAttempts + 1} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      console.log(`[WS] Reconnecting attempt ${this.reconnectAttempts}...`);
      this.connect().catch(err => {
        console.error('[WS] Reconnect failed:', err);
        this.scheduleReconnect();
      });
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'User stopped');
      this.ws = null;
      this.isConnectedFlag = false;
      this.emitLiveState(false);
      this.connectionChangeHandlers.forEach(h => h(false));
    }
    this.queue = [];
    this.silentDurationMs = 0;
    this.audioDetected = false;
  }

  isConnected(): boolean {
    return this.isConnectedFlag;
  }

  private flushQueue() {
    while (
      this.ws?.readyState === WebSocket.OPEN &&
      this.isConnectedFlag &&
      this.queue.length > 0
    ) {
      this.sendChunkPair(this.queue.shift()!);
    }
  }

  private sendChunkPair(chunk: QueuedAudioChunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnectedFlag) {
      throw new Error('Cannot send audio chunk pair before the provider is ready');
    }
    // WebSocket preserves send order. Keeping both calls synchronous prevents
    // another callback from interleaving a control envelope and its PCM body.
    this.ws.send(serializeAudioChunkMetaControlEnvelope(chunk.metadata));
    this.ws.send(chunk.data);
  }
  
  // CRITICAL FIX: Error notification system for user feedback
  /** Fires on every transition between "audio is flowing" and "it is not". */
  onLiveStateChange(handler: (live: boolean) => void) {
    this.liveHandlers.push(handler);
    // Report the current truth immediately, so a late subscriber is not left
    // showing a stale green state.
    try { handler(this.isConnectedFlag); } catch { /* handler owns its errors */ }
    return () => {
      this.liveHandlers = this.liveHandlers.filter(h => h !== handler);
    };
  }

  private emitLiveState(live: boolean) {
    if (this.lastLiveEmit === live) return;
    this.lastLiveEmit = live;
    console.log(`[WS] ${live ? '🟢 audio is reaching the server' : '🔴 audio is NOT reaching the server'}`);
    this.liveHandlers.forEach(h => {
      try { h(live); } catch (err) { console.error('[WS] live-state handler failed:', err); }
    });
  }

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

/** The existing socket for this chat and source, or undefined. Never creates one.
 *
 * `getWebSocketInstance` constructs a socket when the key is missing, which is
 * correct for the capture pipeline that is about to connect it and wrong for
 * anything merely observing. The capture-live banner is an observer: it must
 * report on the socket the pipeline built, never bring a second one into
 * existence and subscribe to that instead.
 */
export const peekWebSocketInstance = (
  chatId: string,
  source?: 'mic' | 'system',
): ChatWebSocket | undefined => wsInstances.get(source ? `${chatId}:${source}` : chatId);

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

const normalizeTranscriptText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const areNearDuplicate = (a: string, b: string) => {
  const an = normalizeTranscriptText(a);
  const bn = normalizeTranscriptText(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  if (an.length > 20 && bn.length > 20 && (an.includes(bn) || bn.includes(an))) return true;
  return false;
};

export async function getChatTranscripts(chatId: number, token: string, limit: number = 50): Promise<TranscriptEntry[]> {
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
    
    // Defensive ordering in case backend/revision mismatch returns unsorted rows.
    const normalized = transcripts.map((t: any) => ({
      speaker: t.speaker ?? null,
      text: t.text || t.content || '',
      timestamp: t.timestamp,
      created_at: t.created_at,
    }));
    normalized.sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return ta - tb;
    });
    const deduped: TranscriptEntry[] = [];
    for (const item of normalized) {
      const text = (item.text || '').trim();
      if (!text) continue;
      if (/^(taylos|evia) connection ok$/i.test(text)) continue;
      const prev = deduped[deduped.length - 1];
      if (prev && prev.speaker === item.speaker && areNearDuplicate(prev.text, text)) {
        continue;
      }
      deduped.push({ ...item, text });
    }
    return deduped;
  } catch (error) {
    console.error('[Transcripts] ❌ Failed to fetch:', error);
    return []; // Return empty on error - graceful degradation
  }
}
