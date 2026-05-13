import { Agent } from '@/lib/types'
import { readFileSync, existsSync } from 'fs'
import type { AgentEntry } from '@/lib/agents-registry'
import { loadRegistry } from '@/lib/agents-registry'
import { fetchRemoteAgents, listConnections, type OpenClawConnection } from '@/lib/connections'

function scopeId(connection: OpenClawConnection, id: string): string {
  return connection.isLocal ? id : `${connection.id}::${id}`
}

function loadSoul(entry: AgentEntry, workspacePath?: string): string | null {
  if (!entry.soulPath || !workspacePath) return null
  try {
    const fullPath = `${workspacePath}/${entry.soulPath}`
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, 'utf-8')
    }
  } catch {
    return null
  }
  return null
}

function buildConnectionAgents(
  connection: OpenClawConnection,
  registry: AgentEntry[],
): Agent[] {
  return registry.map((entry) => {
    const soul = connection.isLocal ? loadSoul(entry, connection.workspacePath) : null

    return {
      ...entry,
      id: scopeId(connection, entry.id),
      sourceAgentId: entry.id,
      connectionId: connection.id,
      connectionLabel: connection.label,
      reportsTo: entry.reportsTo ? scopeId(connection, entry.reportsTo) : null,
      directReports: entry.directReports.map((id) => scopeId(connection, id)),
      soul,
      crons: [],
    }
  })
}

export async function getAgents(): Promise<Agent[]> {
  const connections = listConnections()
  const localConnection = connections.find((connection) => connection.isLocal) || connections[0]
  const localAgents = localConnection
    ? buildConnectionAgents(localConnection, loadRegistry())
    : []

  const remoteConnections = connections.filter((connection) => !connection.isLocal)
  if (remoteConnections.length === 0) return localAgents

  const remoteRegistries = await Promise.all(
    remoteConnections.map(async (connection) => ({
      connection,
      registry: await fetchRemoteAgents(connection),
    }))
  )

  const remoteAgents = remoteRegistries.flatMap(({ connection, registry }) =>
    registry.length > 0 ? buildConnectionAgents(connection, registry) : []
  )

  return [...localAgents, ...remoteAgents]
}

export async function getAgent(id: string): Promise<Agent | null> {
  const agents = await getAgents()
  return agents.find((a) => a.id === id) ?? null
}
