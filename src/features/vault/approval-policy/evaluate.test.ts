import { describe, expect, it } from 'vitest'
import { evaluateApprovalActions, listAvailableApprovalActions, VAULT_APPROVAL_LABEL } from './index'
import type { SpecEvaluationResult } from '@/features/vault/channel-spec/types'

const specResult: SpecEvaluationResult = { blocksVault: false, specVersion: 'v1', checks: [] }
const base = { channel: 'instagram' as const, readiness: 'PUBLISH_READY' as const, connection: 'VERIFIED' as const,
  providerReviewStatus: 'APPROVED' as const, specResult, targetTime: '2026-12-01T00:00:00Z' }

describe('ANI-1533 approval actions', () => {
  it.each(['instagram', 'threads', 'naver_blog', 'daangn_business'] as const)('%s: vault is possible even without a connection, but spec FAIL blocks it', (channel) => {
    const actions = evaluateApprovalActions({ ...base, channel, readiness: 'PREPARE_ONLY', connection: 'DISCONNECTED' })
    expect(actions.VAULT.allowed).toBe(true)
    expect(actions.PUBLISH.allowed).toBe(false)
    expect(actions.SCHEDULE.allowed).toBe(false)
    expect(evaluateApprovalActions({ ...base, channel, specResult: { ...specResult, blocksVault: true } }).VAULT.allowed).toBe(false)
  })

  it.each(['instagram', 'threads'] as const)('%s: verified channel and approved app enable manual publish and scheduling', (channel) => {
    const result = evaluateApprovalActions({ ...base, channel })
    expect(listAvailableApprovalActions({ ...base, channel })).toEqual(['VAULT', 'PUBLISH', 'SCHEDULE'])
    expect(result.SCHEDULE.allowed).toBe(true)
  })

  it('Meta pending review disables external actions with a clear reason, not vault', () => {
    const result = evaluateApprovalActions({ ...base, providerReviewStatus: 'PENDING' })
    expect(result.VAULT.allowed).toBe(true)
    expect(result.PUBLISH).toMatchObject({ allowed: false, message: 'Meta 앱 심사가 끝나면 열려요' })
    expect(result.SCHEDULE.allowed).toBe(false)
  })

  it('unverified target channel stays blocked even if another channel is publish-ready', () => {
    const result = evaluateApprovalActions({ ...base, connection: 'DISCONNECTED' })
    expect(result.PUBLISH).toMatchObject({ allowed: false, message: '채널을 연결하면 발행할 수 있어요' })
  })

  it.each(['naver_blog', 'daangn_business'] as const)('%s: no external automation before provider release', (channel) => {
    const result = evaluateApprovalActions({ ...base, channel })
    expect(result.PUBLISH.allowed).toBe(false)
    expect(result.PUBLISH.message).toContain(channel === 'naver_blog' ? '네이버 연동은 준비 중이에요' : '당근 연동은 준비 중이에요')
    expect(result.VAULT.allowed).toBe(true)
  })

  it('requires an explicit scheduled time and has no implicit default action', () => {
    const result = evaluateApprovalActions({ ...base, targetTime: null })
    expect(result.PUBLISH.allowed).toBe(true)
    expect(result.SCHEDULE.allowed).toBe(false)
    expect(result.SCHEDULE.message).toContain('예정 시각')
    expect(VAULT_APPROVAL_LABEL).not.toContain('예약됨')
  })
})
