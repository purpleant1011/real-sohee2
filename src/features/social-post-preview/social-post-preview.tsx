import Image from 'next/image'
import { Bookmark, Heart, MessageCircle, Repeat2, Send } from 'lucide-react'
import type { SocialPostPreviewData } from './types'
import styles from './social-post-preview.module.css'

const channelNames = { instagram: 'Instagram', threads: 'Threads' } as const

export function SocialPostPreview({ preview }: Readonly<{ preview: SocialPostPreviewData }>) {
  const label = `${channelNames[preview.channel]} 게시물 미리보기`
  const first = [...preview.media].sort((a, b) => a.position - b.position)[0]
  return <section aria-label={label} className={styles.preview} data-channel={preview.channel}>
    <header className={styles.header}>
      <span className={styles.avatar} aria-hidden="true">S</span>
      <div><strong>{preview.accountLabel}</strong><small>{channelNames[preview.channel]} 최종 게시 형태</small></div>
      <span className={styles.channel}>{channelNames[preview.channel]}</span>
    </header>
    {first ? <div className={styles.media}>
      <Image alt={first.altText} fill sizes="(max-width: 760px) 100vw, 420px" src={first.src} unoptimized />
      {preview.media.length > 1 ? <span>1/{preview.media.length}</span> : null}
    </div> : null}
    <div className={styles.body}>
      <div className={styles.actions} aria-hidden="true">
        <Heart /><MessageCircle />{preview.channel === 'threads' ? <Repeat2 /> : <Send />}<Bookmark />
      </div>
      <p><strong>{preview.accountLabel}</strong> {preview.caption}</p>
      {preview.hashtags.length > 0 ? <p className={styles.hashtags}>{preview.hashtags.join(' ')}</p> : null}
    </div>
  </section>
}
