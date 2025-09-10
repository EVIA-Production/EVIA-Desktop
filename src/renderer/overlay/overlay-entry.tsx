import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../overlay/overlay-tokens.css'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortCutSettingsView from './ShortCutSettingsView'

type View = 'listen' | 'ask' | 'settings' | 'shortcuts' | null

const OverlayApp: React.FC = () => {
  const [view, setView] = useState<View>('listen')
  const [isListening, setIsListening] = useState(false)
  const [language, setLanguage] = useState<'de' | 'en'>('de')
  const [followLive, setFollowLive] = useState(true)

  const lines = useMemo(() => (
    [
      { speaker: 1, text: 'Willkommen bei EVIA Overlay.', isFinal: true },
      { speaker: 2, text: 'Dies ist eine Platzhalter-Transkription.' },
    ]
  ), [])

  return (
    <div style={{ position: 'fixed', left: 20, top: 80, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <EviaBar
        currentView={view}
        onViewChange={setView}
        isListening={isListening}
        onToggleListening={() => setIsListening(v => !v)}
        language={language}
        onToggleLanguage={() => setLanguage(prev => prev === 'de' ? 'en' : 'de')}
      />

      {view === 'listen' && (
        <ListenView
          lines={lines}
          followLive={followLive}
          onToggleFollow={() => setFollowLive(v => !v)}
        />
      )}
      {view === 'ask' && (
        <AskView language={language} />
      )}
      {view === 'settings' && (
        <SettingsView language={language} onToggleLanguage={() => setLanguage(prev => prev === 'de' ? 'en' : 'de')} />)
      }
      {view === 'shortcuts' && (
        <ShortCutSettingsView />
      )}
    </div>
  )
}

const mount = () => {
  const el = document.getElementById('overlay-root')
  if (!el) return
  const root = createRoot(el)
  root.render(<OverlayApp />)
}

mount()


