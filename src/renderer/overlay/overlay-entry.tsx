import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortCutSettingsView from './ShortCutSettingsView'
import { i18n } from '../i18n/i18n'
import '../overlay/overlay-glass.css'

const params = new URLSearchParams(window.location.search)
const view = (params.get('view') || 'header').toLowerCase()
const rootEl = document.getElementById('overlay-root')

// Initialize language from localStorage or default to German
const savedLanguage = i18n.getLanguage()

// Language toggle function that broadcasts to all windows
const handleToggleLanguage = () => {
  const currentLang = i18n.getLanguage()
  const newLang = currentLang === 'de' ? 'en' : 'de'
  i18n.setLanguage(newLang)
  
  // Broadcast language change to all windows via IPC
  if (window.evia?.ipc) {
    window.evia.ipc.send('language-changed', newLang)
  }
  
  // Reload current window to apply new language
  window.location.reload()
}

function App() {
  const [language, setLanguage] = useState<'de' | 'en'>(savedLanguage as 'de' | 'en')

  const toggleLanguage = () => {
    handleToggleLanguage()
  }

  switch (view) {
    case 'header':
      return (
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={language}
          onToggleLanguage={toggleLanguage}
        />
      )
    case 'listen':
      return (
        <ListenView
          lines={[]}
          followLive={true}
          onToggleFollow={() => {}}
          onClose={() => window.evia.closeWindow('listen')}
        />
      )
    case 'ask':
      return <AskView language={language} />
    case 'settings':
      return <SettingsView language={language} onToggleLanguage={toggleLanguage} />
    case 'shortcuts':
      return <ShortCutSettingsView />
    default:
      return (
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={language}
          onToggleLanguage={toggleLanguage}
        />
      )
  }
}

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  root.render(<App />)
}