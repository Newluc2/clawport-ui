export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getConnectionById, testConnectionHealth } from '@/lib/connections'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const connection = getConnectionById(id)
  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  const health = await testConnectionHealth(connection)
  return NextResponse.json(health, { status: health.ok ? 200 : 502 })
}

