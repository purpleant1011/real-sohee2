import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { reconcileNaverPostJobs } from '@/features/channel-studio/naver/reconcile-naver-post-jobs'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  jobId: z.string().uuid().optional(),
}).strict().optional()

export async function POST(request: Request) {
  try {
    await requireOperatorAnyScope('system.read')
  } catch (authErr) {
    if (authErr instanceof OperatorAccessError) {
      if (authErr.code === 'AUTH_REQUIRED' || authErr.code === 'MFA_REQUIRED') {
        return NextResponse.json({ error: '추가 인증(2단계)이 필요합니다.' }, { status: 401 })
      }
      return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
    }
    return NextResponse.json({ error: '운영자 권한을 확인해 주세요.' }, { status: 403 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    const text = await request.text()
    if (text && text.trim().length > 0) {
      const parsed = JSON.parse(text)
      const res = bodySchema.safeParse(parsed)
      if (!res.success) {
        return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
      }
      body = res.data
    }
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 형식입니다.' }, { status: 400 })
  }

  try {
    const admin = createAdminSupabaseClient()

    if (body?.jobId) {
      const { data: job, error: jobErr } = await (admin as any)
        .from('naver_post_jobs')
        .select('id, workspace_id, request_key, user_id, status, content_id, version_id, credit_reconcile_needed, created_at, updated_at')
        .eq('id', body.jobId)
        .maybeSingle()

      if (jobErr || !job) {
        return NextResponse.json({ error: '대사 대상 네이버 작업을 찾을 수 없습니다.' }, { status: 404 })
      }

      const summary = await reconcileNaverPostJobs({
        admin,
        deps: {
          findStuckRunningJobs: async () => (job.status === 'running' ? [job] : []),
          findFlaggedJobs: async () => [job],
        },
      })

      if (job.credit_reconcile_needed && summary.errors === 0) {
        await (admin as any)
          .from('naver_post_jobs')
          .update({
            credit_reconcile_needed: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      }

      return NextResponse.json({
        success: true,
        jobId: job.id,
        summary,
      })
    }

    const summary = await reconcileNaverPostJobs({ admin })
    return NextResponse.json({
      success: true,
      summary,
    })
  } catch (error) {
    console.error('[admin-naver-jobs-reconcile] execution error:', error)
    return NextResponse.json(
      { error: '네이버 포스트 크레딧 대사 처리에 실패했습니다.' },
      { status: 500 },
    )
  }
}
