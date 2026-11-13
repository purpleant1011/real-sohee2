'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { saveV08AutomationAction } from './actions/save-v08-automation'
import type { V08AutomationRuleSummary } from './v08-automation-repository'
import type { V08AutomationKind } from './v08-rule-schema'
import styles from './v08-automation-setup.module.css'

const kindOptions: readonly Readonly<{ value: Extract<V08AutomationKind, 'daily_performance_report' | 'twice_daily_performance_report' | 'weekly_plan_proposal'>; label: string }>[] = [
  { value: 'daily_performance_report', label: '매일 성과 보고' },
  { value: 'twice_daily_performance_report', label: '하루 두 번 성과 보고' },
  { value: 'weekly_plan_proposal', label: '주간 다음 계획 제안' },
]

const channels = [
  ['instagram', '인스타그램'],
  ['threads', '스레드'],
  ['naver_blog', '네이버 블로그'],
  ['naver_place', '네이버 플레이스'],
  ['daangn_business', '당근 비즈프로필'],
] as const

export function V08AutomationSetup({ canManage, workspaceId, rules = [] }: Readonly<{ canManage: boolean; workspaceId: string; rules?: readonly V08AutomationRuleSummary[] }>) {
  const router = useRouter()
  const [kind, setKind] = useState<(typeof kindOptions)[number]['value']>('daily_performance_report')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const localTimes = [form.get('firstTime')]
    if (kind === 'twice_daily_performance_report') localTimes.push(form.get('secondTime'))
    startTransition(async () => {
      const result = await saveV08AutomationAction({
        workspaceId,
        mode: 'save',
        configuration: {
          kind,
          active: false,
          approvalRequired: true,
          timezone: form.get('timezone'),
          localTimes,
          weekday: kind === 'weekly_plan_proposal' ? Number(form.get('weekday')) : undefined,
          quietHours: { start: form.get('quietStart'), end: form.get('quietEnd') },
          perRunCreditCap: Number(form.get('perRunCreditCap')),
          dailyCreditCap: Number(form.get('dailyCreditCap')),
          weeklyCreditCap: Number(form.get('weeklyCreditCap')),
          channels: form.getAll('channels'),
        },
      })
      if (result.data.status !== 'saved') {
        setMessage('V0.8 규칙을 저장하지 못했습니다. 현재 상태는 바뀌지 않았습니다.')
        return
      }
      setMessage('V0.8 규칙을 비활성 상태로 저장했습니다.')
      router.refresh()
    })
  }

  function changeState(rule: V08AutomationRuleSummary, mode: 'pause' | 'resume') {
    startTransition(async () => {
      const result = await saveV08AutomationAction({ workspaceId, ruleId: rule.id, mode, expectedVersion: rule.configurationVersion })
      if (result.data.status !== (mode === 'resume' ? 'resumed' : 'paused')) {
        setMessage('자동화 상태를 바꾸지 못했습니다. 새로고침 후 버전과 권한을 확인해 주세요.')
        return
      }
      setMessage(mode === 'resume' ? '보고 자동화를 승인해 다음 실행 시간을 계산했습니다.' : '보고 자동화를 일시중지하고 다음 실행 시간을 지웠습니다.')
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="v08-automation-title" className={styles.section}>
      <header>
        <p className={styles.eyebrow}>AU-01 · report-only</p>
        <h2 id="v08-automation-title">V0.8 보고 자동화 설정</h2>
        <p>성과 보고와 다음 계획 제안만 준비합니다. 콘텐츠 게시, 프로필 변경, 결제는 실행하지 않습니다.</p>
      </header>
      <p className={styles.notice}>저장 전 비활성 · 모든 실행은 사람 승인과 report-only 경계를 유지합니다.</p>
      {canManage ? (
        <form className={styles.form} onSubmit={submit}>
          <label>보고 규칙<select disabled={pending} name="kind" onChange={(event) => setKind(event.target.value as (typeof kindOptions)[number]['value'])} value={kind}>{kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>시간대<input disabled={pending} name="timezone" required value="Asia/Seoul" readOnly /></label>
          <label>첫 실행 시간<input aria-label="첫 실행 시간" defaultValue="09:00" disabled={pending} name="firstTime" required type="time" /></label>
          {kind === 'twice_daily_performance_report' ? <label>두 번째 실행 시간<input aria-label="두 번째 실행 시간" defaultValue="18:00" disabled={pending} name="secondTime" required type="time" /></label> : null}
          {kind === 'weekly_plan_proposal' ? <label>실행 요일<select defaultValue="1" disabled={pending} name="weekday"><option value="1">월요일</option><option value="2">화요일</option><option value="3">수요일</option><option value="4">목요일</option><option value="5">금요일</option></select></label> : null}
          <label>조용한 시간 시작<input defaultValue="22:00" disabled={pending} name="quietStart" required type="time" /></label>
          <label>조용한 시간 종료<input defaultValue="07:00" disabled={pending} name="quietEnd" required type="time" /></label>
          <label>한 번 최대 크레딧<input defaultValue="20" disabled={pending} min="1" name="perRunCreditCap" required type="number" /></label>
          <label>하루 최대 크레딧<input defaultValue="40" disabled={pending} min="1" name="dailyCreditCap" required type="number" /></label>
          <label>일주일 최대 크레딧<input defaultValue="200" disabled={pending} min="1" name="weeklyCreditCap" required type="number" /></label>
          <fieldset><legend>대상 채널</legend>{channels.map(([value, label], index) => <label className={styles.check} key={value}><input defaultChecked={index === 0} disabled={pending} name="channels" type="checkbox" value={value} />{label}</label>)}</fieldset>
          <button disabled={pending} type="submit">{pending ? '저장 중…' : 'V0.8 규칙 저장'}</button>
        </form>
      ) : <p className={styles.notice}>소유자와 관리자만 V0.8 자동화 설정을 저장할 수 있습니다.</p>}
      {message ? <p className={styles.notice} role="status">{message}</p> : null}
      <section aria-labelledby="v08-saved-rules-title" className={styles.rules}>
        <h3 id="v08-saved-rules-title">저장된 V0.8 보고 규칙</h3>
        {rules.length === 0 ? <p className={styles.notice}>저장된 V0.8 보고 규칙이 없습니다.</p> : <ul>{rules.map((rule) => <li key={rule.id}><strong>{kindOptions.find((option) => option.value === rule.configuration.kind)?.label ?? rule.configuration.kind}</strong><p>{rule.active ? '활성 · report-only' : '비활성 · 승인 대기'} · 버전 {rule.configurationVersion}</p><p>시간대 {rule.configuration.timezone} · 실행 {rule.configuration.localTimes.join(', ')} · 조용한 시간 {rule.configuration.quietHours.start}–{rule.configuration.quietHours.end}</p><p>한 번 {rule.configuration.perRunCreditCap} / 하루 {rule.configuration.dailyCreditCap} / 주간 {rule.configuration.weeklyCreditCap} 크레딧 · {rule.configuration.channels.join(', ')}</p><p>{rule.nextRunAt ? `다음 실행 ${rule.nextRunAt}` : '다음 실행 없음'}</p>{canManage ? <button disabled={pending} onClick={() => changeState(rule, rule.active ? 'pause' : 'resume')} type="button">{rule.active ? '보고 자동화 일시중지' : '보고 자동화 활성화 승인'}</button> : null}</li>)}</ul>}
      </section>
    </section>
  )
}
