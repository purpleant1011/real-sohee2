import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SoheeLiveWorkboard } from '../sohee-live-workboard'
import type { WorkboardSnapshot } from '@/features/agent-os/workboard-types'

describe('SoheeLiveWorkboard Component (ANI-909, Figma 32:2412)', () => {
  const baseSnapshot: WorkboardSnapshot = {
    workspaceId: 'ws-test',
    runtimeState: 'RUNNING',
    statusReason: '정상 자율 운영 중',
    mission: {
      id: 'msn-1',
      title: '봄맞이 신규 고객 유치 및 예약 프로모션',
      businessGoal: '신규 예약 전환 4건 달성',
      stage: 'PLAN',
      stageProgress: 45,
    },
    appliedRules: [
      { id: 'r-1', label: '이미지 Harness v13', sourceType: 'HARNESS', sourceVersion: 'v13' },
      { id: 'r-2', label: '당일예약 CTA', sourceType: 'POLICY', sourceVersion: 'v1.2' },
      { id: 'r-3', label: '할인율 ≤ 10%', sourceType: 'CHARTER', sourceVersion: 'A3-v1' },
    ],
    lastProof: {
      id: 'prf-1',
      label: '인스타그램 피드 2건 예약 슬롯 연동 게시',
      verificationState: 'VERIFIED',
      verifiedAt: '2026-09-06T04:30:00.000Z',
    },
    nextAction: {
      label: '예약 문의 감지 및 상담 답변 자동 분석',
      scheduledAt: '2026-09-06T05:00:00.000Z',
    },
    ownerActionRequiredCount: 0,
    freshness: 'FRESH',
    updatedAt: new Date().toISOString(),
  }

  afterEach(() => vi.unstubAllGlobals())

  it('does not interpret a failed workboard read as an idle worker with no work', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    render(<SoheeLiveWorkboard workspaceId="ws-test" />)
    expect(await screen.findByText('업무 상태를 확인하지 못했어요')).toBeInTheDocument()
    expect(screen.queryByText('지금 진행 중인 업무가 없어요. 새로운 소식을 준비해 보세요.')).toBeNull()
  })

  it('never displays a fetched snapshot from another workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(baseSnapshot)))
    render(<SoheeLiveWorkboard workspaceId="another-shop" />)
    expect(await screen.findByText('업무 상태를 확인하지 못했어요')).toBeInTheDocument()
    expect(screen.queryByText(baseSnapshot.mission!.title)).toBeNull()
  })

  it('renders mission title, goal, applied rules, proof, and next action', () => {
    render(<SoheeLiveWorkboard snapshot={baseSnapshot} />)

    expect(screen.getByText('봄맞이 신규 고객 유치 및 예약 프로모션')).toBeDefined()
    expect(screen.getByText(/신규 예약 전환 4건 달성/)).toBeDefined()
    expect(screen.getByText('이미지 Harness v13')).toBeDefined()
    expect(screen.getByText('당일예약 CTA')).toBeDefined()
    expect(screen.getByText('인스타그램 피드 2건 예약 슬롯 연동 게시')).toBeDefined()
    expect(screen.getByText(/예약 문의 감지 및 상담 답변 자동 분석/)).toBeDefined()
  })

  it('contains NO Pause/Resume/Stop buttons (observational contract)', () => {
    render(<SoheeLiveWorkboard snapshot={baseSnapshot} />)

    expect(screen.queryByRole('button', { name: /일시정지|일시 정지|Pause/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /재개|Resume/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /중단|Stop/i })).toBeNull()
  })

  it('truthfully communicates PAUSED state without claiming active execution', () => {
    const pausedSnapshot: WorkboardSnapshot = {
      ...baseSnapshot,
      runtimeState: 'PAUSED',
      statusReason: '원장님에 의해 업무 일시정지됨',
      mission: null,
      nextAction: null,
    }

    render(<SoheeLiveWorkboard snapshot={pausedSnapshot} />)

    expect(screen.getByText('소희의 업무가 잠시 멈췄어요.')).toBeDefined()
    expect(screen.getByText('원장님에 의해 업무 일시정지됨')).toBeDefined()
    expect(screen.queryByText('실행 중')).toBeNull()
  })

  it('renders truthful empty state when no verified proof exists', () => {
    const noProofSnapshot: WorkboardSnapshot = {
      ...baseSnapshot,
      lastProof: null,
    }

    render(<SoheeLiveWorkboard snapshot={noProofSnapshot} />)

    expect(screen.getByText(/검증 대기|검증된 최근 작업 없음/)).toBeDefined()
  })
})
