'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  connectOpenClawConnection,
  disconnectOpenClawConnection,
  fetchOpenClawConnectionStatus,
  reconnectOpenClawConnection,
  type OpenClawConnectionProfile,
  type OpenClawConnectionSecrets,
  type OpenClawConnectionStatus,
} from '@/lib/openclaw-connection'

const DEFAULT_STATUS: OpenClawConnectionStatus = {
  status: 'disconnected',
  message: null,
  profile: null,
  localPort: null,
  hasReconnectCredentials: false,
  usesTunnel: false,
}
const REFRESH_INTERVAL_MS = 3000

export function useOpenClawConnection() {
  const [status, setStatus] = useState<OpenClawConnectionStatus>(DEFAULT_STATUS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await fetchOpenClawConnectionStatus()
      setStatus(next)
      setError(null)
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read connection status'
      setError(message)
      throw err
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => {})

    const timer = window.setInterval(() => {
      refresh().catch(() => {})
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [refresh])

  const connect = useCallback(async (profile: OpenClawConnectionProfile, secrets: OpenClawConnectionSecrets) => {
    setLoading(true)
    setError(null)
    try {
      const next = await connectOpenClawConnection(profile, secrets)
      setStatus(next)
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const reconnect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await reconnectOpenClawConnection()
      setStatus(next)
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reconnect failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await disconnectOpenClawConnection()
      setStatus(next)
      return next
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Disconnect failed'
      setError(message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return useMemo(
    () => ({
      status,
      loading,
      error,
      refresh,
      connect,
      reconnect,
      disconnect,
    }),
    [status, loading, error, refresh, connect, reconnect, disconnect]
  )
}
