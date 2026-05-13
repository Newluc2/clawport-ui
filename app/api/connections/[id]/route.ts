export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { deleteConnection } from '@/lib/connections'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const deleted = deleteConnection(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Connection not found or not deletable' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

