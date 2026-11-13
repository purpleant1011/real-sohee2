'use client'

import { UserRound } from 'lucide-react'
import { useUserProfile } from './user-profile-context'
import styles from './user-avatar.module.css'

export function UserAvatar({ size }: Readonly<{ size: 'message' | 'menu' | 'hero' }>) {
  const { avatarUrl } = useUserProfile()

  return (
    <span className={`${styles.avatar} ${styles[size]}`}>
      {avatarUrl ? (
        // Signed private URLs are short-lived and bypass the Next image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="내 프로필 사진" src={avatarUrl} />
      ) : (
        <span aria-label="기본 프로필 아이콘" className={styles.fallback} role="img">
          <UserRound aria-hidden="true" />
        </span>
      )}
    </span>
  )
}
