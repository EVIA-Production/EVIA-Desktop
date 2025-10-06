export interface AggregatedMessage {
  id: number;
  speaker: 0 | 1; // 0 mic(Me) 1 system(Them)
  text: string;
  isPartial: boolean;
  isFinal: boolean;
  ts: number;
}

export type SegmentEvent = {
  source: "mic" | "system";
  data: { text: string; is_final?: boolean; final?: boolean };
};

export class TranscriptAggregator {
  private messages: AggregatedMessage[] = [];
  private nextId = 1;
  private listeners: ((msgs: AggregatedMessage[]) => void)[] = [];

  onUpdate(cb: (msgs: AggregatedMessage[]) => void) {
    this.listeners.push(cb);
    cb(this.messages);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  applySegment(evt: SegmentEvent) {
    const text = evt?.data?.text || "";
    if (!text) return;
    const isFinal = !!(evt.data.is_final || evt.data.final);
    const isPartial = !isFinal;
    const speaker: 0 | 1 = evt.source === "mic" ? 0 : 1;

    // Find last partial for this speaker
    let lastPartialIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.speaker === speaker && m.isPartial) {
        lastPartialIdx = i;
        break;
      }
    }

    if (isPartial) {
      if (lastPartialIdx !== -1) {
        // Update existing partial
        this.messages[lastPartialIdx] = {
          ...this.messages[lastPartialIdx],
          text,
        };
        try {
          console.log("[Aggregator] update partial", {
            speaker,
            textLen: text.length,
          });
        } catch {}
      } else {
        this.messages.push({
          id: this.nextId++,
          speaker,
          text,
          isPartial: true,
          isFinal: false,
          ts: Date.now(),
        });
        try {
          console.log("[Aggregator] add partial", {
            speaker,
            textLen: text.length,
          });
        } catch {}
      }
    } else {
      // final
      if (lastPartialIdx !== -1) {
        this.messages[lastPartialIdx] = {
          ...this.messages[lastPartialIdx],
          text,
          isPartial: false,
          isFinal: true,
        };
        try {
          console.log("[Aggregator] finalize existing partial", {
            speaker,
            textLen: text.length,
          });
        } catch {}
      } else {
        this.messages.push({
          id: this.nextId++,
          speaker,
          text,
          isPartial: false,
          isFinal: true,
          ts: Date.now(),
        });
        try {
          console.log("[Aggregator] add final (no prior partial)", {
            speaker,
            textLen: text.length,
          });
        } catch {}
      }
    }
    this.emit();
  }

  reset() {
    this.messages = [];
    this.emit();
  }

  getMessages() {
    return this.messages;
  }

  getTranscriptText(includeSpeakers = false) {
    return this.messages
      .filter((m) => m.isFinal) // only final lines
      .map((m) =>
        includeSpeakers
          ? `${m.speaker === 0 ? "Me" : "Them"}: ${m.text}`
          : m.text
      )
      .join("\n");
  }

  private emit() {
    this.listeners.forEach((l) => l(this.messages));
  }
}
