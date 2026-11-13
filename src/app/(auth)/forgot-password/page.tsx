'use client'

import { useState, useTransition } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit(formData: FormData) {
    const email = formData.get('email') as string
    startTransition(async () => {
      try {
        const supabase = createBrowserSupabaseClient()
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`
        })
        if (error) {
          setMessage(error.message)
          return
        }
        setMessage('비밀번호 재설정 링크가 이메일로 전송되었습니다.')
      } catch (err: any) {
        setMessage(err?.message || '요청 처리 중 오류가 발생했습니다.')
      }
    })
  }

  return (
    <main>
      <h1>비밀번호 재설정</h1>
      <p>가입한 이메일 주소를 입력하면 재설정 링크를 보내드립니다.</p>
      <form action={submit}>
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <button type="submit" disabled={isPending}>재설정 링크 보내기</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <a href="/login">로그인으로 돌아가기</a>
    </main>
  )
}
