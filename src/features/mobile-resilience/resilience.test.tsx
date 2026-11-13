// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { classifyFailure, decideResume, mergeRouteState, type ResumeInput } from './resume-model'
import { FailurePanel } from './failure-panel'
import { useResumeRevalidation } from './use-resume'

const NOW = '2026-10-23T09:00:00.000Z'
const base = (o: Partial<ResumeInput> = {}): ResumeInput => ({
  hiddenAt: '2026-10-23T08:59:50.000Z', now: NOW, lastCheckedAt: '2026-10-23T08:59:45.000Z',
  tenantAtHide: 'a', tenantNow: 'a', versionAtOpen: 3, versionNow: 3, ...o,
})

describe('classifyFailure', () => {
  it('상태 코드마다 다른 다음 행동을 준다', () => {
    expect(classifyFailure(401).next).toBe('sign_in')
    expect(classifyFailure(403).next).toBe('ask_admin')
    expect(classifyFailure(409).next).toBe('refresh_and_review')
    expect(classifyFailure(500).next).toBe('retry')
    expect(classifyFailure('network').kind).toBe('offline')
    expect(classifyFailure(429).kind).toBe('rate_limited')
  })
  it('409·401·403 은 자동 재시도하지 않는다', () => {
    for (const s of [401, 403, 409]) expect(classifyFailure(s).retryable).toBe(false)
    expect(classifyFailure(503).retryable).toBe(true)
  })
})

describe('decideResume', () => {
  it('잠깐 숨겼다 돌아오고 같은 가게·같은 버전이면 재확인 불필요', () => {
    const d = decideResume(base())
    expect([d.revalidate, d.hideData, d.requireReview, d.hideSuccessBadges]).toEqual([false, false, false, false])
  })
  it('오래 숨겼거나 확인한 지 오래되면 재확인하고 성공 배지를 숨긴다', () => {
    expect(decideResume(base({ hiddenAt: '2026-10-23T08:50:00.000Z' })).hideSuccessBadges).toBe(true)
    expect(decideResume(base({ lastCheckedAt: '2026-10-23T08:00:00.000Z' })).revalidate).toBe(true)
  })
  it('가게가 바뀌었거나 알 수 없으면 이전 데이터를 숨긴다', () => {
    expect(decideResume(base({ tenantNow: 'b' })).hideData).toBe(true)
    expect(decideResume(base({ tenantAtHide: null })).hideData).toBe(true)
  })
  it('다른 기기에서 승인 버전이 바뀌면 재검토를 요구한다', () => {
    expect(decideResume(base({ versionNow: 4 })).requireReview).toBe(true)
    expect(decideResume(base({ versionNow: null })).requireReview).toBe(true)
  })
  it('시각을 읽을 수 없으면 재확인(fail-closed)', () => {
    expect(decideResume(base({ lastCheckedAt: 'x' })).revalidate).toBe(true)
    expect(decideResume(base({ lastCheckedAt: null })).revalidate).toBe(true)
  })
})

describe('mergeRouteState', () => {
  it('필터를 URL 에 남기고 빈 값은 지운다', () => {
    expect(mergeRouteState('?tab=a', { channel: 'kakao' })).toBe('?tab=a&channel=kakao')
    expect(mergeRouteState('?tab=a&channel=kakao', { channel: null })).toBe('?tab=a')
    expect(mergeRouteState('', { x: '' })).toBe('')
  })
})

describe('FailurePanel / useResumeRevalidation', () => {
  it('409 패널은 바뀐 내용 확인 버튼 하나를 보여준다', () => {
    const go = vi.fn()
    render(<FailurePanel status={409} onAction={go} />)
    expect(screen.getByRole('alert').textContent).toContain('내용이 바뀌었어요')
    fireEvent.click(screen.getByRole('button', { name: '바뀐 내용 확인' }))
    expect(go).toHaveBeenCalledWith('refresh_and_review')
  })
  it('화면이 다시 보이면 콜백이 불리고 숨김 시각을 넘긴다', () => {
    const cb = vi.fn()
    renderHook(() => useResumeRevalidation(cb))
    const set = (s: 'hidden' | 'visible') => Object.defineProperty(document, 'visibilityState', { value: s, configurable: true })
    act(() => { set('hidden'); document.dispatchEvent(new Event('visibilitychange')) })
    expect(cb).not.toHaveBeenCalled()
    act(() => { set('visible'); document.dispatchEvent(new Event('visibilitychange')) })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(typeof cb.mock.calls[0][0].hiddenAt).toBe('string')
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
