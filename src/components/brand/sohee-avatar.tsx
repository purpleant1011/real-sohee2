'use client'

import Image from 'next/image'
import { useState } from 'react'
import styles from './sohee-avatar.module.css'

const SOHEE_CHARACTER_SRC = '/brand/sohee-character-v1.png'
const SOHEE_LOGO_SRC = '/brand/sohee-logo-mark-v1.png'

const avatarSizes = {
  message: 36,
  hero: 48,
} as const

const markSizes = {
  small: 48,
  hero: 48,
} as const

export function SoheeAvatar({ variant }: Readonly<{ variant: keyof typeof avatarSizes }>) {
  const [failed, setFailed] = useState(false)
  const size = avatarSizes[variant]

  return (
    <span className={`${styles.frame} ${styles[variant]}`}>
      {failed ? <span aria-hidden="true" className={styles.fallback}>S.</span> : (
        <Image
          alt="소희"
          className={`${styles.image} ${variant === 'message' ? styles.messageImage : ''}`}
          height={size}
          onError={() => setFailed(true)}
          priority={variant === 'hero'}
          src={SOHEE_CHARACTER_SRC}
          width={size}
        />
      )}
    </span>
  )
}

export function SoheeBrandMark({ size: sizeName }: Readonly<{ size: keyof typeof markSizes }>) {
  const [failed, setFailed] = useState(false)
  const size = markSizes[sizeName]

  return (
    <span className={`${styles.frame} ${styles.mark} ${styles[sizeName]}`}>
      {failed ? <span aria-hidden="true" className={styles.fallback}>S.</span> : (
        <Image
          alt="소희 로고"
          className={styles.image}
          height={size}
          onError={() => setFailed(true)}
          priority
          src={SOHEE_LOGO_SRC}
          width={size}
        />
      )}
    </span>
  )
}
