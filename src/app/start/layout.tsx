import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { StartEntry } from '@/components/start/start-entry'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '소희 시작하기 · 10분이면 첫 게시물',
  description: '가게 정보를 알려주고 인스타그램·스레드를 연결하면, 소희가 첫 게시물을 만들어 미리 보여드려요.',
}

export default async function StartLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const claims = await supabase?.auth?.getClaims?.()
  const isSignedIn = Boolean(claims?.data?.claims?.sub)

  // 이미 시작을 마친 계정이 m.example.com 등에서 /start 로 들어오면 사업자 가입을 다시 시키지 않는다.
  // 판정은 /app 입구(protected-app-content)와 같은 규칙을 쓴다.
  if (isSignedIn) {
    const { readAppWorkspace } = await import('@/features/auth/app-workspace.server')
    const { workspace, userId } = await readAppWorkspace()
    if (workspace?.workspaceId) {
      const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
      const { getSoheeReadiness } = await import('@/features/sohee-ready/read-model')
      const { resolveAppShellMode } = await import('@/features/sohee-ready/shell-resolver')
      const { evaluateReadiness } = await import('@/features/readiness')
      const { isApplicationSubmitted, resolveStartPageRedirect } = await import('@/features/business-verification/entry-gate')
      const { isReviewAccountUser } = await import('@/features/business-verification/review-account')
      let adminClient: any
      try { adminClient = createAdminSupabaseClient() } catch { adminClient = undefined }
      const [readiness, { data: bvRow }] = await Promise.all([
        getSoheeReadiness(workspace.workspaceId, { supabaseClient: supabase, adminClient }),
        (supabase as any).from('business_verifications').select('status, document_url').eq('workspace_id', workspace.workspaceId).maybeSingle(),
      ])
      const effectiveUserId = userId ?? (typeof claims?.data?.claims?.sub === 'string' ? claims.data.claims.sub : null)
      const target = resolveStartPageRedirect({
        applicationSubmitted: isApplicationSubmitted({ status: bvRow?.status, hasDocument: Boolean(bvRow?.document_url) }),
        prepared: evaluateReadiness(readiness).prepared,
        educationShell: resolveAppShellMode(readiness) === 'EDUCATION_SHELL',
        reviewAccount: isReviewAccountUser(effectiveUserId, process.env),
      })
      if (target) redirect(target)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-accent/60 via-background to-background text-foreground">
      {isSignedIn ? children : <StartEntry />}
    </div>
  )
}
