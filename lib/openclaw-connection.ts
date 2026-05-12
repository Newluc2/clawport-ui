export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type SshAuthMethod = 'privateKey' | 'password'

export interface OpenClawConnectionProfile {
  gatewayHost: string
  gatewayPort: number
  sshHost: string
  sshPort: number
  sshUser: string
  sshAuthMethod: SshAuthMethod
}

export interface OpenClawConnectionSecrets {
  sshPassword?: string
  sshPrivateKey?: string
  sshPassphrase?: string
  gatewayToken?: string
}

export interface OpenClawConnectionStatus {
  status: ConnectionStatus
  message: string | null
  profile: OpenClawConnectionProfile | null
  localPort: number | null
  hasReconnectCredentials: boolean
  usesTunnel: boolean
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json()
  if (!res.ok) {
    const message = typeof (data as { error?: unknown })?.error === 'string'
      ? (data as { error: string }).error
      : 'Request failed'
    throw new Error(message)
  }
  return data as T
}

export async function fetchOpenClawConnectionStatus(): Promise<OpenClawConnectionStatus> {
  const res = await fetch('/api/openclaw-connection', { cache: 'no-store' })
  return readJson<OpenClawConnectionStatus>(res)
}

export async function connectOpenClawConnection(
  profile: OpenClawConnectionProfile,
  secrets: OpenClawConnectionSecrets
): Promise<OpenClawConnectionStatus> {
  const res = await fetch('/api/openclaw-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'connect', profile, secrets }),
  })
  return readJson<OpenClawConnectionStatus>(res)
}

export async function reconnectOpenClawConnection(): Promise<OpenClawConnectionStatus> {
  const res = await fetch('/api/openclaw-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reconnect' }),
  })
  return readJson<OpenClawConnectionStatus>(res)
}

export async function disconnectOpenClawConnection(): Promise<OpenClawConnectionStatus> {
  const res = await fetch('/api/openclaw-connection', { method: 'DELETE' })
  return readJson<OpenClawConnectionStatus>(res)
}
