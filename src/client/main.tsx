import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useUiStore } from './state/uiStore'
import './index.css'
import './components/glass/glass.css'

// Dev-only: expose the UI store for browser-driven verification (Chrome MCP).
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  ;(window as unknown as { __uiStore: typeof useUiStore }).__uiStore = useUiStore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
