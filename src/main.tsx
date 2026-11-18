import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  let refreshing = false
  let hadController = Boolean(navigator.serviceWorker.controller)
  let updatePending = false

  const reloadForUpdate = () => {
    if (refreshing) return
    if (document.visibilityState === 'visible') {
      refreshing = true
      window.location.reload()
    } else {
      updatePending = true
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first controller is a fresh install, not an app update.
    if (!hadController) {
      hadController = true
      return
    }
    reloadForUpdate()
  })

  const checkForUpdates = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      })
      // Activate a waiting release immediately; the new controller reloads the app.
      if (registration.waiting && navigator.serviceWorker.controller) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      }
      await registration.update()
    } catch (error) {
      console.warn('PWA service worker update check failed:', error)
    }
  }

  window.addEventListener('load', checkForUpdates)
  window.addEventListener('focus', checkForUpdates)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (updatePending) reloadForUpdate()
      else checkForUpdates()
    }
  })
}
