export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { addConnection, listConnections } from '@/lib/connections'

export async function GET() {
  return NextResponse.json(listConnections())
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  try {
    const created = addConnection({
      label: typeof payload.label === 'string' ? payload.label : '',
      gatewayUrl: typeof payload.gatewayUrl === 'string' ? payload.gatewayUrl : '',
      gatewayToken: typeof payload.gatewayToken === 'string' ? payload.gatewayToken : '',
      workspacePath: typeof payload.workspacePath === 'string' ? payload.workspacePath : undefined,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add connection'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

