import { useCallback, useEffect, useRef } from 'react'
import { useNocStore } from '../store/nocStore'
import { useAuthStore } from '../store/authStore'

function getWebSocketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${protocol}//${window.location.host}/ws/updates`)
  url.searchParams.set('token', token)
  return url.toString()
}

export function useWebSocket() {
  const setConnected = useNocStore((state) => state.setConnected)
  const demoMode = useNocStore((state) => state.demoMode)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    const socket = socketRef.current
    socketRef.current = null
    if (socket) {
      socket.close()
    }
    setConnected(false)
  }, [setConnected])

  const connect = useCallback(() => {
    if (demoMode) {
      setConnected(true)
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

    socket.onclose = () => {
      const shouldReconnect = socketRef.current === socket
      socketRef.current = null
      setConnected(false)

      if (!shouldReconnect || demoMode) {
        return
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, 3000)
    }
  }, [demoMode, setConnected])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return {
    isConnected: demoMode ? true : Boolean(socketRef.current && socketRef.current.readyState === WebSocket.OPEN),
    connect,
    disconnect,
  }
}
