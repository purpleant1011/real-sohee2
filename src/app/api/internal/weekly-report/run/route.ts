import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'

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
    const admin = createAdminSupabaseClient()
    const service = new WeeklyCeoReportService(admin)
    const { data: workspaces, error } = await admin.from('workspaces').select('id').limit(50)
    if (error || !Array.isArray(workspaces)) {
      return NextResponse.json({ error: '사업장 기록을 조회하지 못했어요.' }, { status: 503 })
    }
    let reportsComputed = 0
    let reportsFailed = 0
    let reportsSkipped = 0
    for (const workspace of workspaces) {
      try {
        const report = await service.generateReport(workspace.id)
        if (Object.values(report.metrics).some((metric) => metric.state === 'ERROR')) reportsFailed++
        else if (report.datasetMode !== 'ACTUAL') reportsSkipped++
        else reportsComputed++
      } catch {
        reportsFailed++
      }
    }
    // This job computes reports only; it does not persist or deliver them.
    return NextResponse.json({
      success: reportsFailed === 0,
      workspacesProcessed: workspaces.length,
      reportsComputed,
      reportsFailed,
      reportsSkipped,
      deliveryState: 'NOT_SENT',
      batchLimit: 50,
      executedAt: new Date().toISOString(),
    }, { status: reportsFailed === 0 ? 200 : reportsFailed === workspaces.length ? 503 : 207 })
  } catch {
    return NextResponse.json({ error: '내부 주간 보고 계산 중 오류가 발생했어요.' }, { status: 500 })
  }
}
