'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useOpenClawConnection } from '@/lib/useOpenClawConnection'
import type { OpenClawConnectionProfile, OpenClawConnectionSecrets, SshAuthMethod } from '@/lib/openclaw-connection'

const STORAGE_KEY = 'clawport-openclaw-connection-profile'

interface PersistedProfile {
  gatewayHost: string
  gatewayPort: number
  sshHost: string
  sshPort: number
  sshUser: string
  sshAuthMethod: SshAuthMethod
}

const DEFAULT_PROFILE: PersistedProfile = {
  gatewayHost: '',
  gatewayPort: 18789,
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshAuthMethod: 'privateKey',
}

function loadProfile(): PersistedProfile {
  if (typeof window === 'undefined') return { ...DEFAULT_PROFILE }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PROFILE }
    const parsed = JSON.parse(raw) as Partial<PersistedProfile>
    return {
      gatewayHost: typeof parsed.gatewayHost === 'string' ? parsed.gatewayHost : '',
      gatewayPort: typeof parsed.gatewayPort === 'number' ? parsed.gatewayPort : 18789,
      sshHost: typeof parsed.sshHost === 'string' ? parsed.sshHost : '',
      sshPort: typeof parsed.sshPort === 'number' ? parsed.sshPort : 22,
      sshUser: typeof parsed.sshUser === 'string' ? parsed.sshUser : '',
      sshAuthMethod: parsed.sshAuthMethod === 'password' ? 'password' : 'privateKey',
    }
  } catch {
    return { ...DEFAULT_PROFILE }
  }
}

function saveProfile(profile: PersistedProfile) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}

export function OpenClawConnectionModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { status, loading, error, connect, reconnect, disconnect } = useOpenClawConnection()

  const [profile, setProfile] = useState<PersistedProfile>(() => loadProfile())
  const [gatewayToken, setGatewayToken] = useState('')
  const [sshPassword, setSshPassword] = useState('')
  const [sshPrivateKey, setSshPrivateKey] = useState('')
  const [sshPassphrase, setSshPassphrase] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const fromStorage = loadProfile()
    setProfile(fromStorage)
  }, [open])

  const statusLabel = useMemo(() => {
    if (status.status === 'connected') return 'Active'
    if (status.status === 'connecting') return 'Connecting...'
    if (status.status === 'error') return 'Error'
    return 'Disconnected'
  }, [status.status])

  const canSubmit =
    profile.gatewayHost.trim().length > 0 &&
    profile.sshHost.trim().length > 0 &&
    profile.sshUser.trim().length > 0 &&
    (profile.sshAuthMethod === 'password' ? sshPassword.trim().length > 0 : sshPrivateKey.trim().length > 0)

  async function onConnect() {
    setFormError(null)

    if (!canSubmit) {
      setFormError('Please fill in all required fields to open the SSH tunnel.')
      return
    }

    const payloadProfile: OpenClawConnectionProfile = {
      gatewayHost: profile.gatewayHost.trim(),
      gatewayPort: profile.gatewayPort,
      sshHost: profile.sshHost.trim(),
      sshPort: profile.sshPort,
      sshUser: profile.sshUser.trim(),
      sshAuthMethod: profile.sshAuthMethod,
    }

    const secrets: OpenClawConnectionSecrets = {
      gatewayToken: gatewayToken.trim() || undefined,
      sshPassword: profile.sshAuthMethod === 'password' ? sshPassword : undefined,
      sshPrivateKey: profile.sshAuthMethod === 'privateKey' ? sshPrivateKey : undefined,
      sshPassphrase: profile.sshAuthMethod === 'privateKey' ? sshPassphrase || undefined : undefined,
    }

    try {
      await connect(payloadProfile, secrets)
      saveProfile(profile)
      setSshPassword('')
      setSshPrivateKey('')
      setSshPassphrase('')
      onOpenChange(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to establish connection')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Remote OpenClaw Connection (SSH Tunnel)</DialogTitle>
          <DialogDescription>
            ClawPort will create a local tunnel to the remote OpenClaw gateway, then route requests through localhost.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Status: <strong style={{ color: 'var(--text-primary)' }}>{statusLabel}</strong>
            {status.localPort ? ` (localhost:${status.localPort})` : ''}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 160px' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>OpenClaw IP/Hostname</span>
              <input
                className="apple-input"
                value={profile.gatewayHost}
                onChange={(e) => setProfile({ ...profile, gatewayHost: e.target.value })}
                placeholder="192.168.1.42"
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Gateway Port</span>
              <input
                className="apple-input"
                type="number"
                value={profile.gatewayPort}
                onChange={(e) => setProfile({ ...profile, gatewayPort: Number(e.target.value || 18789) })}
                placeholder="18789"
              />
            </label>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 120px 1fr' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SSH Host</span>
              <input
                className="apple-input"
                value={profile.sshHost}
                onChange={(e) => setProfile({ ...profile, sshHost: e.target.value })}
                placeholder="openclaw-server.local"
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SSH Port</span>
              <input
                className="apple-input"
                type="number"
                value={profile.sshPort}
                onChange={(e) => setProfile({ ...profile, sshPort: Number(e.target.value || 22) })}
                placeholder="22"
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SSH User</span>
              <input
                className="apple-input"
                value={profile.sshUser}
                onChange={(e) => setProfile({ ...profile, sshUser: e.target.value })}
                placeholder="ubuntu"
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={profile.sshAuthMethod === 'privateKey'}
                onChange={() => setProfile({ ...profile, sshAuthMethod: 'privateKey' })}
              />
              Private Key
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input
                type="radio"
                checked={profile.sshAuthMethod === 'password'}
                onChange={() => setProfile({ ...profile, sshAuthMethod: 'password' })}
              />
              Password
            </label>
          </div>

          {profile.sshAuthMethod === 'privateKey' ? (
            <>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SSH Private Key (not persisted)</span>
                <textarea
                  className="apple-input"
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  rows={6}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  style={{ resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SSH Passphrase (optional, not persisted)</span>
                <input
                  className="apple-input"
                  type="password"
                  value={sshPassphrase}
                  onChange={(e) => setSshPassphrase(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SSH Password (not persisted)</span>
              <input
                className="apple-input"
                type="password"
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
              />
            </label>
          )}

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>OpenClaw Token (optional, not persisted)</span>
            <input
              className="apple-input"
              type="password"
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder="OPENCLAW_GATEWAY_TOKEN"
            />
          </label>

          {(formError || error || status.message) && (
            <div style={{ fontSize: 12, color: 'var(--system-red)' }}>
              {formError || error || status.message}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => reconnect().catch(() => {})}
              disabled={loading || !status.hasReconnectCredentials}
              className="btn-scale"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--separator)',
                background: 'var(--fill-tertiary)',
                color: 'var(--text-primary)',
                cursor: loading || !status.hasReconnectCredentials ? 'not-allowed' : 'pointer',
                opacity: loading || !status.hasReconnectCredentials ? 0.6 : 1,
              }}
            >
              Reconnect
            </button>
            <button
              type="button"
              onClick={() => disconnect().catch(() => {})}
              disabled={loading || status.status === 'disconnected'}
              className="btn-scale"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--separator)',
                background: 'var(--fill-tertiary)',
                color: 'var(--text-primary)',
                cursor: loading || status.status === 'disconnected' ? 'not-allowed' : 'pointer',
                opacity: loading || status.status === 'disconnected' ? 0.6 : 1,
              }}
            >
              Disconnect
            </button>
          </div>
          <button
            type="button"
            onClick={onConnect}
            disabled={loading}
            className="btn-scale"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
