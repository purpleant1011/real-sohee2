export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { getOperatorWorkspace } from '@/features/operator-workspaces/repository'
import { workspaceIdSchema } from '@/features/operator-workspaces/schemas'

type Context = Readonly<{ params: Promise<Readonly<{ workspaceId: string }>> }>

function safeStatus(error: unknown): number {
  const code = error instanceof Error ? error.message : ''
  if (code === 'AUTH_REQUIRED') return 401
  if (code === 'MFA_REQUIRED' || code === 'OPERATOR_DISABLED' || code === 'PERMISSION_DENIED' || code === 'WORKSPACE_SCOPE_DENIED') return 403
  return 503
}

export async function GET(_request: Request, context: Context) {
  const { workspaceId } = await context.params
  if (!workspaceIdSchema.safeParse(workspaceId).success) {
    return NextResponse.json({ code: 'WORKSPACE_INPUT_INVALID' }, { status: 400, headers: { 'cache-control': 'private, no-store' } })
  }
  try {
    await requireOperator('workspace.read', workspaceId)
  } catch (error) {
    return NextResponse.json({ code: 'OPERATOR_ACCESS_DENIED' }, { status: safeStatus(error), headers: { 'cache-control': 'private, no-store' } })
  }
  const result = await getOperatorWorkspace(workspaceId)
  if (result.error !== null || result.data === null) {
    const responseStatus = result.error === 'WORKSPACE_INPUT_INVALID' ? 400 : result.error === 'AUTH_REQUIRED' ? 401 : result.error === 'MFA_REQUIRED' || result.error === 'OPERATOR_DISABLED' || result.error === 'PERMISSION_DENIED' || result.error === 'OPERATOR_SCOPE_DENIED' ? 403 : 503
    return NextResponse.json({ code: result.error }, { status: responseStatus, headers: { 'cache-control': 'private, no-store' } })
  }
  return NextResponse.json({ data: { id: result.data.workspaceId, ...result.data } }, { headers: { 'cache-control': 'private, no-store' } })
}
