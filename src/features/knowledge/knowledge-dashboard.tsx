'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import { reviewKnowledgeAction } from './actions/review-knowledge'
import { registerUrlSourceAction } from './actions/register-url-source'
import { uploadKnowledgeAction } from './actions/upload-knowledge'
import type { KnowledgeListItem } from './repository'
import type { KnowledgeStatus } from './knowledge-status'
import { KnowledgeStudioCTA } from './knowledge-studio-cta'
import { ChannelLearningPanel } from '@/features/channel-learning/components/channel-learning-panel'
import styles from './knowledge-dashboard.module.css'

type ReviewDecision = 'review_required' | 'approved' | 'rejected' | 'disabled'

const statusPresentation: Record<KnowledgeStatus, Readonly<{ label: string; description: string }>> = {
  uploading: { label: '업로드 중', description: '비공개 저장소로 파일을 옮기고 있습니다.' },
  checking: {
    label: '확인 중',
    description: '파일 형식·크기·시그니처를 확인했습니다. 사람의 검토 전 단계입니다.',
  },
  review_required: { label: '검토 필요', description: '관리자의 내용 확인과 승인 여부 결정이 필요합니다.' },
  approved: { label: '승인됨', description: '콘텐츠 근거로 사용할 수 있는 자료입니다.' },
  rejected: { label: '반려됨', description: '콘텐츠 근거에서 제외된 자료입니다.' },
  disabled: { label: '사용 중지', description: '이전에 승인됐지만 현재는 근거로 사용하지 않습니다.' },
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function reviewOptions(status: KnowledgeStatus): readonly Readonly<{
  decision: ReviewDecision
  label: string
  tone: 'primary' | 'danger' | 'secondary'
}>[] {
  if (status === 'checking') {
    return [
      { decision: 'review_required', label: '내용 검토로 보내기', tone: 'primary' },
      { decision: 'rejected', label: '반려하기', tone: 'danger' },
    ]
  }
  if (status === 'review_required') {
    return [
      { decision: 'approved', label: '승인하기', tone: 'primary' },
      { decision: 'rejected', label: '반려하기', tone: 'danger' },
    ]
  }
  if (status === 'approved') {
    return [{ decision: 'disabled', label: '사용 중지', tone: 'secondary' }]
  }
  return []
}

export function KnowledgeDashboard({
  items,
  workspaceId,
  role,
  activeImageHarness = null,
  error = null,
  studioReadiness,
}: Readonly<{
  items: readonly KnowledgeListItem[]
  workspaceId: string
  role: WorkspaceRole
  activeImageHarness?: Readonly<{
    name: string
    version: string
    channels: readonly ('instagram' | 'threads' | 'naver_blog')[]
    approvalStatus: 'DRAFT_OWNER_APPROVAL_PENDING'
    storageStatus: 'persisted' | 'bundled'
  }> | null
  error?: string | null
  /** Same readiness rule generation uses; when omitted, the CTA falls back to the item list. */
  studioReadiness?: Readonly<{ state: 'ready' | 'missing' | 'error'; message?: string }>
}>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const canUpload = role !== 'viewer'
  const canManage = role === 'owner' || role === 'manager'

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    startTransition(async () => {
      const result = await uploadKnowledgeAction(data)
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      form.reset()
      setMessage('자료를 비공개로 저장했습니다. 내용 검토 전까지 콘텐츠 근거로 쓰지 않습니다.')
      router.refresh()
    })
  }

  function review(knowledgeId: string, decision: ReviewDecision) {
    startTransition(async () => {
      const result = await reviewKnowledgeAction({ workspaceId, knowledgeId, decision })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      setMessage('지식 자료의 검토 상태를 변경했습니다.')
      router.refresh()
    })
  }

  function registerUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    startTransition(async () => {
      const result = await registerUrlSourceAction({
        workspaceId,
        channel: data.get('channel'),
        ownership: data.get('ownership'),
        url: data.get('url'),
      })
      if (result.error) {
        setMessage(result.error.message)
        return
      }
      form.reset()
      setMessage('주소 출처를 등록했습니다. 로그인이나 자동 수집은 시작하지 않았습니다.')
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="knowledge-title" className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>비공개 자료실</p>
          <h1 id="knowledge-title">지식 자료</h1>
          <p>승인된 자료만 콘텐츠의 사실 근거로 사용합니다.</p>
        </div>
        <span className={styles.actualBadge}>실제 데이터</span>
      </header>

      <KnowledgeStudioCTA
        error={error ?? (studioReadiness?.state === 'error' ? studioReadiness.message ?? '가게 정보를 불러오지 못했어요.' : null)}
        items={items}
        availableCount={studioReadiness ? (studioReadiness.state === 'ready' ? 1 : 0) : undefined}
      />

      <section aria-labelledby="knowledge-upload-title" className={styles.panel}>
        <div>
          <h2 id="knowledge-upload-title">자료 등록</h2>
          <p>PDF, TXT, JPEG, PNG 파일을 최대 8MB까지 올릴 수 있습니다.</p>
          <p className={styles.caution}>
            확인 중은 파일 형식·크기·시그니처를 통과했다는 뜻이며, 실제 악성 파일 검사 완료를 의미하지 않습니다.
          </p>
        </div>
        {canUpload ? (
          <form className={styles.uploadForm} onSubmit={upload}>
            <input name="workspaceId" type="hidden" value={workspaceId} />
            <label>
              파일 선택
              <input
                accept=".pdf,.txt,.jpg,.jpeg,.png,application/pdf,text/plain,image/jpeg,image/png"
                disabled={pending}
                name="file"
                required
                type="file"
              />
            </label>
            <button disabled={pending} type="submit">
              {pending ? '처리 중…' : '자료 올리기'}
            </button>
          </form>
        ) : (
          <p className={styles.readOnly}>보기 권한은 자료를 등록할 수 없습니다.</p>
        )}
      </section>

      <section aria-labelledby="knowledge-url-title" className={styles.panel}>
        <div>
          <h2 id="knowledge-url-title">주소 출처 등록</h2>
          <p>내 채널 주소는 등록만 하며, 인증이 필요한 수집은 공식 로그인 또는 수동 확인 전까지 시작하지 않습니다.</p>
          <p className={styles.caution}>참고 주소는 패턴 분석에만 사용하고 복사하거나 게시하지 않습니다.</p>
          <p className={styles.caution}>
            직접 입력한 주소는 확인 완료 상태가 아니며, 공식 계정 연결을 통한 본인 확인과 검토·승인 전에는 작성 근거로 쓰이지 않습니다.
          </p>
        </div>
        {canUpload ? (
          <form className={styles.uploadForm} onSubmit={registerUrl}>
            <label>
              주소
              <input disabled={pending} name="url" required type="url" />
            </label>
            <label>
              채널
              <select defaultValue="instagram" disabled={pending} name="channel">
                <option value="instagram">인스타그램</option>
                <option value="threads">스레드</option>
                <option value="naver_blog">네이버 블로그</option>
                <option value="naver_place">네이버 플레이스</option>
                <option value="daangn_business">당근 비즈프로필</option>
              </select>
            </label>
            <label>
              사용 범위
              <select defaultValue="owned" disabled={pending} name="ownership">
                <option value="owned">내 채널 사실 근거 (검증 대기)</option>
                <option value="reference">참고 패턴만</option>
              </select>
            </label>
            <button disabled={pending} type="submit">{pending ? '등록 중…' : '주소 등록'}</button>
          </form>
        ) : (
          <p className={styles.readOnly}>보기 권한은 주소 출처를 등록할 수 없습니다.</p>
        )}
      </section>

      {/* 공식 채널 지식 학습 및 검증 패널 */}
      <section aria-label="공식 채널 지식 학습 영역" className="pt-2 pb-4">
        <ChannelLearningPanel
          workspaceId={workspaceId}
          canManage={canManage}
          onKnowledgeUpdated={() => router.refresh()}
        />
      </section>

      <section aria-labelledby="active-harness-title" className={styles.panel}>
        <div>
          <h2 id="active-harness-title">활성 이미지 기준</h2>
          {activeImageHarness ? (
            <>
              <p><strong>{activeImageHarness.name}</strong> · V{activeImageHarness.version}</p>
              <p>사용 채널: 인스타그램 · 스레드 · 네이버 블로그</p>
              <p className={styles.caution}>생성 결과는 실제 고객 사례가 아닌 합성 초안이며 사장님 승인 전에는 게시할 수 없습니다.</p>
              {activeImageHarness.storageStatus === 'bundled' ? (
                <p className={styles.caution}>현재 소희 대화와 이미지 생성에 적용 중이며, 곧 가게 지식으로 안전하게 보존됩니다.</p>
              ) : null}
            </>
          ) : (
            <p>현재 작업공간에 활성화된 이미지 스타일 기준이 없습니다.</p>
          )}
        </div>
        <span className={styles.actualBadge}>
          {activeImageHarness
            ? activeImageHarness.storageStatus === 'persisted'
              ? '지식체계 연결됨'
              : 'AI 적용됨 · 저장 준비 중'
            : '연결 필요'}
        </span>
      </section>

      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {!canManage ? (
        <p className={styles.readOnly}>자료의 내용은 볼 수 있지만 소유자와 관리자만 검토 상태를 변경할 수 있습니다.</p>
      ) : null}

      <section aria-labelledby="knowledge-list-title" className={styles.listSection}>
        <div className={styles.sectionHeading}>
          <h2 id="knowledge-list-title">등록된 자료</h2>
          <span>{items.length}개</span>
        </div>
        {items.length === 0 ? (
          <div className={styles.emptyState}>
            <p>아직 등록된 지식 자료가 없습니다.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => {
              const presentation = statusPresentation[item.status]
              const options = canManage ? reviewOptions(item.status) : []
              return (
                <li className={styles.card} key={item.id}>
                  <div className={styles.cardHeading}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.mimeType} · {formatBytes(item.sizeBytes)}</p>
                    </div>
                    <span data-status={item.status}>{presentation.label}</span>
                  </div>
                  <p>{presentation.description}</p>
                  <div className={styles.evidenceRow}>
                    <strong>{item.canUseAsEvidence ? '콘텐츠 근거 사용 가능' : '콘텐츠 근거 사용 불가'}</strong>
                    <a href={item.fileUrl} rel="noreferrer" target="_blank">원본 확인</a>
                  </div>
                  {options.length > 0 ? (
                    <div className={styles.actions}>
                      {options.map((option) => (
                        <button
                          className={styles[option.tone]}
                          disabled={pending}
                          key={option.decision}
                          onClick={() => review(item.id, option.decision)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </section>
  )
}
