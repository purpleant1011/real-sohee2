'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { saveSettingsAction } from './actions/save-settings'
import { disconnectChannelAction } from '@/features/channels/actions/disconnect-channel'
import type { BrandSettings, BusinessSettings, ChannelSetting, MemberSetting } from './types'
import styles from './settings.module.css'

const channelLabels = {
  instagram: 'Instagram',
  threads: 'Threads',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
} as const
const channelStatusLabels = {
  disconnected: '연결되지 않음',
  connecting: '연결 중',
  connected: '연결됨',
  expired: '권한 만료',
  missing_permission: '권한 부족',
  wrong_account: '다른 계정',
  provider_error: '채널 오류',
  error: '확인 필요',
} as const
const webhookStatusLabels = {
  pending: '웹훅 확인 전', healthy: '웹훅 정상', stale: '웹훅 수신 지연', error: '웹훅 오류',
} as const
const roleLabels = { owner: '소유자', manager: '관리자', reviewer: '검토자', viewer: '조회자' } as const
const memberStatusLabels = { active: '활성', invited: '초대됨', disabled: '비활성' } as const

function SaveMessage({ message }: Readonly<{ message: string }>) {
  return message ? <p className={styles.message} role="status">{message}</p> : null
}

export function BusinessSettingsForm({
  canEdit,
  value,
}: Readonly<{ canEdit: boolean; value: BusinessSettings }>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveSettingsAction({
        kind: 'business',
        businessName: form.get('businessName'),
        industry: form.get('industry'),
        location: form.get('location'),
        summary: form.get('summary'),
      })
      setMessage(result.message)
    })
  }

  return (
    <form className={styles.form} onReset={() => setMessage('')} onSubmit={submit}>
      <div className={styles.twoColumns}>
        <label>사업명<input defaultValue={value.businessName} disabled={!canEdit || pending} maxLength={120} name="businessName" required /></label>
        <label>업종<input defaultValue={value.industry} disabled={!canEdit || pending} maxLength={120} name="industry" /></label>
        <label>위치<input defaultValue={value.location} disabled={!canEdit || pending} maxLength={200} name="location" /></label>
      </div>
      <label>운영 요약<textarea defaultValue={value.summary} disabled={!canEdit || pending} maxLength={4_000} name="summary" rows={7} /></label>
      {canEdit ? <div className={styles.actions}><button disabled={pending} type="submit">사업 정보 저장</button><button disabled={pending} type="reset">변경 취소</button></div> : <p className={styles.permission}>현재 역할은 저장된 내용을 조회할 수 있습니다.</p>}
      <SaveMessage message={message} />
    </form>
  )
}

export function BrandSettingsForm({
  canEdit,
  value,
}: Readonly<{ canEdit: boolean; value: BrandSettings }>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveSettingsAction({
        kind: 'brand',
        voice: form.get('voice'),
        keywords: form.get('keywords'),
        prohibitedTerms: form.get('prohibitedTerms'),
      })
      setMessage(result.message)
    })
  }

  return (
    <form className={styles.form} onReset={() => setMessage('')} onSubmit={submit}>
      <label>말투<textarea defaultValue={value.voice} disabled={!canEdit || pending} maxLength={2_000} name="voice" rows={6} /></label>
      <label>핵심어<span className={styles.hint}>쉼표로 구분해 주세요.</span><textarea defaultValue={value.keywords.join(', ')} disabled={!canEdit || pending} name="keywords" rows={4} /></label>
      <label>금지 표현<span className={styles.hint}>생성 문안에서 피해야 할 표현입니다.</span><textarea defaultValue={value.prohibitedTerms.join(', ')} disabled={!canEdit || pending} name="prohibitedTerms" rows={4} /></label>
      {canEdit ? <div className={styles.actions}><button disabled={pending} type="submit">브랜드 기준 저장</button><button disabled={pending} type="reset">변경 취소</button></div> : <p className={styles.permission}>현재 역할은 저장된 내용을 조회할 수 있습니다.</p>}
      <SaveMessage message={message} />
    </form>
  )
}

function ChannelCard({ channel, canEdit }: Readonly<{ channel: ChannelSetting; canEdit: boolean }>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  const isMeta = channel.channel === 'instagram' || channel.channel === 'threads'
  const connected = channel.status === 'connected'
  function disconnect() { if (!isMeta) return; startTransition(async () => {
    const result = await disconnectChannelAction({ channel: channel.channel })
    setMessage(result.message)
  }) }

  return (
    <section className={styles.card}>
      <div className={styles.cardHeading}>
        <h2>{channelLabels[channel.channel]}</h2>
        <span data-state={channel.status}>{channelStatusLabels[channel.status]}</span>
      </div>
      {isMeta ? <>
        <p>{channel.accountLabel ? `${channel.accountLabel} 공식 계정` : '공식 계정을 연결하면 승인된 게시물만 전송됩니다.'}</p>
        <p className={styles.hint}>{webhookStatusLabels[channel.webhookStatus]}{channel.lastWebhookAt ? ` · 최근 수신 ${new Date(channel.lastWebhookAt).toLocaleString('ko-KR')}` : ''}</p>
        {channel.tokenExpiresAt ? <p className={styles.hint}>권한 만료 예정 {new Date(channel.tokenExpiresAt).toLocaleDateString('ko-KR')}</p> : null}
        {canEdit ? <div className={styles.actions}>
          {connected
            ? <button disabled={pending} type="button" onClick={disconnect}>연결 해제</button>
            : <a aria-label={`${channelLabels[channel.channel]} 공식 계정 연결`} href={`/api/channels/${channel.channel}/connect`}>{channel.status === 'expired' || channel.status === 'missing_permission' ? '다시 연결' : '공식 계정 연결'}</a>}
        </div> : null}
      </> : <p>이번 운영 연동 범위에는 포함되지 않은 채널입니다.</p>}
      <SaveMessage message={message} />
    </section>
  )
}

export function ChannelSettingsForm({
  canEdit,
  channels,
}: Readonly<{ canEdit: boolean; channels: readonly ChannelSetting[] }>) {
  return <div className={styles.cardGrid}>{channels.map((channel) => <ChannelCard canEdit={canEdit} channel={channel} key={channel.channel} />)}</div>
}

function MemberCard({ member, canEdit }: Readonly<{ member: MemberSetting; canEdit: boolean }>) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveSettingsAction({
        kind: 'member',
        memberId: member.memberId,
        role: form.get('role'),
        status: form.get('status'),
      })
      setMessage(result.message)
    })
  }

  return (
    <form className={styles.card} onReset={() => setMessage('')} onSubmit={submit}>
      <div className={styles.cardHeading}><h2>{member.label}</h2><span>{memberStatusLabels[member.status]}</span></div>
      <div className={styles.twoColumns}>
        <label>역할<select defaultValue={member.role} disabled={!canEdit || pending} name="role">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>상태<select defaultValue={member.status} disabled={!canEdit || pending} name="status">{Object.entries(memberStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {canEdit ? <div className={styles.actions}><button disabled={pending} type="submit">멤버 권한 저장</button><button disabled={pending} type="reset">변경 취소</button></div> : null}
      <SaveMessage message={message} />
    </form>
  )
}

export function MemberSettingsList({
  canEdit,
  members,
}: Readonly<{ canEdit: boolean; members: readonly MemberSetting[] }>) {
  return <div className={styles.cardGrid}>{members.map((member) => <MemberCard canEdit={canEdit} key={member.memberId} member={member} />)}</div>
}
