import { BrowserWindow, ipcMain } from "electron";
// Provide a dedicated lightweight WebSocket wrapper for main process to decouple from renderer-only code & localStorage usage.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeWS = require("ws");

type Source = "mic" | "system";

interface ManagerWsMessage {
  type?: string;
  data?: any;
}

class ManagerWebSocket {
  private url: string;
  private ws: any = null;
  private openPromise: Promise<void> | null = null;
  private messageHandlers: ((msg: ManagerWsMessage) => void)[] = [];
  private source: Source;
  constructor(url: string, source: Source) {
    this.url = url;
    this.source = source;
  }
  connect(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new NodeWS(this.url, { handshakeTimeout: 10000 });
      } catch (e) {
        return reject(e);
      }
      const timeout = setTimeout(
        () => reject(new Error("WS connect timeout: " + this.url)),
        12000
      );
      this.ws.on("open", () => {
        clearTimeout(timeout);
        console.log(
          `[transcriptionManager] ${this.source} WebSocket open -> ${this.url}`
        );
        resolve();
      });
      this.ws.on("message", (raw: any) => {
        let parsed: any = raw;
        if (typeof raw === "string") {
          try {
            parsed = JSON.parse(raw);
          } catch {}
        }
        // Simple focused log: show first receipt of backend transcript-like payloads
        try {
          if (parsed && typeof parsed === "object") {
            if (parsed.type === "transcript_segment" && parsed.data?.text) {
              console.log(
                `[transcriptionManager][in:${
                  this.source
                }] segment text="${String(parsed.data.text).slice(
                  0,
                  120
                )}" final=${parsed.data.is_final ?? parsed.data.final ?? false}`
              );
            } else if (parsed.type === "status" && parsed.data?.echo_text) {
              console.log(
                `[transcriptionManager][in:${
                  this.source
                }] echo interim="${String(parsed.data.echo_text).slice(
                  0,
                  120
                )}" final=${parsed.data.final ?? false}`
              );
            }
          }
        } catch {}
        this.messageHandlers.forEach((h) => h(parsed));
      });
      this.ws.on("error", (err: any) => {
        console.error(
          `[transcriptionManager] ${this.source} WS error:`,
          err?.message || err
        );
      });
      this.ws.on("close", (code: number, reason: any) => {
        console.warn(
          `[transcriptionManager] ${this.source} WS closed code=${code} reason=${reason}`
        );
      });
    });
    return this.openPromise;
  }
  onMessage(handler: (msg: ManagerWsMessage) => void) {
    this.messageHandlers.push(handler);
  }
  sendBinary(buffer: ArrayBuffer | Buffer) {
    if (!this.ws || this.ws.readyState !== 1) return false; // 1 = OPEN
    try {
      this.ws.send(buffer);
      return true;
    } catch (e) {
      console.error(
        `[transcriptionManager] sendBinary failed for ${this.source}`,
        e
      );
      return false;
    }
  }
}

/**
 * Central transcription manager: opens exactly one mic and one system WebSocket
 * (per chat) in the main process context and broadcasts transcript + status
 * events to all renderer windows via ipc channel 'transcript:event'.
 */
class TranscriptionManager {
  private chatId: string | null = null;
  private micWs: ManagerWebSocket | null = null;
  private sysWs: ManagerWebSocket | null = null;
  private initialized = false;
  private connecting = false;
  private micHadFrame = false;
  private sysHadFrame = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  async ensure(chatId: string, token: string) {
    if (this.initialized) {
      console.log(
        "[transcriptionManager] ensure called but already initialized; ignoring"
      );
      return;
    }
    if (this.connecting) {
      console.log(
        "[transcriptionManager] ensure called while connecting; ignoring"
      );
      return;
    }
    this.connecting = true;
    this.chatId = chatId;
    try {
      const backendBase = (
        process.env.EVIA_BACKEND_URL ||
        process.env.API_BASE_URL ||
        "http://localhost:8000"
      ).replace(/\/$/, "");
      const wsBase = backendBase.replace(/^http/, "ws");
      const sampleRate = 16000; // Align with renderer SAMPLE_RATE (avoid mismatch & early server close)
      const micUrl = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(
        chatId
      )}&token=${encodeURIComponent(
        token
      )}&source=mic&sample_rate=${sampleRate}`;
      const sysUrl = `${wsBase}/ws/transcribe?chat_id=${encodeURIComponent(
        chatId
      )}&token=${encodeURIComponent(
        token
      )}&source=system&sample_rate=${sampleRate}`;
      console.log("[transcriptionManager] Connecting mic WS", micUrl);
      console.log("[transcriptionManager] Connecting system WS", sysUrl);
      this.micWs = new ManagerWebSocket(micUrl, "mic");
      this.sysWs = new ManagerWebSocket(sysUrl, "system");
      this.micWs.onMessage((msg) => this.handleMsg(msg, "mic"));
      this.sysWs.onMessage((msg) => this.handleMsg(msg, "system"));
      await Promise.all([this.micWs.connect(), this.sysWs.connect()]);
      this.initialized = true;
      this.broadcast({ type: "manager_status", data: { ready: true } });
      // Synthetic diagnostic event to prove renderer subscription works
      this.broadcast({
        type: "transcript_segment",
        source: "mic",
        data: { text: "(diagnostic) central manager ready", is_final: true },
      });
      // Start a temporary keep-alive that sends a tiny silent frame every 2s until first real frames arrive
      this.startKeepAlive();
    } catch (e) {
      console.error("[transcriptionManager] ensure failed", e);
      this.broadcast({
        type: "manager_status",
        data: { ready: false, error: String(e) },
      });
    } finally {
      this.connecting = false;
    }
  }

  private handleMsg(msg: any, source: "mic" | "system") {
    if (!msg) return;
    const type = msg.type;
    try {
      if (type === "transcript_segment") {
        const data = msg.data || {};
        console.log(
          "[transcriptionManager][recv] transcript_segment FROM backend",
          {
            source,
            text: data?.text,
            is_final: data?.is_final,
            final: data?.final,
            len: (data?.text || "").length,
            ts: Date.now(),
          }
        );
      } else if (type === "status") {
        console.log("[transcriptionManager][recv] status FROM backend", {
          source,
          data: msg.data,
        });
      }
    } catch {}
    if (type === "transcript_segment") {
      const data = msg.data || {};
      console.log(
        "[transcriptionManager][bubble-stage] preparing broadcast (will create/append bubble in renderer)",
        {
          source,
          preview: (data?.text || "").slice(0, 60),
          is_final: data?.is_final,
          final: data?.final,
        }
      );
      this.broadcast({ type: "transcript_segment", source, data });
    } else if (type === "status") {
      this.broadcast({ type: "status", source, data: msg.data });
    } else if (type === "insight_segment") {
      this.broadcast({ type: "insight_segment", source, data: msg.data });
    } else if (type === "error") {
      this.broadcast({ type: "error", source, data: msg.data });
    }
  }

  private broadcast(payload: any) {
    try {
      if (payload?.type === "transcript_segment") {
        console.log("[transcriptionManager][broadcast] segment", {
          source: payload.source,
          text: payload.data?.text,
          is_final: payload.data?.is_final,
          final: payload.data?.final,
        });
      } else if (payload?.type === "status") {
        console.log("[transcriptionManager][broadcast] status", payload.data);
      }
    } catch {}
    BrowserWindow.getAllWindows().forEach((w) => {
      try {
        w.webContents.send("transcript:event", payload);
      } catch {}
    });
  }

  sendMicFrame(frame: ArrayBuffer | Buffer) {
    if (!this.micWs) return false;
    const ok = this.micWs.sendBinary(frame);
    if (ok && !this.micHadFrame) {
      this.micHadFrame = true;
      this.maybeStopKeepAlive();
    }
    return ok;
  }
  sendSystemFrame(frame: ArrayBuffer | Buffer) {
    if (!this.sysWs) return false;
    const ok = this.sysWs.sendBinary(frame);
    if (ok && !this.sysHadFrame) {
      this.sysHadFrame = true;
      this.maybeStopKeepAlive();
    }
    return ok;
  }

  private startKeepAlive() {
    if (this.keepAliveTimer) return;
    const silent16 = new Int16Array(160); // 10ms @16k silent frame
    this.keepAliveTimer = setInterval(() => {
      // Stop if both sources have produced frames or websockets not open
      if (this.micHadFrame && this.sysHadFrame) {
        this.maybeStopKeepAlive();
        return;
      }
      // Only send if not yet had real frame
      if (!this.micHadFrame) this.micWs?.sendBinary(silent16.buffer);
      if (!this.sysHadFrame) this.sysWs?.sendBinary(silent16.buffer);
    }, 2000);
  }

  private maybeStopKeepAlive() {
    if (this.keepAliveTimer && this.micHadFrame && this.sysHadFrame) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

const manager = new TranscriptionManager();

ipcMain.handle("transcript:init", async (_e, { chatId, token }) => {
  console.log("[transcriptionManager] transcript:init received", { chatId });
  await manager.ensure(chatId, token);
  return { ok: true };
});

// IPC channels to receive raw audio frames from renderer and forward over central websockets
ipcMain.on("audio:micFrame", (_e, buf: Buffer) => {
  const ok = manager.sendMicFrame(buf);
  if (!ok) {
    // Could log occasionally; avoid spam
  }
});
ipcMain.on("audio:systemFrame", (_e, buf: Buffer) => {
  const ok = manager.sendSystemFrame(buf);
  if (!ok) {
    // Optional debug
  }
});

console.log("[transcriptionManager] Module loaded & IPC handler registered");

export default manager;
