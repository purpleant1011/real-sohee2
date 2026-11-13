'use client'

import { useState, useTransition } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [isPasswordUpdated, setIsPasswordUpdated] = useState(false)

  function submit(formData: FormData) {
    const password = formData.get('password') as string
    const passwordConfirmation = formData.get('passwordConfirmation') as string

    if (password !== passwordConfirmation) {
      setIsPasswordUpdated(false)
      setMessage('비밀번호가 서로 다릅니다.')
      return
    }

    startTransition(async () => {
      try {
        const supabase = createBrowserSupabaseClient()
        const { error } = await supabase.auth.updateUser({ password })
        if (error) {
          setIsPasswordUpdated(false)
          setMessage(error.message)
          return
        }

        setIsPasswordUpdated(true)
        setMessage('비밀번호가 성공적으로 변경되었습니다.')
      } catch (err: any) {
        setIsPasswordUpdated(false)
        setMessage(err?.message || '비밀번호 변경 중 오류가 발생했습니다.')
      }
    })
  }

  return (
    <main>
      <h1>새 비밀번호 설정</h1>
      <form action={submit}>
        <label htmlFor="password">새 비밀번호</label>
        <input id="password" name="password" type="password" minLength={8} required />
        <label htmlFor="passwordConfirmation">새 비밀번호 확인</label>
        <input id="passwordConfirmation" name="passwordConfirmation" type="password" minLength={8} required />
        <button type="submit" disabled={isPending}>비밀번호 변경</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {isPasswordUpdated ? <a href="/login">로그인으로 이동</a> : null}
    </main>
  )
}
