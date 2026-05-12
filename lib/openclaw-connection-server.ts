import { createServer, type Server } from 'net'
import { Client, type ClientChannel } from 'ssh2'
import { extractJson } from './cli-utils'
import type { CliAgentEntry } from './agents-registry'

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

interface GatewayConnectionTarget {
  baseUrl: string
  wsUrl: string
  token: string
  usesTunnel: boolean
}

interface RuntimeState {
  status: ConnectionStatus
  message: string | null
  profile: OpenClawConnectionProfile | null
  localPort: number | null
  hasReconnectCredentials: boolean
  usesTunnel: boolean
}

interface ActiveTunnel {
  client: Client
  server: Server
  localPort: number
  profile: OpenClawConnectionProfile
  remoteOpenClawBin: string | null
}

interface StoredReconnectSecrets {
  sshPassword?: string
  sshPrivateKey?: string
  sshPassphrase?: string
  gatewayToken?: string
}

const DEFAULT_GATEWAY_PORT = 18789
const DEFAULT_SSH_PORT = 22
const SSH_CONNECTION_TIMEOUT_MS = 15000
const RECONNECT_SECRETS_TTL_MINUTES = 30
const RECONNECT_SECRETS_TTL_MS = RECONNECT_SECRETS_TTL_MINUTES * 60 * 1000

let activeTunnel: ActiveTunnel | null = null
let reconnectProfile: OpenClawConnectionProfile | null = null
let reconnectSecrets: StoredReconnectSecrets | null = null
let reconnectSecretsExpiryTimer: ReturnType<typeof setTimeout> | null = null

const state: RuntimeState = {
  status: 'disconnected',
  message: null,
  profile: null,
  localPort: null,
  hasReconnectCredentials: false,
  usesTunnel: false,
}

function normalizePort(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Unknown connection error'
}

const SAFE_REMOTE_SHELL_TOKEN = /^[A-Za-z0-9_./:=+-]+$/

function assertSafeRemoteShellToken(value: string, label: string): string {
  if (!SAFE_REMOTE_SHELL_TOKEN.test(value)) {
    throw new Error(`Unsafe remote shell ${label}`)
  }
  return value
}

function setState(partial: Partial<RuntimeState>) {
  Object.assign(state, partial)
}

function clearReconnectSecretsTimer() {
  if (!reconnectSecretsExpiryTimer) return
  clearTimeout(reconnectSecretsExpiryTimer)
  reconnectSecretsExpiryTimer = null
}

function scheduleReconnectSecretsExpiry() {
  clearReconnectSecretsTimer()
  reconnectSecretsExpiryTimer = setTimeout(() => {
    reconnectSecrets = null
    reconnectProfile = null
    setState({ hasReconnectCredentials: false, profile: null })
  }, RECONNECT_SECRETS_TTL_MS)
}

function resetState(status: ConnectionStatus = 'disconnected', message: string | null = null) {
  setState({
    status,
    message,
    localPort: null,
    usesTunnel: false,
    profile: reconnectProfile,
    hasReconnectCredentials: Boolean(reconnectProfile && reconnectSecrets),
  })
}

function buildProfile(input: Partial<OpenClawConnectionProfile>): OpenClawConnectionProfile {
  const gatewayHost = (input.gatewayHost || '').trim()
  const sshHost = (input.sshHost || '').trim()
  const sshUser = (input.sshUser || '').trim()
  const sshAuthMethod: SshAuthMethod = input.sshAuthMethod === 'password' ? 'password' : 'privateKey'

  if (!gatewayHost) throw new Error('Gateway host is required')
  if (!sshHost) throw new Error('SSH host is required')
  if (!sshUser) throw new Error('SSH user is required')

  return {
    gatewayHost,
    gatewayPort: normalizePort(input.gatewayPort, DEFAULT_GATEWAY_PORT),
    sshHost,
    sshPort: normalizePort(input.sshPort, DEFAULT_SSH_PORT),
    sshUser,
    sshAuthMethod,
  }
}

function validateSecrets(profile: OpenClawConnectionProfile, secrets: OpenClawConnectionSecrets): StoredReconnectSecrets {
  const sshPassword = typeof secrets.sshPassword === 'string' ? secrets.sshPassword : undefined
  const sshPrivateKey = typeof secrets.sshPrivateKey === 'string' ? secrets.sshPrivateKey : undefined
  const sshPassphrase = typeof secrets.sshPassphrase === 'string' ? secrets.sshPassphrase : undefined
  const gatewayToken = typeof secrets.gatewayToken === 'string' ? secrets.gatewayToken : undefined

  if (profile.sshAuthMethod === 'password' && !sshPassword) {
    throw new Error('SSH password is required for password authentication')
  }
  if (profile.sshAuthMethod === 'privateKey' && !sshPrivateKey) {
    throw new Error('SSH private key is required for key authentication')
  }

  return {
    sshPassword,
    sshPrivateKey,
    sshPassphrase,
    gatewayToken,
  }
}

function openSshConnection(profile: OpenClawConnectionProfile, secrets: StoredReconnectSecrets): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      client.end()
      reject(new Error('SSH connection timed out'))
    }, SSH_CONNECTION_TIMEOUT_MS)

    client.once('ready', () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(client)
    })

    client.once('error', (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(err)
    })

    const common = {
      host: profile.sshHost,
      port: profile.sshPort,
      username: profile.sshUser,
      readyTimeout: SSH_CONNECTION_TIMEOUT_MS,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    }

    if (profile.sshAuthMethod === 'password') {
      client.connect({ ...common, password: secrets.sshPassword })
      return
    }

    client.connect({
      ...common,
      privateKey: secrets.sshPrivateKey,
      passphrase: secrets.sshPassphrase,
    })
  })
}

function createLocalForwardServer(client: Client, profile: OpenClawConnectionProfile): Promise<{ server: Server; localPort: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((localSocket) => {
      client.forwardOut(
        localSocket.remoteAddress || '127.0.0.1',
        localSocket.remotePort || 0,
        profile.gatewayHost,
        profile.gatewayPort,
        (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            localSocket.destroy(err)
            return
          }

          localSocket.pipe(stream)
          stream.pipe(localSocket)

          localSocket.on('error', () => {
            stream.destroy()
          })
          stream.on('error', () => {
            localSocket.destroy()
          })
        }
      )
    })

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to create local SSH tunnel'))
        return
      }
      resolve({ server, localPort: addr.port })
    })
  })
}

export async function disconnectOpenClawTunnel(message: string | null = null): Promise<void> {
  const tunnel = activeTunnel
  activeTunnel = null

  if (tunnel) {
    await new Promise<void>((resolve) => {
      tunnel.server.close((err) => {
        if (err) {
          console.error('SSH tunnel server close error:', err)
        }
        resolve()
      })
    })
    tunnel.client.end()
  }

  resetState('disconnected', message)
}

export async function connectOpenClawTunnel(input: {
  profile: Partial<OpenClawConnectionProfile>
  secrets: OpenClawConnectionSecrets
}): Promise<void> {
  const profile = buildProfile(input.profile)
  const secrets = validateSecrets(profile, input.secrets)

  await disconnectOpenClawTunnel()

  setState({
    status: 'connecting',
    message: null,
    profile,
    localPort: null,
    usesTunnel: false,
    hasReconnectCredentials: false,
  })

  try {
    const client = await openSshConnection(profile, secrets)
    const { server, localPort } = await createLocalForwardServer(client, profile)

    reconnectProfile = profile
    reconnectSecrets = secrets
    scheduleReconnectSecretsExpiry()

    activeTunnel = { client, server, localPort, profile, remoteOpenClawBin: null }

    client.on('close', () => {
      if (activeTunnel?.client === client) {
        activeTunnel.server.close(() => {})
        activeTunnel = null
        resetState('error', 'SSH tunnel closed')
      }
    })

    client.on('error', (err: Error) => {
      if (activeTunnel?.client === client) {
        activeTunnel.server.close(() => {})
        activeTunnel = null
        resetState('error', `SSH error: ${toErrorMessage(err)}`)
      }
    })

    server.on('error', (err) => {
      if (activeTunnel?.server === server) {
        activeTunnel = null
        resetState('error', `Tunnel error: ${toErrorMessage(err)}`)
      }
    })

    setState({
      status: 'connected',
      message: null,
      profile,
      localPort,
      hasReconnectCredentials: true,
      usesTunnel: true,
    })
  } catch (err) {
    activeTunnel = null
    resetState('error', toErrorMessage(err))
    throw err
  }
}

export async function reconnectOpenClawTunnel(): Promise<void> {
  if (!reconnectProfile || !reconnectSecrets) {
    throw new Error('No previous connection credentials available for reconnect')
  }

  await connectOpenClawTunnel({ profile: reconnectProfile, secrets: reconnectSecrets })
}

export function clearReconnectCredentials() {
  clearReconnectSecretsTimer()
  reconnectSecrets = null
  setState({ hasReconnectCredentials: false })
}

export function getOpenClawConnectionStatus(): RuntimeState {
  return { ...state }
}

export function isRemoteOpenClawActive(): boolean {
  return Boolean(activeTunnel && state.status === 'connected' && state.usesTunnel)
}

async function execOnActiveTunnel(command: string, timeoutMs = SSH_CONNECTION_TIMEOUT_MS): Promise<string> {
  const tunnel = activeTunnel
  if (!tunnel) {
    throw new Error('No active SSH tunnel')
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Remote command timed out'))
    }, timeoutMs)

    tunnel.client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timeout)
        reject(err)
        return
      }

      stream.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
      })

      stream.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
      })

      stream.on('close', (code?: number) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (code && code !== 0) {
          reject(new Error(stderr.trim() || `Remote command failed with exit code ${code}`))
          return
        }
        resolve(stdout.trim())
      })

      stream.on('error', (streamErr: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(streamErr)
      })
    })
  })
}

async function getRemoteOpenClawBin(): Promise<string> {
  const tunnel = activeTunnel
  if (!tunnel) throw new Error('No active SSH tunnel')
  if (tunnel.remoteOpenClawBin) return tunnel.remoteOpenClawBin

  try {
    const detected = await execOnActiveTunnel('command -v openclaw', 5000)
    tunnel.remoteOpenClawBin = assertSafeRemoteShellToken(detected, 'binary path')
  } catch {
    throw new Error('Unable to find the openclaw binary on the remote host')
  }

  return tunnel.remoteOpenClawBin
}

export async function runRemoteOpenClawCommand(args: string[], timeoutMs = 15000): Promise<string> {
  const bin = await getRemoteOpenClawBin()
  const command = [
    assertSafeRemoteShellToken(bin, 'binary path'),
    ...args.map((arg, index) => assertSafeRemoteShellToken(arg, `argument ${index + 1}`)),
  ].join(' ')
  return execOnActiveTunnel(command, timeoutMs)
}

export async function listRemoteCliAgents(): Promise<CliAgentEntry[] | null> {
  if (!isRemoteOpenClawActive()) return null

  try {
    const raw = await runRemoteOpenClawCommand(['agents', 'list', '--json'])
    const parsed = extractJson(raw)
    return Array.isArray(parsed) ? parsed as CliAgentEntry[] : null
  } catch {
    return null
  }
}

export async function listRemoteCronJobs(): Promise<unknown[] | null> {
  if (!isRemoteOpenClawActive()) return null

  try {
    const raw = await runRemoteOpenClawCommand(['cron', 'list', '--json'])
    const parsed = extractJson(raw) as Record<string, unknown> | unknown[]
    let jobs: unknown[] = []
    if (Array.isArray(parsed)) {
      jobs = parsed
    } else if (Array.isArray((parsed as Record<string, unknown>).jobs)) {
      jobs = (parsed as Record<string, unknown>).jobs as unknown[]
    } else if (Array.isArray((parsed as Record<string, unknown>).data)) {
      jobs = (parsed as Record<string, unknown>).data as unknown[]
    }
    return jobs
  } catch {
    return null
  }
}

export function getActiveGatewayConnection(): GatewayConnectionTarget {
  if (activeTunnel && state.localPort) {
    const token = reconnectSecrets?.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN || ''
    return {
      baseUrl: `http://127.0.0.1:${state.localPort}/v1`,
      wsUrl: `ws://127.0.0.1:${state.localPort}`,
      token,
      usesTunnel: true,
    }
  }

  const defaultPort = normalizePort(
    process.env.OPENCLAW_GATEWAY_PORT ? parseInt(process.env.OPENCLAW_GATEWAY_PORT, 10) : undefined,
    DEFAULT_GATEWAY_PORT
  )

  return {
    baseUrl: `http://localhost:${defaultPort}/v1`,
    wsUrl: `ws://localhost:${defaultPort}`,
    token: process.env.OPENCLAW_GATEWAY_TOKEN || '',
    usesTunnel: false,
  }
}
