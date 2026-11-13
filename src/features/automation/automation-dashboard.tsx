'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import { runMockAutomationAction, saveAutomationRuleAction } from './actions/manage-automation'
import type { AutomationDashboardData, AutomationRuleSummary } from './repository'
import type { AutomationRuleKind } from './rule-schema'
import styles from './automation-dashboard.module.css'

const kindLabels: Record<AutomationRuleKind, string> = {
  faq_safe_reply: '자주 묻는 질문 안전 응답',
  schedule_reminder: '예약 준비 알림',
  content_draft: '콘텐츠 초안 준비',
}

function runLabel(run: NonNullable<AutomationRuleSummary['lastRun']>) {
  if (run.status === 'failed') return '모의 실행 실패'
  if (run.status === 'awaiting_approval') return '모의 초안 승인 대기'
  return '모의 실행 성공'
}

export function AutomationDashboard({ data, workspaceId, role, legacy = false }: Readonly<{
  data: AutomationDashboardData
  workspaceId: string
  role: WorkspaceRole
  legacy?: boolean
}>) {
  const Heading = legacy ? 'h3' : 'h1'
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const canManage = role === 'owner' || role === 'manager'

  function save(event: FormEvent<HTMLFormElement>, ruleId: string | null) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const kind = form.get('kind')
    startTransition(async () => {
      const result = await saveAutomationRuleAction({
        workspaceId,
        ruleId,
        kind,
        active: form.get('active') === 'on',
        approvalRequired: kind === 'content_draft' || form.get('approvalRequired') === 'on',
      })
      if (result.error) { setMessage(result.error.message); return }
      setMessage('자동화 규칙을 저장했습니다.')
      router.refresh()
    })
  }

  function run(ruleId: string, outcome: 'success' | 'failure') {
    startTransition(async () => {
      const result = await runMockAutomationAction({ workspaceId, ruleId, outcome })
      if (result.error) { setMessage(result.error.message); return }
      setMessage(result.data.status === 'failed' ? '모의 실패를 기록했습니다.' : '외부 전송 없이 모의 결과를 기록했습니다.')
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="automation-title" className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{legacy ? 'V0.7 mock 전용' : '안전한 운영 보조'}</p><Heading id="automation-title">{legacy ? 'V0.7 이전 모의 자동화' : '자동화'}</Heading><p>모든 실행은 현재 결정적 모의 제공자이며 외부 채널로 아무것도 전송하지 않습니다.</p></div>
        <span className={styles.mockBadge}>{legacy ? 'V0.7 mock' : '모의 실행만'}</span>
      </header>
      {!canManage ? <p className={styles.notice}>소유자와 관리자만 규칙을 변경하거나 모의 실행할 수 있습니다.</p> : null}
      {message ? <p className={styles.notice} role="status">{message}</p> : null}

      {canManage ? (
        <form className={styles.form} onSubmit={(event) => save(event, null)}>
          <h2>새 규칙</h2>
          <label>규칙 종류<select name="kind" defaultValue="faq_safe_reply"><option value="faq_safe_reply">자주 묻는 질문 안전 응답</option><option value="schedule_reminder">예약 준비 알림</option><option value="content_draft">콘텐츠 초안 준비</option></select></label>
          <label className={styles.check}><input name="active" type="checkbox" /> 활성화</label>
          <label className={styles.check}><input name="approvalRequired" type="checkbox" /> 사람 승인 필요</label>
          <button disabled={pending}>규칙 저장</button>
        </form>
      ) : null}

      <section className={styles.rules} aria-labelledby="saved-rules-title">
        <h2 id="saved-rules-title">저장된 규칙</h2>
        {data.rules.length === 0 ? <div className={styles.empty}><p>아직 저장된 자동화 규칙이 없습니다.</p></div> : (
          <ul className={styles.list}>{data.rules.map((rule) => (
            <li className={styles.card} key={rule.id}>
              <div className={styles.cardHeading}><div><h3>{kindLabels[rule.kind]}</h3><p>{rule.active ? '활성' : '비활성'} · {rule.approvalRequired ? '사람 승인 필요' : '승인 없이 모의 상태 기록'}</p></div><span>모의</span></div>
              {canManage ? <form className={styles.inlineForm} onSubmit={(event) => save(event, rule.id)}><input name="kind" type="hidden" value={rule.kind} /><label className={styles.check}><input defaultChecked={rule.active} name="active" type="checkbox" /> 활성화</label><label className={styles.check}><input defaultChecked={rule.approvalRequired} disabled={rule.kind === 'content_draft'} name="approvalRequired" type="checkbox" /> 사람 승인 필요</label><button disabled={pending}>변경 저장</button></form> : null}
              {rule.lastRun ? <div className={styles.run} data-status={rule.lastRun.status}><strong>{runLabel(rule.lastRun)}</strong><p>{rule.lastRun.summary}</p>{rule.lastRun.errorCode ? <code>{rule.lastRun.errorCode}</code> : null}</div> : <p className={styles.muted}>아직 모의 실행 이력이 없습니다.</p>}
              {canManage && rule.active ? <div className={styles.actions}><button disabled={pending} onClick={() => run(rule.id, 'success')} type="button">모의 성공 실행</button><button disabled={pending} onClick={() => run(rule.id, 'failure')} type="button">모의 실패 실행</button></div> : null}
            </li>
          ))}</ul>
        )}
      </section>
    </section>
  )
}
