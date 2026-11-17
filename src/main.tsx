import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  let refreshing = false
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
    // Do not reload on first install; only when an already-controlled app gets replaced.
    if (navigator.serviceWorker.controller) reloadForUpdate()
  })

  const checkForUpdates = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      })
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
