import { CronJob, CronDelivery } from '@/lib/types'
import { execSync } from 'child_process'
import { parseSchedule, describeCron } from './cron-utils'
import { loadRegistry } from '@/lib/agents-registry'
import { extractJobsArray, extractJson } from '@/lib/cli-utils'
import { isRemoteOpenClawActive, listRemoteCliAgents, listRemoteCronJobs } from './openclaw-connection-server'

/**
 * Match a cron job name to an agent by prefix.
 * Tries each known agent ID as a prefix (longest first to avoid
 * partial matches, e.g. "seo-team" matches before "seo").
 */
function matchAgent(name: string, agentIds: string[]): string | null {
  const sorted = [...agentIds].sort((a, b) => b.length - a.length)
  for (const id of sorted) {
    if (name === id || name.startsWith(id + '-')) return id
  }
  return null
}

let _cronsCache: { result: CronJob[]; ts: number } | null = null
const CRONS_TTL = 5000 // 5 seconds

/** Clear the crons cache (exported for testing). */
export function clearCronsCache(): void {
  _cronsCache = null
}

export async function getCrons(): Promise<CronJob[]> {
  if (_cronsCache && Date.now() - _cronsCache.ts < CRONS_TTL) {
    return _cronsCache.result
  }

  try {
    let jobs: unknown[]

    if (isRemoteOpenClawActive()) {
      const remoteJobs = await listRemoteCronJobs()
      if (!remoteJobs) return []
      jobs = remoteJobs
    } else {
      const openclawBin = process.env.OPENCLAW_BIN
      if (!openclawBin) {
        // No binary configured -- return empty list instead of crashing
        return []
      }

      let raw: string
      try {
        raw = execSync(`${openclawBin} cron list --json`, {
          encoding: 'utf-8',
          timeout: 10000,
        })
      } catch {
        // CLI failed (binary not found, no crons, gateway down) -- return empty
        return []
      }

      const parsed = extractJson(raw)
      jobs = extractJobsArray(parsed)
    }

    // Load known agent IDs for dynamic cron-to-agent matching
    const remoteCliAgents = isRemoteOpenClawActive() ? await listRemoteCliAgents() : null
    const remoteAgentIds = remoteCliAgents?.map(agent => agent.id).filter(Boolean) ?? []
    const agentIds = remoteAgentIds.length > 0
      ? remoteAgentIds
      : loadRegistry().map(a => a.id)

    const result = jobs.map((job: unknown) => {
      const j = job as Record<string, unknown>
      const state = (j.state as Record<string, unknown>) || {}
      const name = String(j.name || '')
      const { expression: schedule, timezone } = parseSchedule(j.schedule)

      // Status can be in state.status or directly on j.status
      const rawStatus = state.status ?? j.status ?? ''
      let status: 'ok' | 'error' | 'idle' = 'idle'
      if (rawStatus === 'error' || rawStatus === 'failed') {
        status = 'error'
      } else if (rawStatus === 'ok' || rawStatus === 'success' || rawStatus === 'completed') {
        status = 'ok'
      }

      // nextRun: try state.nextRunAtMs first, then state.nextRunAt
      const nextRunMs = state.nextRunAtMs ?? state.nextRunAt ?? j.nextRunAtMs ?? j.nextRunAt
      const nextRun = nextRunMs
        ? new Date(Number(nextRunMs)).toISOString()
        : null

      // lastRun: try state.lastRunAtMs, state.lastRunAt, or top-level equivalents
      const lastRunRaw = state.lastRunAtMs ?? state.lastRunAt ?? j.lastRunAtMs ?? j.lastRunAt ?? j.last
      const lastRun = lastRunRaw
        ? (typeof lastRunRaw === 'number' ? new Date(lastRunRaw).toISOString() : String(lastRunRaw))
        : null

      const lastError = (state.lastError ?? state.error ?? j.lastError) ? String(state.lastError ?? state.error ?? j.lastError) : null

      // Delivery config
      const rawDelivery = j.delivery as Record<string, unknown> | undefined
      let delivery: CronDelivery | null = null
      if (rawDelivery && typeof rawDelivery === 'object') {
        delivery = {
          mode: String(rawDelivery.mode || ''),
          channel: String(rawDelivery.channel || ''),
          to: rawDelivery.to ? String(rawDelivery.to) : null,
        }
      }

      // Rich state fields
      const lastDurationMs = typeof state.lastDurationMs === 'number' ? state.lastDurationMs : null
      const consecutiveErrors = typeof state.consecutiveErrors === 'number' ? state.consecutiveErrors : 0
      const lastDeliveryStatus = typeof state.lastDeliveryStatus === 'string' ? state.lastDeliveryStatus : null

      return {
        id: String(j.id || j.name || ''),
        name,
        schedule,
        scheduleDescription: describeCron(schedule),
        timezone,
        status,
        lastRun,
        nextRun,
        lastError,
        agentId: matchAgent(name, agentIds),
        description: typeof j.description === 'string' ? j.description : null,
        enabled: j.enabled !== false,
        delivery,
        lastDurationMs,
        consecutiveErrors,
        lastDeliveryStatus,
      }
    })

    _cronsCache = { result, ts: Date.now() }
    return result
  } catch {
    // JSON extraction or parsing failed -- return empty rather than 500
    return []
  }
}
