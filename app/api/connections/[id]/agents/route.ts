export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { fetchRemoteAgents, getConnectionById } from '@/lib/connections'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const connection = getConnectionById(id)
  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  if (connection.isLocal) {
    return NextResponse.json({ agents: [] })
  }

  const agents = await fetchRemoteAgents(connection)
  return NextResponse.json({ agents })
}

