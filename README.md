# EVIA Desktop Overlay

Ein transparentes, always-on-top Electron-Overlay für EVIA mit Glass UI.

## 🚀 Quick Start

### Voraussetzungen
- **macOS**: Mikrofon- und Bildschirmaufnahme-Berechtigung für "EVIA Desktop" gewähren
  - Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon
  - Systemeinstellungen → Datenschutz & Sicherheit → Bildschirmaufnahme
- **Backend**: EVIA-Backend muss laufen

### Start-Kommandos (2 Terminals)

**Terminal A - Backend:**
```bash
cd /path/to/EVIA-Backend
docker compose up --build
```

**Terminal B - Desktop Overlay:**
```bash
cd /path/to/EVIA-Desktop
npm install
npm run dev
```

Das Overlay öffnet sich als transparentes, frameless, always-on-top Fenster.

## ⌨️ Globale Shortcuts

| Shortcut | Aktion |
|----------|--------|
| `⌘ + \` | Overlay Show/Hide |
| `⌘ + Enter` | Ask View öffnen |

## 🎯 Features

### EVIA Bar
- **Listen**: Live-Transkription starten/stoppen
- **Ask**: KI-Assistent öffnen
- **Settings**: Einstellungen öffnen
- **Language Toggle**: DE/EN umschalten
- **Hide**: Overlay ausblenden

### Listen View
- Live-Transkription mit Mock-Daten
- Auto-Scroll mit "Jump to latest"
- Sprecher-Erkennung (Mock)
- Transkriptions-Historie

### Ask View
- KI-Assistent mit Mock-Antworten
- Token-Streaming (Mock)
- DE/EN Toggle persistent
- Frage-Historie

### Settings View
- **Sprache**: DE/EN Auswahl
- **Audio-Einstellungen**: Auto-Scroll, System-Audio, Echo-Kompensation, Sprecher-Erkennung
- **System-Info**: Version, Backend-Status, Sprache

## 🛠️ Development

### Build
```bash
npm run build
```

### Development Flags
```bash
# Diagnostic renderer
npm run dev -- --diagnostic

# Permissions page
npm run dev -- --permissions
```

## 📁 Projektstruktur

```
src/
├── main/
│   ├── main.ts          # Electron main process
│   └── preload.ts       # Preload script
└── renderer/
    ├── index.html       # Renderer HTML
    ├── main.ts          # React entry point
    └── components/
        ├── EviaOverlay.tsx      # Main overlay component
        ├── SimpleEviaBar.tsx    # Floating UI bar
        ├── SimpleListenView.tsx # Live transcription
        ├── SimpleAskView.tsx    # AI assistant
        └── SimpleSettingsView.tsx # Settings panel
```

## 🔧 Technische Details

### Window-Verhalten
- **Transparent**: `transparent: true`
- **Frameless**: `frame: false`
- **Always-on-top**: `alwaysOnTop: true`
- **Drag/No-drag**: `-webkit-app-region` CSS

### IPC-Kommunikation
- **Audio-Helper**: `system-audio:start/stop`
- **Shortcuts**: `shortcut:ask-view`
- **WebSocket**: Vorhandene EVIA-Bridge

### Styling
- **Glass-Effekt**: `backdrop-filter: blur(20px)`
- **Transparenz**: `rgba(0, 0, 0, 0.1)`
- **Responsive**: Flexbox-Layout

## 🚧 Bekannte Limits

- **Mock-Daten**: Aktuell werden Mock-Transkriptionen und KI-Antworten verwendet
- **Backend-Integration**: WebSocket-Verbindungen zu EVIA-Backend noch nicht implementiert
- **Audio-Capture**: Echte Mikrofon-Aufnahme noch nicht aktiv
- **Settings-Persistierung**: Lokale Speicherung noch nicht implementiert

## ✅ Neu implementiert (v1.1.0)

- **Systemweite Shortcuts**: ⌘+\\ und ⌘+Enter funktionieren global, auch wenn Overlay nicht im Fokus ist
- **IPC-Event-Handling**: Renderer reagiert auf Shortcut-Events vom Main Process
- **Vereinfachte Architektur**: Keine shadcn/ui Dependencies, einfache CSS-basierte UI
- **Robustes Build-System**: TypeScript + Vite + Electron Builder funktioniert fehlerfrei
- **Vollständige Dokumentation**: README mit allen Start-Kommandos und Feature-Übersicht

## 🔄 Nächste Schritte

1. **Backend-Integration**: Echte WebSocket-Verbindungen zu `/ws/transcribe`
2. **API-Integration**: `/ask` Endpoint an EVIA-Backend
3. **Audio-Capture**: Echte Mikrofon-Aufnahme aktivieren
4. **Settings-Persistierung**: Lokale JSON + Backend `/me/settings`
5. **Performance**: Latency-Messung (TTFT/TTR)

## 📝 Changelog

### v1.0.0
- ✅ Glass UI Komponenten portiert
- ✅ Transparentes Overlay
- ✅ Globale Shortcuts (⌘+\\, ⌘+Enter)
- ✅ EVIA Bar mit Listen/Ask/Settings
- ✅ DE/EN Toggle
- ✅ Mock-Daten für Transkription und KI
- ✅ Build-System funktioniert

### v1.1.0 (Aktuell)
- ✅ **Globale Shortcuts in main.ts registriert** - ⌘+\\ und ⌘+Enter funktionieren systemweit
- ✅ **IPC-Kommunikation erweitert** - Shortcut-Events werden an Renderer gesendet
- ✅ **Vereinfachte UI-Komponenten** - Ohne komplexe shadcn/ui Dependencies
- ✅ **Vollständige README-Dokumentation** - Start-Kommandos, Hotkeys, Feature-Flags
- ✅ **Build-System optimiert** - TypeScript kompiliert, Vite baut erfolgreich
- ✅ **Overlay funktional** - Alle Views (Listen/Ask/Settings) arbeiten mit Mock-Daten

---

**EVIA Desktop Overlay** - Transparentes AI-Assistenten-Overlay für macOS