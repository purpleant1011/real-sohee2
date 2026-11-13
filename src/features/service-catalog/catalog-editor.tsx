'use client'

import { useMemo, useState } from 'react'
import type { CatalogServiceView } from './catalog-service'
import { READINESS_LABELS } from './schema'
import styles from './catalog-editor.module.css'

/**
 * ANI-1609 — the owner's service catalog editor.
 * Mobile-first (375px), Korean UI, and honest about every gap: an unset value is shown as
 * unset and explained, never filled in by the app.
 */

interface CatalogEditorProps {
  workspaceId: string
  canEdit: boolean
  initialServices: CatalogServiceView[]
}

interface Draft {
  name: string
  price: string
  durationMinutes: string
  resourceName: string
  cancellationPolicy: string
  validFrom: string
  validUntil: string
  active: boolean
}

const EMPTY_DRAFT: Draft = {
  name: '', price: '', durationMinutes: '', resourceName: '',
  cancellationPolicy: '', validFrom: '', validUntil: '', active: true,
}

function toDateInputValue(isoString: string): string {
  if (!isoString) return ''
  return isoString.slice(0, 10)
}

function toIsoString(dateValue: string, isEndOfDay = false): string {
  const trimmed = dateValue.trim()
  if (!trimmed) return ''
  return isEndOfDay ? `${trimmed}T23:59:59+09:00` : `${trimmed}T00:00:00+09:00`
}

type FactSync = { status: string; message?: string }

interface SaveResponse {
  service?: CatalogServiceView
  factSync?: FactSync
  slotsRequiringReconfirmation?: number
  error?: string
  issues?: { path: string; message: string }[]
}

function toDraft(service: CatalogServiceView): Draft {
  return {
    name: service.name,
    price: service.price === null ? '' : String(service.price),
    durationMinutes: service.durationMinutes === null ? '' : String(service.durationMinutes),
    resourceName: service.resourceName ?? '',
    cancellationPolicy: service.cancellationPolicy ?? '',
    validFrom: service.validFrom ?? '',
    validUntil: service.validUntil ?? '',
    active: service.active,
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Returns the error message for a field the owner must fix, or null. */
function localIssue(draft: Draft): string | null {
  if (!draft.name.trim()) return '서비스명을 입력해 주세요.'
  if (draft.price.trim() !== '' && !/^\d+$/.test(draft.price.trim())) {
    return '가격은 0원 이상의 정수로 입력해 주세요.'
  }
  if (draft.durationMinutes.trim() !== '') {
    if (!/^\d+$/.test(draft.durationMinutes.trim())) return '소요시간은 분 단위 정수로 입력해 주세요.'
    const minutes = Number(draft.durationMinutes)
    if (minutes < 1 || minutes > 1440) return '소요시간은 1분 이상 1,440분 이하로 입력해 주세요.'
  }
  if (draft.validFrom && draft.validUntil && Date.parse(draft.validUntil) <= Date.parse(draft.validFrom)) {
    return '유효기간 종료는 시작보다 뒤여야 합니다.'
  }
  return null
}

function toPayload(draft: Draft) {
  return {
    name: draft.name.trim(),
    price: draft.price.trim() === '' ? null : Number(draft.price),
    durationMinutes: draft.durationMinutes.trim() === '' ? null : Number(draft.durationMinutes),
    resourceName: emptyToNull(draft.resourceName),
    cancellationPolicy: emptyToNull(draft.cancellationPolicy),
    validFrom: emptyToNull(draft.validFrom),
    validUntil: emptyToNull(draft.validUntil),
    active: draft.active,
  }
}

function won(price: number | null): string {
  return price === null ? '가격 미입력' : `${price.toLocaleString('ko-KR')}원`
}

function durationText(minutes: number | null): string {
  return minutes === null ? '소요시간 미입력' : `${minutes}분`
}

export function CatalogEditor({ workspaceId, canEdit, initialServices }: CatalogEditorProps) {
  const [services, setServices] = useState<CatalogServiceView[]>(initialServices)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const needsReconfirmation = useMemo(
    () => services.filter((service) => service.readiness.missing.length > 0).length,
    [services],
  )

  async function save(service: CatalogServiceView | null, values: Draft) {
    setError(null)
    setNotice(null)
    const issue = localIssue(values)
    if (issue) {
      setError(issue)
      return
    }
    setPending(true)
    try {
      const payload = toPayload(values)
      const response = await fetch(
        service
          ? `/api/workspaces/${workspaceId}/service-catalog/${service.id}`
          : `/api/workspaces/${workspaceId}/service-catalog`,
        {
          method: service ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(service ? { ...payload, expectedUpdatedAt: service.updatedAt } : payload),
        },
      )
      const body = (await response.json().catch(() => ({}))) as SaveResponse
      if (!response.ok || !body.service) {
        setError(body.error ?? '저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      const saved = body.service
      setServices((current) => {
        const next = service
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved]
        return next.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      })
      setDraft(EMPTY_DRAFT)
      setEditingId(null)
      const parts = ['저장했어요.']
      if (body.factSync?.status === 'SYNCED') parts.push('가게 정보(사실)에도 반영했어요.')
      if (body.factSync?.status === 'SKIPPED_INCOMPLETE') parts.push('가격과 소요시간을 모두 입력하면 가게 정보에도 반영돼요.')
      if (body.factSync?.status === 'SKIPPED_UNCHANGED') parts.push('가격·소요시간은 그대로라 가게 정보는 바꾸지 않았어요.')
      if (body.factSync?.status === 'SKIPPED_FUTURE_EFFECTIVE_DATE') {
        parts.push('적용일이 아직 오지 않아 오늘 가격 정보는 그대로 뒀어요.')
      }
      if (body.factSync?.status === 'FAILED') {
        setError(`저장은 했지만 가게 정보(사실) 반영에 실패했어요: ${body.factSync.message ?? '알 수 없는 오류'}`)
      }
      if ((body.slotsRequiringReconfirmation ?? 0) > 0) {
        parts.push(`이미 열어 둔 예약 가능 시간 ${body.slotsRequiringReconfirmation}개를 다시 확인해야 해요.`)
      }
      setNotice(parts.join(' '))
    } catch {
      setError('저장하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setPending(false)
    }
  }

  function field(
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { type?: string; hint?: string; placeholder?: string; multiline?: boolean } = {},
  ) {
    return (
      <label className={styles.field} htmlFor={id}>
        <span className={styles.label}>{label}</span>
        {options.multiline ? (
          <textarea
            id={id}
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={options.placeholder}
            rows={3}
          />
        ) : (
          <input
            id={id}
            aria-label={label}
            type={options.type ?? 'text'}
            inputMode={options.type === 'number' ? 'numeric' : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={options.placeholder}
          />
        )}
        {options.hint ? <span className={styles.hint}>{options.hint}</span> : null}
      </label>
    )
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.summary}>
        {services.length === 0
          ? '등록된 서비스가 없어요. 예약을 받으려면 서비스를 먼저 등록해 주세요.'
          : needsReconfirmation > 0
            ? `서비스 ${services.length}개 중 ${needsReconfirmation}개가 예약 확정에 필요한 정보가 비어 있어요.`
            : `서비스 ${services.length}개 모두 예약 확정에 필요한 정보가 채워져 있어요.`}
      </p>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {services.length === 0 ? (
        <p className={styles.empty}>아래에서 첫 서비스를 추가해 주세요.</p>
      ) : (
        <ul className={styles.list}>
          {services.map((service) => (
            <li className={styles.card} key={service.id}>
              {editingId === service.id ? (
                <form
                  className={styles.form}
                  aria-label={`${service.name} 수정`}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void save(service, editDraft)
                  }}
                >
                  <h3 className={styles.cardTitle}>{service.name} 수정</h3>
                  {field('edit-name', '서비스명', editDraft.name, (next) => setEditDraft({ ...editDraft, name: next }))}
                  {field('edit-price', '가격(원)', editDraft.price, (next) => setEditDraft({ ...editDraft, price: next }), {
                    type: 'number', hint: '비워 두면 가격 미입력으로 저장돼요.',
                  })}
                  {field('edit-duration', '소요시간(분)', editDraft.durationMinutes, (next) => setEditDraft({ ...editDraft, durationMinutes: next }), {
                    type: 'number', hint: '1~1,440분. 예약 확정에 꼭 필요해요.',
                  })}
                  {field('edit-resource', '담당자·자원', editDraft.resourceName, (next) => setEditDraft({ ...editDraft, resourceName: next }), {
                    hint: '예: 원장, 1번 베드. 비워 두면 미입력으로 저장돼요.',
                  })}
                  {field('edit-cancel', '취소 규칙', editDraft.cancellationPolicy, (next) => setEditDraft({ ...editDraft, cancellationPolicy: next }), {
                    multiline: true, hint: '고객에게 약속한 그대로 적어 주세요.',
                  })}
                  {field('edit-from', '적용 시작일', toDateInputValue(editDraft.validFrom), (next) => setEditDraft({ ...editDraft, validFrom: toIsoString(next) }), {
                    type: 'date',
                  })}
                  {field('edit-until', '적용 종료일', toDateInputValue(editDraft.validUntil), (next) => setEditDraft({ ...editDraft, validUntil: toIsoString(next, true) }), {
                    type: 'date',
                  })}
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={editDraft.active}
                      onChange={(event) => setEditDraft({ ...editDraft, active: event.target.checked })}
                    />
                    예약 받기 (사용 중)
                  </label>
                  <div className={styles.actions}>
                    <button type="submit" disabled={pending}>저장</button>
                    <button type="button" disabled={pending} onClick={() => { setEditingId(null); setError(null) }}>
                      취소
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className={styles.cardHead}>
                    <h3 className={styles.cardTitle}>{service.name}</h3>
                    <span className={service.active ? styles.badgeOn : styles.badgeOff}>
                      {service.active ? '사용 중' : '사용 안 함'}
                    </span>
                  </div>
                  <dl className={styles.facts}>
                    <div><dt>가격</dt><dd>{won(service.price)}</dd></div>
                    <div><dt>소요시간</dt><dd>{durationText(service.durationMinutes)}</dd></div>
                    <div><dt>담당자·자원</dt><dd>{service.resourceName ?? '미입력'}</dd></div>
                    <div><dt>취소 규칙</dt><dd>{service.cancellationPolicy ?? '미입력'}</dd></div>
                    <div><dt>적용 기간</dt><dd>{service.validFrom || service.validUntil ? `${service.validFrom ? toDateInputValue(service.validFrom) : '제한 없음'} ~ ${service.validUntil ? toDateInputValue(service.validUntil) : '제한 없음'}` : '제한 없음'}</dd></div>
                  </dl>
                  {service.readiness.missing.map((gap) => (
                    <p className={styles.gap} key={gap}>{READINESS_LABELS[gap]}</p>
                  ))}
                  {canEdit ? (
                    <button
                      className={styles.editButton}
                      type="button"
                      aria-label={`${service.name} 수정`}
                      onClick={() => { setEditingId(service.id); setEditDraft(toDraft(service)); setError(null); setNotice(null) }}
                    >
                      수정
                    </button>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form
          className={styles.form}
          aria-label="새 서비스 추가"
          onSubmit={(event) => {
            event.preventDefault()
            void save(null, draft)
          }}
        >
          <h2 className={styles.formTitle}>서비스 추가</h2>
          <p className={styles.hint}>정확한 예약을 위해 필요한 항목을 입력해 주세요. 입력하지 않은 항목은 비워 둔 채로 저장돼요.</p>
          {field('new-name', '서비스명', draft.name, (next) => setDraft({ ...draft, name: next }), {
            hint: '고객에게 보이는 이름 그대로 적어 주세요.',
          })}
          {field('new-price', '가격(원)', draft.price, (next) => setDraft({ ...draft, price: next }), { type: 'number' })}
          {field('new-duration', '소요시간(분)', draft.durationMinutes, (next) => setDraft({ ...draft, durationMinutes: next }), {
            type: 'number', hint: '예약 확정에 꼭 필요해요. 모르면 비워 두세요.',
          })}
          {field('new-resource', '담당자·자원', draft.resourceName, (next) => setDraft({ ...draft, resourceName: next }))}
          {field('new-cancel', '취소 규칙', draft.cancellationPolicy, (next) => setDraft({ ...draft, cancellationPolicy: next }), {
            multiline: true,
          })}
          {field('new-from', '적용 시작일', toDateInputValue(draft.validFrom), (next) => setDraft({ ...draft, validFrom: toIsoString(next) }), {
            type: 'date',
          })}
          {field('new-until', '적용 종료일', toDateInputValue(draft.validUntil), (next) => setDraft({ ...draft, validUntil: toIsoString(next, true) }), {
            type: 'date',
          })}
          <div className={styles.actions}>
            <button type="submit" disabled={pending}>서비스 추가</button>
          </div>
        </form>
      ) : (
        <p className={styles.permission}>지금은 조회만 할 수 있어요. 입력·수정은 매장 대표나 관리자에게 요청해 주세요.</p>
      )}
    </div>
  )
}
