export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { listOperatorWorkspaces } from '@/features/operator-workspaces/repository'
import { lifecycleStatusSchema } from '@/features/operator-workspaces/schemas'

function safeStatus(error: unknown): number {
  const code = error instanceof Error ? error.message : ''
  if (code === 'AUTH_REQUIRED') return 401
  if (code === 'MFA_REQUIRED' || code === 'OPERATOR_DISABLED' || code === 'PERMISSION_DENIED' || code === 'WORKSPACE_SCOPE_DENIED') return 403
  return 503
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams
  const page = Number(search.get('page') ?? '1')
  const pageSize = Number(search.get('pageSize') ?? '50')
  const query = search.get('query')?.trim() || null
  const statusValue = search.get('status')?.trim() || null
  const status = statusValue === null ? null : lifecycleStatusSchema.safeParse(statusValue)
  if (page !== 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || (status !== null && !status.success) || (query !== null && query.length > 120)) {
    return NextResponse.json({ code: 'WORKSPACE_INPUT_INVALID' }, { status: 400, headers: { 'cache-control': 'private, no-store' } })
  }
  try {
    await requireOperatorAnyScope('workspace.read')
  } catch (error) {
    return NextResponse.json({ code: 'OPERATOR_ACCESS_DENIED' }, { status: safeStatus(error), headers: { 'cache-control': 'private, no-store' } })
  }
  const result = await listOperatorWorkspaces({ cursor: null, query, status: status === null ? null : status.data, limit: pageSize })
  if (result.error !== null || result.data === null) {
    const responseStatus = result.error === 'WORKSPACE_INPUT_INVALID' || result.error === 'CURSOR_INVALID' ? 400 : result.error === 'AUTH_REQUIRED' ? 401 : result.error === 'MFA_REQUIRED' || result.error === 'OPERATOR_DISABLED' || result.error === 'PERMISSION_DENIED' || result.error === 'OPERATOR_SCOPE_DENIED' ? 403 : 503
    return NextResponse.json({ code: result.error }, { status: responseStatus, headers: { 'cache-control': 'private, no-store' } })
  }
  const data = result.data.items.map((item) => ({ id: item.workspaceId, ...item }))
  return NextResponse.json({ data, total: data.length + (result.data.nextCursor ? 1 : 0), nextCursor: result.data.nextCursor }, { headers: { 'cache-control': 'private, no-store' } })
}
