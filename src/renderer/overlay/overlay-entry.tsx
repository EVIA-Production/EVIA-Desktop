import React from 'react'
import ReactDOM from 'react-dom/client'
import EviaBar from './EviaBar'
import ListenView from './ListenView'
import AskView from './AskView'
import SettingsView from './SettingsView'
import ShortCutSettingsView from './ShortCutSettingsView'
import '../overlay/overlay-glass.css'

const params = new URLSearchParams(window.location.search)
const view = (params.get('view') || 'header').toLowerCase()
const rootEl = document.getElementById('overlay-root')

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  switch (view) {
    case 'header':
      root.render(
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={'de'}
          onToggleLanguage={() => {}}
        />
      )
      break
    case 'listen':
      root.render(
        <ListenView
          lines={[]}
          followLive={true}
          onToggleFollow={() => {}}
          onClose={() => window.evia.closeWindow('listen')}
        />
      )
      break
    case 'ask':
      root.render(<AskView language={'de'} />)
      break
    case 'settings':
      root.render(<SettingsView language={'de'} onToggleLanguage={() => {}} />)
      break
    case 'shortcuts':
      root.render(<ShortCutSettingsView />)
      break
    default:
      root.render(
        <EviaBar
          currentView={null}
          onViewChange={() => {}}
          isListening={false}
          onToggleListening={() => {}}
          language={'de'}
          onToggleLanguage={() => {}}
        />
      )
  }
}