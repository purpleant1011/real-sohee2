'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createContentItemAction } from './actions/create-item'
import styles from './content.module.css'

export function NewContentForm({ workspaceId }: Readonly<{ workspaceId: string }>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function submit(formData: FormData) {
    setMessage('')
    startTransition(async () => {
      const result = await createContentItemAction({
        workspaceId,
        title: formData.get('title'),
        channel: formData.get('channel'),
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      router.push(result.data.next)
      router.refresh()
    })
  }

  return (
    <form className={styles.newForm} action={submit}>
      <div>
        <p className={styles.eyebrow}>NEW CONTENT</p>
        <h1>새 콘텐츠 시작</h1>
        <p className={styles.pageIntro}>제목과 채널로 안전한 초안을 만든 뒤 첫 버전을 작성합니다.</p>
      </div>
      <label className={styles.field}>
        작업 제목
        <input name="title" required maxLength={200} autoComplete="off" />
      </label>
      <label className={styles.field}>
        게시 채널
        <select name="channel" defaultValue="instagram">
          <option value="instagram">인스타그램</option>
          <option value="threads">스레드</option>
          <option value="naver_blog">네이버 블로그</option>
          <option value="naver_place">네이버 플레이스</option>
        </select>
      </label>
      {message ? <p className={styles.formMessage} role="alert">{message}</p> : null}
      <div className={styles.formActions}>
        <button className={styles.formButton} type="submit" disabled={pending}>
          {pending ? '만드는 중…' : '초안 만들기'}
        </button>
      </div>
    </form>
  )
}
