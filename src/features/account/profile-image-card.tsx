'use client'

import { ImagePlus, Trash2, UserRound } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import {
  deleteProfileImageAction,
  initialProfileImageActionState,
  saveProfileImageAction,
} from './actions/profile-image-actions'
import styles from './profile-image-card.module.css'

export function ProfileImageCard({ avatarUrl }: Readonly<{ avatarUrl: string | null }>) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saveState, saveAction, savePending] = useActionState(
    saveProfileImageAction,
    initialProfileImageActionState,
  )
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteProfileImageAction,
    initialProfileImageActionState,
  )

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const state = deleteState.status !== 'idle' ? deleteState : saveState

  return (
    <section aria-labelledby="profile-image-title" className={styles.card}>
      <div className={styles.copy}>
        <h2 id="profile-image-title">내 프로필 사진</h2>
        <p>등록한 사진은 내 메시지와 계정 메뉴에 표시돼요.</p>
      </div>
      <div className={styles.content}>
        <div className={styles.preview}>
          {previewUrl ? (
            // User-selected blob URLs cannot use the Next image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="선택한 프로필 사진 미리보기" src={previewUrl} />
          ) : avatarUrl ? (
            // Signed private URLs are short-lived and bypass the Next image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="내 프로필 사진" src={avatarUrl} />
          ) : (
            <span aria-label="기본 프로필 아이콘" role="img"><UserRound aria-hidden="true" /></span>
          )}
        </div>
        <div className={styles.controls}>
          <form action={saveAction} className={styles.form}>
            <label className={styles.fileButton}>
              <ImagePlus aria-hidden="true" />
              사진 선택
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label="프로필 사진 선택"
                name="profileImage"
                onChange={(event) => {
                  const nextFile = event.currentTarget.files?.[0]
                  setPreviewUrl((current) => {
                    if (current) URL.revokeObjectURL(current)
                    return nextFile ? URL.createObjectURL(nextFile) : null
                  })
                }}
                type="file"
              />
            </label>
            <button disabled={savePending} type="submit">
              {savePending ? '저장 중' : '사진 저장'}
            </button>
          </form>
          <span className={styles.guidance}>JPEG, PNG 또는 WebP · 최대 5MB</span>
          {avatarUrl ? (
            <form action={deleteAction}>
              <button className={styles.deleteButton} disabled={deletePending} type="submit">
                <Trash2 aria-hidden="true" />
                {deletePending ? '삭제 중' : '사진 삭제'}
              </button>
            </form>
          ) : null}
          {state.message ? (
            <p aria-live="polite" className={styles.message} data-status={state.status} role={state.status === 'error' ? 'alert' : 'status'}>
              {state.message}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
