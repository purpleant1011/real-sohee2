'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { markNotificationReadAction, saveNotificationPreferencesAction } from './actions/manage-notifications'
import { NotificationsRealtime } from './notifications-realtime'
import type { NotificationCenterData } from './repository'
import styles from './notification-center.module.css'

const kindLabel = { approval: '승인', schedule: '일정', publish: '게시', system: '시스템' } as const

export function NotificationCenter({ data, workspaceId }: Readonly<{ data: NotificationCenterData; workspaceId: string }>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveNotificationPreferencesAction({ approvalEvents: form.get('approvalEvents') === 'on', scheduleEvents: form.get('scheduleEvents') === 'on', publishEvents: form.get('publishEvents') === 'on' })
      if (result.error) { setMessage(result.error.message); return }
      setMessage('알림 설정을 저장했습니다.')
    })
  }
  function markRead(notificationId: string) {
    startTransition(async () => {
      const result = await markNotificationReadAction({ notificationId })
      if (result.error) { setMessage(result.error.message); return }
      setMessage('읽음 상태를 저장했습니다.')
    })
  }
  return <section aria-labelledby="notifications-title" className={styles.page}>
    <NotificationsRealtime userId={data.userId} workspaceId={workspaceId} />
    <header className={styles.header}><div><p className={styles.eyebrow}>내 계정 전용</p><h1 id="notifications-title">알림</h1><p>내 알림만 불러오며 새 사건은 Realtime 수신 뒤 서버에서 다시 조회합니다.</p></div><span>{data.notifications.filter((item) => item.readAt === null).length}개 읽지 않음</span></header>
    <form className={styles.preferences} onSubmit={save}><h2>알림 설정</h2><label><input defaultChecked={data.preferences.approvalEvents} name="approvalEvents" type="checkbox" /> 승인 사건</label><label><input defaultChecked={data.preferences.scheduleEvents} name="scheduleEvents" type="checkbox" /> 일정 사건</label><label><input defaultChecked={data.preferences.publishEvents} name="publishEvents" type="checkbox" /> 게시 사건</label><button disabled={pending}>알림 설정 저장</button></form>
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    <section className={styles.listSection} aria-labelledby="notification-list-title"><h2 id="notification-list-title">받은 알림</h2>{data.notifications.length === 0 ? <div className={styles.empty}><p>아직 받은 알림이 없습니다.</p></div> : <ul className={styles.list}>{data.notifications.map((item) => <li className={styles.card} data-unread={item.readAt === null} key={item.id}><div className={styles.cardHeading}><span>{kindLabel[item.kind]}</span><strong>{item.readAt === null ? '읽지 않음' : '읽음'}</strong></div><p>{item.body}</p><div className={styles.actions}>{item.href ? <Link href={item.href}>관련 화면 열기</Link> : <span>연결 화면 없음</span>}{item.readAt === null ? <button disabled={pending} onClick={() => markRead(item.id)} type="button">읽음으로 표시</button> : null}</div></li>)}</ul>}</section>
  </section>
}

export function NotificationCenterFailure() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <section aria-live="assertive" className={styles.empty} role="alert">
      <h1>알림</h1>
      <p>알림을 불러오지 못했어요. 다른 작업은 계속할 수 있습니다.</p>
      <button
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
        type="button"
      >
        다시 시도
      </button>
    </section>
  )
}
