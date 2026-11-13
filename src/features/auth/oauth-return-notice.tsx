import Link from 'next/link'
import type { OAuthReturnNotice } from './oauth-return'
import styles from './oauth-return-notice.module.css'

/**
 * ANI-1761 AC-3: 구글 로그인 복귀 안내 배너.
 *
 * 로그인 화면(취소·실패)과 첫 화면(/start, 성공)이 같은 문구·같은 모양을 쓰도록 한 곳에 둔다.
 * 톤은 색만으로 전달하지 않는다 — 제목 문구가 이미 결과를 말하고, 색은 보조다.
 */
export function OAuthReturnBanner({ notice }: { notice: OAuthReturnNotice }) {
  return (
    <div
      className={styles.notice}
      data-tone={notice.tone}
      role={notice.tone === 'alert' ? 'alert' : 'status'}
    >
      <strong className={styles.title}>{notice.title}</strong>
      <p className={styles.detail}>{notice.detail}</p>
      {notice.action ? (
        <Link className={styles.action} href={notice.action.href}>
          {notice.action.label}
        </Link>
      ) : null}
    </div>
  )
}
