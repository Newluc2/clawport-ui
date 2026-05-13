// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'

const TEST_HOME = '/tmp/clawport-ui-connections-test-home'

vi.mock('os', () => ({
  homedir: () => TEST_HOME,
}))

import {
  addConnection,
  deleteConnection,
  fetchRemoteAgents,
  getConnectionById,
  getLocalConnection,
  listConnections,
  testConnectionHealth,
  type OpenClawConnection,
} from './connections'

describe('connections store', () => {
  beforeEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true })
    mkdirSync(TEST_HOME, { recursive: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns local connection initialized from env', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_TOKEN', 'local-token')
    vi.stubEnv('OPENCLAW_GATEWAY_PORT', '18791')
    vi.stubEnv('WORKSPACE_PATH', '/tmp/workspace')

    const local = getLocalConnection()

    expect(local.id).toBe('local')
    expect(local.label).toBe('Local')
    expect(local.gatewayUrl).toBe('http://localhost:18791')
    expect(local.gatewayToken).toBe('local-token')
    expect(local.workspacePath).toBe('/tmp/workspace')
    expect(local.isLocal).toBe(true)
  })

  it('adds and deletes remote connections while keeping local', () => {
    vi.stubEnv('OPENCLAW_GATEWAY_TOKEN', 'local-token')

    const added = addConnection({
      label: 'LAN',
      gatewayUrl: 'http://localhost:18790',
      gatewayToken: 'remote-token',
    })

    const all = listConnections()
    expect(all[0].id).toBe('local')
    expect(all.some((c) => c.id === added.id)).toBe(true)
    expect(getConnectionById(added.id)?.label).toBe('LAN')

    expect(deleteConnection('local')).toBe(false)
    expect(deleteConnection(added.id)).toBe(true)
    expect(listConnections().some((c) => c.id === added.id)).toBe(false)
  })

  it('tests connection health via gateway endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const connection: OpenClawConnection = {
      id: 'x',
      label: 'LAN',
      gatewayUrl: 'http://localhost:18790',
      gatewayToken: 'token',
      isLocal: false,
    }

    const result = await testConnectionHealth(connection)
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })

  it('fetches remote agents and normalizes basic fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 'main', name: 'Main', reportsTo: null, directReports: ['ops'] },
          { id: 'ops', identityName: 'Ops' },
        ]),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const agents = await fetchRemoteAgents({
      id: 'lan',
      label: 'LAN',
      gatewayUrl: 'http://localhost:18790',
      gatewayToken: 'token',
      isLocal: false,
    })

    expect(agents.length).toBe(2)
    expect(agents[0].id).toBe('main')
    expect(agents[1].name).toBe('Ops')
  })
})

