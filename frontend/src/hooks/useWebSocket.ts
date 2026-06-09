import { useCallback, useEffect, useRef } from 'react'
import { useNocStore } from '../store/nocStore'
import { useAuthStore } from '../store/authStore'

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/updates`
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

export function getReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_CAP_MS)
  return delay + Math.floor(random() * 500)
}

export function isAuthFailureClose(code: number): boolean {
  return code === WS_CLOSE_AUTH_FAILURE
}

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

    if (!useAuthStore.getState().isAuthenticated) {
      setConnected(false)
      return
    }

    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    const socket = new WebSocket(getWebSocketUrl())
    socketRef.current = socket

    socket.onopen = () => {
      // The HttpOnly session cookie authenticates the handshake. Send one
      // ping up front: if the cookie was valid this is a normal ping, and if
      // it was missing/expired the server treats it as a failed auth frame
      // and closes with 4001 instead of leaving the socket hanging.
      socket.send(JSON.stringify({ type: 'ping' }))
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
      if (isAuthFailureClose(event.code)) {
        stoppedRef.current = true
        handleAuthError()
        return
      }

      // Exponential backoff capped at 30s, with a small jitter so a
      // server restart does not produce a synchronized thundering herd.
      const attempt = reconnectAttemptsRef.current
      const jittered = getReconnectDelayMs(attempt)
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
