import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { setLanguage } from './locales'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// The interface language is read before the first render, so the panel never flashes in the wrong one.
chrome.storage.local
  .get('language')
  .then((stored) => {
    if (stored.language === 'en' || stored.language === 'ru') setLanguage(stored.language)
  })
  .catch(() => {})
  .finally(render)
