import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MissionPlanDiffRail } from '../mission-plan-diff-rail'
import { MissionPlanDiffCard } from '../mission-plan-diff-card'
import { MissionRehearsalCard } from '../mission-rehearsal-card'
import type { PlanDiff } from '@/lib/mission-os/mission-plan-diff'
import type { RehearsalResult, PreLiveVerificationResult } from '@/lib/mission-os/mission-rehearsal'

const sampleDiff: PlanDiff = {
  mission_id: 'msn_figma_d11',
  old_contract_version: 1,
  new_contract_version: 2,
  expected_snapshot_version: 2,
  idempotency_key: 'idemp_sample_123',
  payload_hash: 'hash_sample_456',
  changed_fields: [
    {
      field: 'service_scope',
      old_value: ['instagram', 'threads'],
      new_value: ['instagram'],
      description_ko: '실행 채널 범위 변경: [instagram, threads] -> [instagram]',
    },
  ],
  preserved_constraints: ['예산 상한 유지: 50,000 KRW', '목표 유지: 가을 예약 10건'],
  impacted_unexecuted_steps: ['스레드 예약 포스트'],
  already_submitted_effects: [
    {
      effect_id: 'eff_1',
      action_type: 'PUBLISH_POST',
      target_channel: 'instagram',
      status: 'VERIFIED',
      submitted_at: '2026-10-27T01:00:00.000Z',
    },
  ],
  invalidated_approvals: ['appr_old_threads'],
  requires_reapproval: true,
  cost_difference_minor_units: 0,
  is_ambiguous: false,
  proposed_contract: {
    contract_version: 2,
    goal: '가을 예약 10건',
    success_criterion: {
      metric: 'reservations',
      target_value: 10,
    },
    observation_window: {
      start_at: '2026-10-27T00:00:00.000Z',
      end_at: '2026-11-03T00:00:00.000Z',
    },
    service_scope: ['instagram'],
    allowed_actions: ['PUBLISH_POST'],
    forbidden_actions: [],
    budget_caps: {
      max_cost_minor_units: 5000000,
      currency: 'KRW',
    },
    attention_policy: {
      max_escalations: 2,
      notify_on_breach: true,
    },
    fact_version_refs: {},
    policy_version: 'v1',
    approval_fingerprint: null,
    owner_actor: { actor_type: 'user' },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2026-11-05T00:00:00.000Z',
  },
  created_at: '2026-10-27T02:00:00.000Z',
}

describe('Figma D11 (PC): MissionPlanDiffRail Component', () => {
  it('renders plan diff rail with version, changed items, preserved constraints, and CTA button', () => {
    const handleApply = vi.fn()
    const handleReject = vi.fn()

    render(
      <MissionPlanDiffRail
        diff={sampleDiff}
        onApplyPlan={handleApply}
        onRejectPlan={handleReject}
      />
    )

    // Version badge
    expect(screen.getByText('v1 → v2')).toBeDefined()
    // Changed field description
    expect(screen.getByText(/실행 채널 범위 변경/)).toBeDefined()
    // Preserved constraint
    expect(screen.getByText(/예산 상한 유지/)).toBeDefined()
    // Impacted step
    expect(screen.getByText('스레드 예약 포스트')).toBeDefined()
    // Protected effect note
    expect(screen.getByText(/진행 완료된 작업/)).toBeDefined()

    // Click Apply CTA
    const applyBtn = screen.getByRole('button', { name: /계획 확정/i })
    fireEvent.click(applyBtn)
    expect(handleApply).toHaveBeenCalledWith(sampleDiff)
  })
})

describe('Figma M20 (Mobile): MissionPlanDiffCard Component', () => {
  it('renders mobile plan diff card with review badge, cost, and approval CTA', () => {
    const handleApprove = vi.fn()
    const handleReject = vi.fn()

    render(
      <MissionPlanDiffCard
        diff={sampleDiff}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    )

    // Review needed badge
    expect(screen.getByText('검토 필요')).toBeDefined()
    expect(screen.getByText('v1 → v2')).toBeDefined()
    expect(screen.getByText('0원 (기존 예산 유지)')).toBeDefined()

    // Click Approve CTA
    const approveBtn = screen.getByRole('button', { name: /계획 승인하기/i })
    fireEvent.click(approveBtn)
    expect(handleApprove).toHaveBeenCalledWith(sampleDiff)
  })
})

describe('ANI-1880: MissionRehearsalCard Component', () => {
  const sampleRehearsal: RehearsalResult = {
    success: true,
    is_rehearsal: true,
    kpi_isolated: true,
    live_provider_write_count: 0,
    rehearsal_run_id: 'reh_12345',
    contract_version: 1,
    receipts: [
      {
        proof_receipt_id: 'rcpt_preview_1',
        rehearsal_run_id: 'reh_12345',
        mission_id: 'msn_figma_d11',
        workspace_id: 'ws_test',
        target_channel: 'instagram',
        simulated_post_id: 'sim_1',
        preview_permalink: 'https://preview.local/1',
        content_preview_text: '미리보기 텍스트',
        content_hash_sha256: 'a'.repeat(64),
        is_rehearsal: true,
        kpi_isolated: true,
        verified_at: '2026-10-27T02:00:00.000Z',
      },
    ],
    total_simulated_cost_minor_units: 0,
    timeline_items: [
      {
        id: 'act_1',
        time: '14:30',
        title: 'INSTAGRAM 가상 발행 리허설',
        status: 'PREVIEW_VERIFIED',
        cost_minor_units: 0,
      },
    ],
    created_at: '2026-10-27T02:00:00.000Z',
  }

  it('renders rehearsal badge, zero writes disclaimer, and timeline items', () => {
    render(<MissionRehearsalCard rehearsal={sampleRehearsal} />)

    expect(screen.getByText('연습 리허설')).toBeDefined()
    expect(screen.getByText('외부 게시 0건')).toBeDefined()
    expect(screen.getByText(/실제 발송되지 않는 안전한 미리보기/)).toBeDefined()
    expect(screen.getByText('INSTAGRAM 가상 발행 리허설')).toBeDefined()
  })

  it('handles promote to live CTA when verification is passed', () => {
    const handlePromote = vi.fn()
    const verification: PreLiveVerificationResult = {
      canPromoteToLive: true,
      reasons: [],
      verifiedAt: '2026-10-27T02:00:00.000Z',
    }

    render(
      <MissionRehearsalCard
        rehearsal={sampleRehearsal}
        verification={verification}
        onPromoteToLive={handlePromote}
      />
    )

    const promoteBtn = screen.getByRole('button', { name: /실서비스로 전환하기/i })
    expect(promoteBtn).toBeDefined()
    fireEvent.click(promoteBtn)
    expect(handlePromote).toHaveBeenCalled()
  })
})
