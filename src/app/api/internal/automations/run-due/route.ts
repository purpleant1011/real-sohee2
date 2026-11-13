import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createProductionReportOnlyRuntime } from '@/features/automation/production-report-only-due'
import { runReportOnlyDueAutomations } from '@/features/automation/report-only-due-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!expected || expected.length < 20 || !supplied?.startsWith('Bearer ')) return false
  const left = Buffer.from(supplied.slice(7))
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const result = await runReportOnlyDueAutomations(new Date(), randomUUID(), createProductionReportOnlyRuntime())
    const runs = result.runs
    return NextResponse.json({
      claimed: runs.length,
      completed: runs.filter((run) => run.status === 'succeeded').length,
      skipped: runs.filter((run) => run.status === 'skipped_credit_cap' || run.status === 'skipped_inactive').length,
      failed: runs.filter((run) => run.status === 'failed').length,
    })
  } catch {
    return NextResponse.json({ error: 'automation_unavailable' }, { status: 503 })
  }
}
