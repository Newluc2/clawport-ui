import { Agent } from '@/lib/types'
import { readFileSync, existsSync } from 'fs'
import { buildRegistryFromCliAgents, loadRegistry } from '@/lib/agents-registry'
import { isRemoteOpenClawActive, listRemoteCliAgents } from '@/lib/openclaw-connection-server'

export async function getAgents(): Promise<Agent[]> {
  const remoteCliAgents = isRemoteOpenClawActive() ? await listRemoteCliAgents() : null
  const registry = remoteCliAgents && remoteCliAgents.length > 0
    ? buildRegistryFromCliAgents(remoteCliAgents)
    : loadRegistry()
  // Remote SSH mode currently discovers agents from the remote CLI only.
  // We intentionally skip SOUL.md loading here because remote filesystem reads
  // are not implemented yet, so all file-backed enrichment remains local-only.
  const workspacePath = remoteCliAgents && remoteCliAgents.length > 0
    ? ''
    : (process.env.WORKSPACE_PATH || '')

  return registry.map((entry) => {
    let soul: string | null = null
    if (entry.soulPath && workspacePath) {
      try {
        const fullPath = workspacePath + '/' + entry.soulPath
        if (existsSync(fullPath)) {
          soul = readFileSync(fullPath, 'utf-8')
        }
      } catch {
        soul = null
      }
    }
    return {
      ...entry,
      soul,
      crons: [],
    }
  })
}

export async function getAgent(id: string): Promise<Agent | null> {
  const agents = await getAgents()
  return agents.find((a) => a.id === id) ?? null
}
