import { useCallback, useEffect, useRef } from 'react'
import { useNocStore } from '../store/nocStore'
import { useAuthStore } from '../store/authStore'

function getWebSocketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${protocol}//${window.location.host}/ws/updates`)
  url.searchParams.set('token', token)
  return url.toString()
}

// Reconnect backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped).
// Without a cap + backoff, an auth-failure or backend-down state used
// to fire one reconnect every 3 seconds forever.
const RECONNECT_BASE_MS = 1_000
const RECONNECT_CAP_MS = 30_000

// Server closes the socket with this code when the JWT is rejected
// (see backend/app/websocket.py auth flow). Stop reconnecting on this -
// the user needs to log in again, retrying with the same expired token
// just produces a tight loop.
const WS_CLOSE_AUTH_FAILURE = 4001

export function useWebSocket() {
  const setConnected = useNocStore((state) => state.setConnected)
  const handleAuthError = useAuthStore((state) => state.handleAuthError)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const stoppedRef = useRef(false)

  const disconnect = useCallback(() => {
    stoppedRef.current = true
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    const socket = socketRef.current
    socketRef.current = null
    if (socket) {
      // Detach handlers before closing so the stale `onclose` does not
      // re-arm the reconnect timer after we've already torn down.
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
    setConnected(false)
  }, [setConnected])

  const connect = useCallback(() => {
    if (stoppedRef.current) {
      return
    }

    const token = useAuthStore.getState().token || localStorage.getItem('watchtower_token')
    if (!token) {
      setConnected(false)
      return
    }

    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    const socket = new WebSocket(getWebSocketUrl(token))
    socketRef.current = socket

    socket.onopen = () => {
      reconnectAttemptsRef.current = 0
      setConnected(true)
    }

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type?: string }
        if (message.type === 'pong') {
          return
        }
      } catch {
        // Ignore non-JSON messages for now.
      }
    }

    socket.onerror = () => {
      setConnected(false)
    }

    socket.onclose = (event) => {
      const wasCurrent = socketRef.current === socket
      socketRef.current = null
      setConnected(false)

      if (!wasCurrent || stoppedRef.current) {
        return
      }

      // Server-driven auth failure: trash the token and let the auth
      // store route the user back to login instead of hammering /ws.
      if (event.code === WS_CLOSE_AUTH_FAILURE) {
        stoppedRef.current = true
        handleAuthError()
        return
      }

      // Exponential backoff capped at 30s, with a small jitter so a
      // server restart does not produce a synchronized thundering herd.
      const attempt = reconnectAttemptsRef.current
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_CAP_MS)
      const jittered = delay + Math.floor(Math.random() * 500)
      reconnectAttemptsRef.current = attempt + 1

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, jittered)
    }
  }, [setConnected, handleAuthError])

  useEffect(() => {
    stoppedRef.current = false
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return {
    isConnected: Boolean(socketRef.current && socketRef.current.readyState === WebSocket.OPEN),
    connect,
    disconnect,
  }
}
