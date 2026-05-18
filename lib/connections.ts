import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AgentEntry } from '@/lib/agents-registry'
import { getOpenClawConnectionStatus, getActiveGatewayConnection } from '@/lib/openclaw-connection-server'

export interface OpenClawConnection {
  id: string
  label: string
  gatewayUrl: string
  gatewayToken: string
  workspacePath?: string
  isLocal: boolean
}

interface StoredConnection {
  id: string
  label: string
  gatewayUrl: string
  gatewayToken: string
  workspacePath?: string
}

export interface ConnectionHealthResult {
  ok: boolean
  status: number | null
  message: string
}

const LOCAL_CONNECTION_ID = 'local'
const DEFAULT_GATEWAY_PORT = 18789
const REQUEST_TIMEOUT_MS = 5000

function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const parsed = new URL(normalized)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    throw new Error('Invalid gateway URL')
  }
}

function baseApiUrl(gatewayUrl: string): string {
  return `${gatewayUrl.replace(/\/+$/, '')}/v1`
}

export function gatewayWsUrl(gatewayUrl: string): string {
  const parsed = new URL(gatewayUrl)
  const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${parsed.host}`
}

function connectionsFilePath(): string {
  return join(homedir(), '.config', 'clawport-ui', 'connections.json')
}

function ensureConfigDir(): void {
  mkdirSync(join(homedir(), '.config', 'clawport-ui'), { recursive: true })
}

function parseStoredConnection(value: unknown): StoredConnection | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id : ''
  const label = typeof obj.label === 'string' ? obj.label.trim() : ''
  const gatewayUrl = typeof obj.gatewayUrl === 'string' ? obj.gatewayUrl : ''
  const gatewayToken = typeof obj.gatewayToken === 'string' ? obj.gatewayToken.trim() : ''
  const workspacePath = typeof obj.workspacePath === 'string' ? obj.workspacePath.trim() : undefined
  if (!id || !label || !gatewayUrl || !gatewayToken) return null
  return {
    id,
    label,
    gatewayUrl: normalizeGatewayUrl(gatewayUrl),
    gatewayToken,
    workspacePath: workspacePath || undefined,
  }
}

function readStoredConnections(): StoredConnection[] {
  const filePath = connectionsFilePath()
  if (!existsSync(filePath)) return []
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(parseStoredConnection)
      .filter((connection): connection is StoredConnection => connection !== null)
  } catch {
    return []
  }
}

function writeStoredConnections(connections: StoredConnection[]): void {
  ensureConfigDir()
  writeFileSync(connectionsFilePath(), JSON.stringify(connections, null, 2), 'utf-8')
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getLocalConnection(): OpenClawConnection {
  const configured = process.env.OPENCLAW_GATEWAY_URL
  const port = parseInt(process.env.OPENCLAW_GATEWAY_PORT || `${DEFAULT_GATEWAY_PORT}`, 10)
  const gatewayUrl = normalizeGatewayUrl(configured || `http://localhost:${Number.isFinite(port) ? port : DEFAULT_GATEWAY_PORT}`)

  return {
    id: LOCAL_CONNECTION_ID,
    label: 'Local',
    gatewayUrl,
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || '',
    workspacePath: process.env.WORKSPACE_PATH || undefined,
    isLocal: true,
  }
}

export function listConnections(): OpenClawConnection[] {
  const local = getLocalConnection()
  const remotes = readStoredConnections()
    .filter((connection) => connection.id !== LOCAL_CONNECTION_ID)
    .map((connection) => ({
      ...connection,
      isLocal: false as const,
    }))

  // Add the active SSH tunnel as a temporary connection if available and healthy
  const tunnelConnection: OpenClawConnection | null = (() => {
    try {
      const status = getOpenClawConnectionStatus()
      if (status.status === 'connected' && status.usesTunnel && status.localPort) {
        const gw = getActiveGatewayConnection()
        // Only include tunnel if it has a valid token and gateway URL
        if (!gw.token || !gw.baseUrl) return null
        return {
          id: 'tunnel',
          label: `Tunnel (port ${status.localPort})`,
          gatewayUrl: gw.baseUrl.replace(/\/v1$/, ''),
          gatewayToken: gw.token,
          isLocal: false,
        }
      }
    } catch {
      // Silently ignore errors — tunnel not available
    }
    return null
  })()

  const connections = [local, ...remotes]
  if (tunnelConnection) {
    connections.push(tunnelConnection)
  }
  return connections
}

export function getConnectionById(id: string): OpenClawConnection | null {
  return listConnections().find((connection) => connection.id === id) || null
}

export function addConnection(input: {
  label: string
  gatewayUrl: string
  gatewayToken: string
  workspacePath?: string
}): OpenClawConnection {
  const label = input.label.trim()
  const gatewayUrl = normalizeGatewayUrl(input.gatewayUrl)
  const gatewayToken = input.gatewayToken.trim()
  const workspacePath = input.workspacePath?.trim() || undefined

  if (!label) throw new Error('Connection label is required')
  if (!gatewayToken) throw new Error('Gateway token or gateway password is required')

  const stored = readStoredConnections()
  const next: StoredConnection = {
    id: randomId(),
    label,
    gatewayUrl,
    gatewayToken,
    workspacePath,
  }
  writeStoredConnections([...stored, next])

  return { ...next, isLocal: false }
}

export function deleteConnection(id: string): boolean {
  if (!id || id === LOCAL_CONNECTION_ID) return false
  const stored = readStoredConnections()
  const next = stored.filter((connection) => connection.id !== id)
  if (next.length === stored.length) return false
  writeStoredConnections(next)
  return true
}

function withTimeout(signalTimeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), signalTimeoutMs)
  return controller.signal
}

function authHeaders(token: string): HeadersInit {
  const headers: Record<string, string> = {}
  if (token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`
  }
  return headers
}

async function fetchJson(url: string, token: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    headers: authHeaders(token),
    cache: 'no-store',
    signal: withTimeout(),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

export async function testConnectionHealth(connection: OpenClawConnection): Promise<ConnectionHealthResult> {
  const urls = [
    `${baseApiUrl(connection.gatewayUrl)}/health`,
    `${connection.gatewayUrl.replace(/\/+$/, '')}/health`,
  ]

  for (const url of urls) {
    try {
      const { status } = await fetchJson(url, connection.gatewayToken)
      if (status >= 200 && status < 300) {
        return { ok: true, status, message: 'Connection healthy' }
      }
      return { ok: false, status, message: `Health check failed (${status})` }
    } catch {
      // try next URL
    }
  }

  return { ok: false, status: null, message: 'Connection unreachable' }
}

function normalizeRemoteAgent(value: unknown, index: number): AgentEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null
  const name = typeof raw.name === 'string' ? raw.name : (typeof raw.identityName === 'string' ? raw.identityName : id)
  const directReports = Array.isArray(raw.directReports)
    ? raw.directReports.filter((v): v is string => typeof v === 'string')
    : []

  return {
    id,
    name,
    title: typeof raw.title === 'string' ? raw.title : 'Agent',
    reportsTo: typeof raw.reportsTo === 'string' ? raw.reportsTo : null,
    directReports,
    soulPath: null,
    voiceId: null,
    color: typeof raw.color === 'string' ? raw.color : ['#a855f7', '#3b82f6', '#22c55e', '#f97316', '#14b8a6'][index % 5],
    emoji: typeof raw.emoji === 'string' ? raw.emoji : name.charAt(0).toUpperCase(),
    tools: Array.isArray(raw.tools) ? raw.tools.filter((v): v is string => typeof v === 'string') : ['read', 'write'],
    model: typeof raw.model === 'string' ? raw.model : null,
    memoryPath: null,
    description: typeof raw.description === 'string' ? raw.description : `${name} agent.`,
  }
}

export async function fetchRemoteAgents(connection: OpenClawConnection): Promise<AgentEntry[]> {
  if (connection.isLocal) return []
  const url = `${baseApiUrl(connection.gatewayUrl)}/agents`
  try {
    const { status, data } = await fetchJson(url, connection.gatewayToken)
    if (status < 200 || status >= 300 || !Array.isArray(data)) return []
    return data
      .map((entry, index) => normalizeRemoteAgent(entry, index))
      .filter((entry): entry is AgentEntry => entry !== null)
  } catch {
    return []
  }
}
