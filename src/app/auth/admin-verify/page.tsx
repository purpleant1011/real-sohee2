import { redirect } from 'next/navigation'
import { safeOperatorNextPath } from '@/features/auth/safe-operator-next-path'
import { getCurrentOperatorSetupContext } from '@/features/operator-onboarding/setup-context'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import AdminVerifyClient from './verify-client'
import styles from '../admin-setup/admin-setup.module.css'

type Props = Readonly<{ searchParams?: Promise<{ next?: string }> }>

export default async function AdminVerifyPage({ searchParams }: Props) {
  const next = safeOperatorNextPath((await searchParams)?.next)
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || typeof data?.claims?.sub !== 'string') {
    redirect(`/admin-login?next=${encodeURIComponent(next)}`)
  }

  const context = await getCurrentOperatorSetupContext()
  if (!context) {
    return <VerifyMessage title="인증 상태를 확인할 수 없습니다." body="잠시 후 다시 시도해 주세요." />
  }
  if (!context.hasRole || !context.emailConfirmed || context.status === 'not_invited') {
    return <VerifyMessage title="관리자 인증을 진행할 수 없습니다." body="등록된 관리자 계정인지 확인해 주세요." />
  }
  if (context.status === 'invited' || !context.hasVerifiedTotp) {
    redirect('/auth/admin-setup')
  }
  if (context.status !== 'active') {
    return <VerifyMessage title="관리자 인증을 진행할 수 없습니다." body="계정 상태를 확인해 주세요." />
  }
  if (context.currentAal === 'aal2') redirect(next)

  // AAL1 users must complete the verified-factor challenge before entering /admin.
  return <AdminVerifyClient next={next} />
}

function VerifyMessage({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="admin-verify-title">
        <h1 id="admin-verify-title">{title}</h1>
        <p className={styles.description}>{body}</p>
      </section>
    </main>
  )
}
