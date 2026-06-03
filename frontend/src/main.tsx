import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App'
import './styles/globals.css'

const BOOTSTRAP_TOKEN_STORAGE_KEY = 'watchtower_bootstrap_token'

function stashBootstrapTokenFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('bootstrap_token')
  if (!token) {
    return
  }

  sessionStorage.setItem(BOOTSTRAP_TOKEN_STORAGE_KEY, token)
  params.delete('bootstrap_token')
  const remainingQuery = params.toString()
  const sanitizedUrl = `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`
  window.history.replaceState(null, document.title, sanitizedUrl)
}

stashBootstrapTokenFromUrl()
inject()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
