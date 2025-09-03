// Glass UI Service - Stub APIs für Dev B
// Diese APIs simulieren die Backend-Integration, damit die UI vollständig funktioniert

export interface AIAnswer {
  answer: string;
  citations?: string[];
  latency_ms: number;
  timestamp: string;
}

export interface UserSettings {
  language: 'de' | 'en';
  providers: {
    openai?: boolean;
    gemini?: boolean;
    anthropic?: boolean;
  };
  profile: {
    name: string;
  };
  consent_training?: boolean;
  consent_analytics?: boolean;
  consent_storage?: boolean;
}

export interface InsightClickEvent {
  chat_id: number;
  type: 'summary' | 'followup' | 'action';
  index: number;
  timestamp: string;
}

export interface WebSocketStatus {
  isConnected: boolean;
  dg_open: boolean;
  frames_per_sec: number;
  reconnect_count: number;
  last_error?: string;
}

class GlassUIService {
  private mockLatency = 150; // Simulierte Latenz in ms
  private mockConnectionStatus: WebSocketStatus = {
    isConnected: true,
    dg_open: true,
    frames_per_sec: 8,
    reconnect_count: 0
  };

  // Simuliere WebSocket-Verbindung
  private simulateWebSocketConnection() {
    // Simuliere gelegentliche Verbindungsprobleme
    setInterval(() => {
      if (Math.random() > 0.95) { // 5% Chance für Verbindungsabbruch
        this.mockConnectionStatus.isConnected = false;
        this.mockConnectionStatus.dg_open = false;
        this.mockConnectionStatus.last_error = 'Connection timeout';
        
        // Automatische Wiederherstellung nach 2-5 Sekunden
        setTimeout(() => {
          this.mockConnectionStatus.isConnected = true;
          this.mockConnectionStatus.dg_open = true;
          this.mockConnectionStatus.reconnect_count++;
          this.mockConnectionStatus.last_error = undefined;
        }, 2000 + Math.random() * 3000);
      }
    }, 10000);

    // Simuliere Frame-Rate-Schwankungen
    setInterval(() => {
      this.mockConnectionStatus.frames_per_sec = 7 + Math.random() * 6; // 7-13 fps
    }, 3000);
  }

  constructor() {
    this.simulateWebSocketConnection();
  }

  // Stub: POST /ask - Simuliert AI-Antworten
  async askAI(chatId: number, prompt: string, language: 'de' | 'en'): Promise<AIAnswer> {
    // Simuliere API-Latenz
    await new Promise(resolve => setTimeout(resolve, this.mockLatency + Math.random() * 100));

    // Generiere kontextuelle Antworten basierend auf dem Prompt
    const answers = this.generateMockAnswers(prompt, language);
    const randomAnswer = answers[Math.floor(Math.random() * answers.length)];

    return {
      answer: randomAnswer,
      citations: this.generateMockCitations(),
      latency_ms: Math.round(this.mockLatency + Math.random() * 100),
      timestamp: new Date().toISOString()
    };
  }

  // Stub: PUT /me/settings - Simuliert Settings-Update
  async updateSettings(settings: Partial<UserSettings>): Promise<{ success: boolean }> {
    // Simuliere API-Latenz
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    // Simuliere gelegentliche Fehler (5% Chance)
    if (Math.random() > 0.95) {
      throw new Error('Settings update failed - server error');
    }

    // Speichere in localStorage für Persistierung
    if (settings.language) {
      localStorage.setItem('evia_language', settings.language);
    }

    return { success: true };
  }

  // Stub: GET /me/settings - Simuliert Settings-Abruf
  async getSettings(): Promise<UserSettings> {
    // Simuliere API-Latenz
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

    // Lade aus localStorage oder verwende Defaults
    const savedLanguage = localStorage.getItem('evia_language') as 'de' | 'en' || 'de';

    return {
      language: savedLanguage,
      providers: {
        openai: false,
        gemini: false,
        anthropic: false
      },
      profile: {
        name: 'sales'
      },
      consent_training: false,
      consent_analytics: true,
      consent_storage: true
    };
  }

  // Stub: POST /events/insight-click - Simuliert Telemetry
  async trackInsightClick(event: InsightClickEvent): Promise<{ success: boolean }> {
    // Simuliere API-Latenz
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));

    // Log für Entwicklung
    console.log('📊 Insight Click Event:', event);

    // Simuliere gelegentliche Fehler (2% Chance)
    if (Math.random() > 0.98) {
      console.warn('Telemetry event failed (simulated)');
      return { success: false };
    }

    return { success: true };
  }

  // Stub: WebSocket Status - Simuliert Verbindungsstatus
  getWebSocketStatus(): WebSocketStatus {
    return { ...this.mockConnectionStatus };
  }

  // Stub: Simuliert neue Transkript-Segmente
  generateMockTranscriptSegment(): any {
    const mockTexts = [
      'Das ist ein interessanter Punkt.',
      'Können Sie das genauer erklären?',
      'Ich stimme dem vollkommen zu.',
      'Das sollten wir weiter verfolgen.',
      'Gibt es noch Fragen dazu?',
      'Lassen Sie uns das dokumentieren.',
      'Das ist eine gute Idee.',
      'Können wir das testen?'
    ];

    return {
      id: Date.now().toString(),
      text: mockTexts[Math.floor(Math.random() * mockTexts.length)],
      speaker: Math.floor(Math.random() * 3),
      is_final: Math.random() > 0.3,
      timestamp: new Date().toISOString()
    };
  }

  // Stub: Simuliert neue Insights
  generateMockInsight(): any {
    const insightTypes = ['summary', 'followup', 'action'] as const;
    const mockInsights = {
      summary: [
        'Meeting fokussiert sich auf Q4-Strategie und KPIs',
        'Diskussion über Umsatzziele und Prioritäten',
        'Team ist sich einig über nächste Schritte'
      ],
      followup: [
        'Weitere Analyse der KPIs erforderlich',
        'Nächste Schritte definieren und zuweisen',
        'Follow-up Meeting in 2 Wochen planen'
      ],
      action: [
        'Umsatzziele für Q4 finalisieren',
        'KPIs analysieren und Bericht erstellen',
        'Aktionsplan für Q4 entwickeln'
      ]
    };

    const type = insightTypes[Math.floor(Math.random() * insightTypes.length)];
    const insights = mockInsights[type];
    const text = insights[Math.floor(Math.random() * insights.length)];

    return {
      id: Date.now().toString(),
      type,
      text,
      timestamp: new Date().toISOString(),
      index: Math.floor(Math.random() * 100)
    };
  }

  // Private Helper-Methoden
  private generateMockAnswers(prompt: string, language: 'de' | 'en'): string[] {
    if (language === 'de') {
      return [
        `Basierend auf dem Kontext "${prompt}" empfehle ich folgende Schritte: 1) Analyse der aktuellen Situation, 2) Definition klarer Ziele, 3) Erstellung eines Aktionsplans.`,
        `Für "${prompt}" schlage ich vor: Priorisierung der wichtigsten Punkte, Festlegung von Meilensteinen und regelmäßige Überprüfung des Fortschritts.`,
        `Bei "${prompt}" sollten wir uns auf die Kernaspekte konzentrieren: Effizienz, Qualität und messbare Ergebnisse.`,
        `Zu "${prompt}": Empfehlung für strukturierten Ansatz mit klaren Verantwortlichkeiten und Zeitplan.`
      ];
    } else {
      return [
        `Based on the context "${prompt}", I recommend: 1) Analyze current situation, 2) Define clear objectives, 3) Create action plan.`,
        `For "${prompt}", I suggest: Prioritize key points, set milestones, and regular progress review.`,
        `Regarding "${prompt}", we should focus on: Efficiency, quality, and measurable outcomes.`,
        `About "${prompt}": Recommendation for structured approach with clear responsibilities and timeline.`
      ];
    }
  }

  private generateMockCitations(): string[] {
    const mockCitations = [
      'Meeting Transcript - Q4 Strategy Session',
      'Previous Action Items - Q3 Review',
      'Team Feedback - Performance Metrics',
      'Industry Best Practices - Sales Strategy'
    ];

    // Zufällige Anzahl von Citations (0-3)
    const count = Math.floor(Math.random() * 4);
    return mockCitations.slice(0, count);
  }
}

// Singleton-Instanz exportieren
export const glassUIService = new GlassUIService();
