export const runtime = 'nodejs'

import {
  clearReconnectCredentials,
  connectOpenClawTunnel,
  disconnectOpenClawTunnel,
  getOpenClawConnectionStatus,
  reconnectOpenClawTunnel,
} from '@/lib/openclaw-connection-server'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET() {
  return jsonResponse(getOpenClawConnectionStatus())
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const payload = body as Record<string, unknown>
  const action = typeof payload.action === 'string' ? payload.action : 'connect'

  try {
    if (action === 'reconnect') {
      await reconnectOpenClawTunnel()
      return jsonResponse(getOpenClawConnectionStatus())
    }

    const profile = (payload.profile || {}) as Record<string, unknown>
    const secrets = (payload.secrets || {}) as Record<string, unknown>

    await connectOpenClawTunnel({
      profile: {
        gatewayHost: typeof profile.gatewayHost === 'string' ? profile.gatewayHost : '',
        gatewayPort: typeof profile.gatewayPort === 'number' ? profile.gatewayPort : undefined,
        sshHost: typeof profile.sshHost === 'string' ? profile.sshHost : '',
        sshPort: typeof profile.sshPort === 'number' ? profile.sshPort : undefined,
        sshUser: typeof profile.sshUser === 'string' ? profile.sshUser : '',
        sshAuthMethod: profile.sshAuthMethod === 'password' ? 'password' : 'privateKey',
      },
      secrets: {
        sshPassword: typeof secrets.sshPassword === 'string' ? secrets.sshPassword : undefined,
        sshPrivateKey: typeof secrets.sshPrivateKey === 'string' ? secrets.sshPrivateKey : undefined,
        sshPassphrase: typeof secrets.sshPassphrase === 'string' ? secrets.sshPassphrase : undefined,
        gatewayToken: typeof secrets.gatewayToken === 'string' ? secrets.gatewayToken : undefined,
      },
    })

    return jsonResponse(getOpenClawConnectionStatus())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return jsonResponse({ error: message, status: getOpenClawConnectionStatus() }, 400)
  }
}

export async function DELETE() {
  await disconnectOpenClawTunnel('Disconnected')
  clearReconnectCredentials()
  return jsonResponse(getOpenClawConnectionStatus())
}
