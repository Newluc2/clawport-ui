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

const LEGACY_STORAGE_KEY = 'clawport-openclaw-connection-profile'
const PROFILES_STORAGE_KEY = 'clawport-openclaw-connection-profiles'
const ACTIVE_PROFILE_STORAGE_KEY = 'clawport-openclaw-connection-active-profile-id'

interface PersistedProfile {
  id: string
  name: string
  gatewayHost: string
  gatewayPort: number
  sshHost: string
  sshPort: number
  sshUser: string
  sshAuthMethod: SshAuthMethod
  gatewayToken?: string
}

const DEFAULT_PROFILE = {
  gatewayHost: '',
  gatewayPort: 18789,
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshAuthMethod: 'password',
} as const

function generateProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `profile-${Date.now()}`
}

function normalizeProfile(parsed: Partial<PersistedProfile>): PersistedProfile {
  return {
    id: typeof parsed.id === 'string' ? parsed.id : generateProfileId(),
    name: typeof parsed.name === 'string' ? parsed.name : 'OpenClaw',
    gatewayHost: typeof parsed.gatewayHost === 'string' ? parsed.gatewayHost : DEFAULT_PROFILE.gatewayHost,
    gatewayPort: typeof parsed.gatewayPort === 'number' ? parsed.gatewayPort : DEFAULT_PROFILE.gatewayPort,
    sshHost: typeof parsed.sshHost === 'string' ? parsed.sshHost : DEFAULT_PROFILE.sshHost,
    sshPort: typeof parsed.sshPort === 'number' ? parsed.sshPort : DEFAULT_PROFILE.sshPort,
    sshUser: typeof parsed.sshUser === 'string' ? parsed.sshUser : DEFAULT_PROFILE.sshUser,
    sshAuthMethod: parsed.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password',
    gatewayToken: typeof parsed.gatewayToken === 'string' ? parsed.gatewayToken : undefined,
  }
}

function createDraftProfile(): PersistedProfile {
  return {
    id: generateProfileId(),
    name: 'New OpenClaw',
    ...DEFAULT_PROFILE,
  }
}

function loadProfiles(): PersistedProfile[] {
  if (typeof window === 'undefined') return []
  try {
    const rawProfiles = localStorage.getItem(PROFILES_STORAGE_KEY)
    if (rawProfiles) {
      const parsed = JSON.parse(rawProfiles) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter((p): p is Partial<PersistedProfile> => Boolean(p && typeof p === 'object'))
          .map((p) => normalizeProfile(p))
      }
    }

    // Backward compatibility: migrate old single profile format.
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacyRaw) return []
    const legacyParsed = JSON.parse(legacyRaw) as Partial<PersistedProfile>
    const migrated = {
      id: generateProfileId(),
      name: legacyParsed.gatewayHost || 'OpenClaw',
      ...legacyParsed,
    }
    const normalized = normalizeProfile(migrated)
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify([normalized]))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return [normalized]
  } catch {
    return []
  }
}

function saveProfiles(profiles: PersistedProfile[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles))
}

function loadActiveProfileId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)
}

function saveActiveProfileId(profileId: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId)
}

function clearActiveProfileId() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY)
}

export function OpenClawConnectionModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { status, loading, error, connect, reconnect, disconnect } = useOpenClawConnection()

  const [profiles, setProfiles] = useState<PersistedProfile[]>(() => loadProfiles())
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => loadActiveProfileId() || '')
  const [profile, setProfile] = useState<PersistedProfile>(() => {
    const loaded = loadProfiles()
    const selected = loaded.find((p) => p.id === loadActiveProfileId()) || loaded[0]
    return selected ?? createDraftProfile()
  })
  const [sshPassword, setSshPassword] = useState('')
  const [sshPrivateKey, setSshPrivateKey] = useState('')
  const [sshPassphrase, setSshPassphrase] = useState('')
  const [gatewayToken, setGatewayToken] = useState(profile.gatewayToken || '')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const loaded = loadProfiles()
    setProfiles(loaded)

    const savedActiveId = loadActiveProfileId()
    const selected = loaded.find((p) => p.id === savedActiveId) || loaded[0] || createDraftProfile()

    setSelectedProfileId(selected.id)
    setProfile(selected)
    setGatewayToken(selected.gatewayToken || '')
    setSshPassword('')
    setSshPrivateKey('')
    setSshPassphrase('')
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

  function persistCurrentProfile(): PersistedProfile {
    const normalized: PersistedProfile = {
      ...profile,
      name: profile.name.trim() || profile.gatewayHost.trim() || 'OpenClaw',
      gatewayToken: gatewayToken.trim() || undefined,
    }

    const nextProfiles = profiles.some((p) => p.id === normalized.id)
      ? profiles.map((p) => (p.id === normalized.id ? normalized : p))
      : [...profiles, normalized]

    setProfiles(nextProfiles)
    setProfile(normalized)
    setSelectedProfileId(normalized.id)
    saveProfiles(nextProfiles)
    saveActiveProfileId(normalized.id)
    return normalized
  }

  function selectProfile(profileId: string) {
    const selected = profiles.find((p) => p.id === profileId)
    if (!selected) return
    setSelectedProfileId(selected.id)
    setProfile(selected)
    setGatewayToken(selected.gatewayToken || '')
    setSshPassword('')
    setSshPrivateKey('')
    setSshPassphrase('')
    saveActiveProfileId(selected.id)
  }

  function createNewProfile() {
    setSelectedProfileId('')
    setProfile(createDraftProfile())
    setGatewayToken('')
    setSshPassword('')
    setSshPrivateKey('')
    setSshPassphrase('')
    clearActiveProfileId()
  }

  function deleteSelectedProfile() {
    if (!selectedProfileId) return
    const nextProfiles = profiles.filter((p) => p.id !== selectedProfileId)
    setProfiles(nextProfiles)
    saveProfiles(nextProfiles)

    const next = nextProfiles[0]
    if (next) {
      setSelectedProfileId(next.id)
      setProfile(next)
      setGatewayToken(next.gatewayToken || '')
      saveActiveProfileId(next.id)
    } else {
      createNewProfile()
    }
  }

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
      sshPassword: profile.sshAuthMethod === 'password' ? sshPassword : undefined,
      sshPrivateKey: profile.sshAuthMethod === 'privateKey' ? sshPrivateKey : undefined,
      sshPassphrase: profile.sshAuthMethod === 'privateKey' ? sshPassphrase || undefined : undefined,
      gatewayToken: gatewayToken.trim() || undefined,
    }

    try {
      await connect(payloadProfile, secrets)
      persistCurrentProfile()
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
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        showCloseButton
        style={{
          background: 'var(--material-thick)',
          borderColor: 'var(--separator)',
          boxShadow: 'var(--shadow-overlay)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        }}
      >
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
            {!status.usesTunnel && status.status !== 'connecting' ? ' (Local OpenClaw)' : ''}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Saved OpenClaw Profiles</span>
              <select
                className="apple-input"
                value={selectedProfileId}
                onChange={(e) => {
                  const value = e.target.value
                  if (!value) {
                    createNewProfile()
                    return
                  }
                  selectProfile(value)
                }}
              >
                <option value="">New profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={createNewProfile}
              className="btn-scale"
              style={{
                alignSelf: 'end',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--separator)',
                background: 'var(--fill-tertiary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              New
            </button>
            <button
              type="button"
              onClick={deleteSelectedProfile}
              disabled={!selectedProfileId}
              className="btn-scale"
              style={{
                alignSelf: 'end',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--separator)',
                background: 'var(--fill-tertiary)',
                color: 'var(--text-primary)',
                cursor: !selectedProfileId ? 'not-allowed' : 'pointer',
                opacity: !selectedProfileId ? 0.6 : 1,
              }}
            >
              Delete
            </button>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr auto' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Profile Name</span>
              <input
                className="apple-input"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                placeholder="My Remote OpenClaw"
              />
            </label>
            <button
              type="button"
              onClick={persistCurrentProfile}
              className="btn-scale"
              style={{
                alignSelf: 'end',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--separator)',
                background: 'var(--fill-tertiary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Save Profile
            </button>
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

          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Recommended for LAN setup: use SSH Password authentication. Leave this empty to reuse local credentials, or enter the remote gateway token/password if it differs.
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>OpenClaw Gateway Token or Password (optional, saved in this browser profile)</span>
            <input
              className="apple-input"
              type="password"
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder="Falls back to local OPENCLAW_GATEWAY_TOKEN when empty"
            />
          </label>

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
              onClick={() => {
                disconnect().then(() => onOpenChange(false)).catch(() => {})
              }}
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
              Use Local OpenClaw
            </button>
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
            {loading ? 'Connecting...' : 'Connect Profile'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
