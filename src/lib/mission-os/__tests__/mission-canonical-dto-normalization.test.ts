import { describe, it, expect } from 'vitest'
import {
  buildCanonicalMissionDTO,
} from '../mission-read-model'
import type { MarketingMissionAggregate } from '../mission-types'

describe('CanonicalMissionDTO normalization & fail-closed robustness', () => {
  const baseAggregate: MarketingMissionAggregate = {
    id: 'm-norm-12345',
    workspace_id: 'ws-norm-67890',
    trace_id: 'tr-norm-11111',
    status: 'PUBLISHED_VERIFIED',
    goal: '인스타그램 피드 발행 후 예약 문의 5건 달성',
    target_channel: 'instagram',
    created_at: '2026-10-27T00:00:00.000Z',
    updated_at: '2026-10-27T01:00:00.000Z',
    metadata: {
      snapshot_version: 2,
      plan_version: 1,
      contract: {
        contract_version: 'v1.0',
        plan_version: 1,
        created_at: '2026-10-27T00:00:00.000Z',
        expires_at: '2026-10-29T00:00:00.000Z',
        observation_window: {
          start_at: '2026-10-27T00:00:00.000Z',
          end_at: '2026-10-28T12:00:00.000Z',
          evaluation_interval_hours: 2,
        },
      },
      observation_evidence: {
        status: 'NOT_OBSERVED',
        observed_value: null,
      },
    },
  }

  it('normalizes valid contract with dual snake_case and camelCase field aliases', () => {
    const dto = buildCanonicalMissionDTO(baseAggregate)
    expect(dto.missionId).toBe('m-norm-12345')
    expect(dto.mission_id).toBe('m-norm-12345')
    expect(dto.snapshotVersion).toBe(2)
    expect(dto.snapshot_version).toBe(2)
    expect(dto.planVersion).toBe(1)
    expect(dto.plan_version).toBe(1)
    expect(dto.executionState).toBe('OBSERVING')
    expect(dto.execution_state).toBe('OBSERVING')
    expect(dto.outcomeState).toBe('PENDING')
    expect(dto.outcome_state).toBe('PENDING')
    expect(dto.permittedActions).toBeInstanceOf(Array)
    expect(dto.permitted_actions).toEqual(dto.permittedActions)
    expect(dto.errors).toEqual([])
    expect(dto.nextCheckAt).toBe('2026-10-27T03:00:00.000Z')
  })

  it('safely handles malformed contract metadata without throwing RangeError / Invalid time value', () => {
    const malformedAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      metadata: {
        snapshot_version: 'invalid' as any,
        contract: {
          // missing end_at and invalid dates
          observation_window: {
            end_at: 'not-a-valid-date-string',
            evaluation_interval_hours: 'not-a-number' as any,
          },
        } as any,
      },
    }

    // Must not throw RangeError: toISOString() on NaN
    expect(() => buildCanonicalMissionDTO(malformedAggregate)).not.toThrow()
    const dto = buildCanonicalMissionDTO(malformedAggregate)
    expect(dto.snapshotVersion).toBe(1)
    expect(dto.snapshot_version).toBe(1)
    expect(dto.nextCheckAt).toBeNull()
  })

  it('safely handles missing contract or undefined observation_window in legacy rows', () => {
    const legacyAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      metadata: {},
    }

    expect(() => buildCanonicalMissionDTO(legacyAggregate)).not.toThrow()
    const dto = buildCanonicalMissionDTO(legacyAggregate)
    expect(dto.nextCheckAt).toBeNull()
    expect(dto.planVersion).toBe(1)
    expect(dto.snapshotVersion).toBe(1)
  })

  it('honestly represents READ_FAILED and preserves sanitized errors != empty/0 without raw token leaks', () => {
    const readFailedAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      metadata: {
        ...baseAggregate.metadata,
        observation_evidence: {
          status: 'READ_FAILED',
          observed_value: 0, // Even if raw value is 0, READ_FAILED must not be collapsed to 0
        },
        errors: ['PROVIDER_TIMEOUT: instagram insights 504 Gateway Timeout and internal token secret_123'],
      },
    }

    const dto = buildCanonicalMissionDTO(readFailedAggregate)
    expect(dto.observationStatus).toBe('READ_FAILED')
    expect(dto.userCopy).toContain('성과 지표 조회 실패')
    expect(dto.errors.length).toBeGreaterThanOrEqual(1)
    // Security check: raw tokens and English codes must not be leaked, sanitized Korean allowlist used
    expect(dto.errors).toContain('외부 서비스 통신 지연으로 재확인이 필요합니다.')
    expect(dto.errors.every(err => !err.includes('secret_123'))).toBe(true)
    expect(dto.errors.every(err => !err.includes('READ_FAILED'))).toBe(true)
  })

  it('does not fabricate a goal for legacy missions without goals', () => {
    const noGoalAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      goal: '   ',
    }

    const dto = buildCanonicalMissionDTO(noGoalAggregate)
    expect(dto.goal).toBe('목표 미지정 (레거시 작업)')
  })

  it('restricts permitted_actions to only allowlisted mounted server commands (empty array in read-only slice)', () => {
    const pausedAggregate: MarketingMissionAggregate = {
      ...baseAggregate,
      status: 'PAUSED' as any,
    }

    const dto = buildCanonicalMissionDTO(pausedAggregate)
    expect(dto.permitted_actions).toEqual([])
    expect(dto.permitted_actions).not.toContain('PRODUCE_CONTENT')
    expect(dto.permitted_actions).not.toContain('EXECUTE_PUBLISH')
  })
})
