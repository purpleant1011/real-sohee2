'use client'

export default function OperatorError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string }
  reset: () => void
}>) {
  void reset
  const setupLink = 'code' in error && (error.code === 'MFA_REQUIRED' || error.code === 'OPERATOR_DISABLED')

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1>운영사 관리자 접근이 필요합니다</h1>
      <p>이 화면은 등록되고 추가 인증을 마친 운영사 관리자만 사용할 수 있습니다.</p>
      {setupLink ? <a href="/auth/admin-setup">관리자 추가 인증 설정으로 이동</a> : <a href="/admin-login?next=%2Fadmin">운영사 로그인으로 이동</a>}
    </main>
  )
}
