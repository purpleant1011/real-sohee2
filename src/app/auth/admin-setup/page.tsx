import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { activateInvitedOperatorAction, updateInvitedOperatorPasswordAction } from '@/features/operator-onboarding/actions'
import AdminSetupClient from '@/features/operator-onboarding/admin-setup-client'
import { getCurrentOperatorSetupContext } from '@/features/operator-onboarding/setup-context'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import styles from './admin-setup.module.css'

export async function submitAdminSetupPasswordAction(formData: FormData) {
  'use server'

  return updateInvitedOperatorPasswordAction({
    password: typeof formData.get('password') === 'string' ? formData.get('password') : '',
    passwordConfirmation: typeof formData.get('passwordConfirmation') === 'string'
      ? formData.get('passwordConfirmation')
      : '',
  })
}

export default async function AdminSetupPage() {
  await connection()
  const supabase = await createServerSupabaseClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  if (claimsError || typeof claimsData?.claims?.sub !== 'string') {
    redirect('/admin-login?next=%2Fadmin')
  }

  const context = await getCurrentOperatorSetupContext()
  if (!context) return <SetupMessage title="설정 상태를 확인할 수 없습니다." body="잠시 후 다시 시도해 주세요." />
  if (context.status === 'active' && context.currentAal === 'aal2') redirect('/admin')
  if (context.status === 'active' && context.hasVerifiedTotp && context.currentAal === 'aal1') {
    redirect('/auth/admin-verify?next=%2Fadmin')
  }
  if (context.status !== 'invited' && context.status !== 'active') {
    return <SetupMessage title="관리자 설정을 진행할 수 없습니다." body="이 계정에는 현재 관리자 설정이 열려 있지 않습니다." />
  }
  if (!context.emailConfirmed) {
    return <SetupMessage title="이메일 확인이 필요합니다." body="초대 메일의 확인 절차를 먼저 완료해 주세요." />
  }
  if (!context.hasRole) {
    return <SetupMessage title="관리자 설정을 진행할 수 없습니다." body="설정 권한을 확인하지 못했습니다." />
  }

  return <AdminSetupClient context={context} passwordAction={submitAdminSetupPasswordAction} activationAction={activateInvitedOperatorAction} />
}

function SetupMessage({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="admin-setup-title">
        <p className={styles.eyebrow}>Sohee 관리자 설정</p>
        <h1 id="admin-setup-title">{title}</h1>
        <p className={styles.description}>{body}</p>
      </section>
    </main>
  )
}
