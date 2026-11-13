import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  EvidenceCard,
  ContextInspector,
  ExternalActionTimeline,
  IntegrityAlert,
  RuntimeBuildIdentity,
  EmployeeWorkCard,
  WebhookHealthBadge,
  ScopeDriftAlert,
} from '@/components/v088/same-truth'

describe('Figma 7th Extended Same-Truth Components Parity (ANI-1001, ANI-1002, ANI-1011, ANI-1013)', () => {
  it('renders EvidenceCard with cryptographic receipt details and SHA-256 hash', () => {
    render(
      <EvidenceCard
        receiptId="rcpt_prod_test_001"
        provider="instagram"
        status="VERIFIED"
        occurredAt="2026-09-07T15:00:00Z"
        evidenceHash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        permalink="https://www.instagram.com/p/test1234"
      />
    )

    expect(screen.getByText(/인스타그램 \(Instagram\)/i)).toBeDefined()
    expect(screen.getByText(/rcpt_prod_test_001/i)).toBeDefined()
    expect(screen.getByText(/증거 기록이 저장돼 있어요/i)).toBeDefined()
    expect(screen.getByText(/원문 보기/i)).toBeDefined()
  })

  it('renders ContextInspector displaying Canonical Business Profile & Memory Seeding Exclusion', () => {
    render(
      <ContextInspector
        workspaceId="ws_prod_001"
        businessProfile={{
          businessName: '바이름 뷰티 스튜디오',
          industry: '뷰티/헤어',
          location: '인천 청라',
          summary: '프리미엄 뷰티 솔루션',
        }}
        brandProfile={{
          voice: '차분하고 정중한 어조',
          keywords: ['퍼스널 컬러', '전문 상담'],
          prohibitedTerms: ['과장 광고'],
        }}
        durableMemoryCount={3}
        agentRunId="agent_prod_sohee_01"
        persistenceState="READBACK_VERIFIED"
      />
    )

    expect(screen.getByText(/소희 직원 런타임 맥락 인스펙터/i)).toBeDefined()
    expect(screen.getByText(/확인 완료/i)).toBeDefined()
    expect(screen.getByText(/실시간 DB 동기화 맥락 주입 상태/i)).toBeDefined()
  })

  it('renders ExternalActionTimeline showing Meta 14-step ledger lifecycle', () => {
    render(
      <ExternalActionTimeline
        actionId="act_prod_meta_001"
        channel="instagram"
        actionType="FEED_POST"
        currentStage="PROVIDER_API_CALLED"
        isSuccess={true}
        receiptId="rcpt_meta_001"
      />
    )

    expect(screen.getByText(/Meta 14단계 퍼블리시 기록 타임라인/i)).toBeDefined()
    expect(screen.getByText(/1\. 요청 접수 및 검증/i)).toBeDefined()
    expect(screen.getByText(/2\. 멱등키 잠금 \(Lock\)/i)).toBeDefined()
  })

  it('renders IntegrityAlert for SCHEMA_DRIFT with recovery action guidance', () => {
    render(
      <IntegrityAlert
        type="SCHEMA_DRIFT"
      />
    )

    // 내부 코드(SCHEMA_DRIFT)는 사용자 화면에 노출하지 않고 한국어 제목/분류 라벨만 보여준다
    expect(screen.getByText('프로덕션 DB 스키마 불일치가 감지되었습니다')).toBeDefined()
    expect(screen.getByText('구조 불일치')).toBeDefined()
    expect(screen.queryByText(/SCHEMA_DRIFT/)).toBeNull()
    expect(screen.getByText(/시스템 진단 확인/i)).toBeDefined()
  })

  it('renders RuntimeBuildIdentity showing commit sha and ready status', () => {
    render(
      <RuntimeBuildIdentity
        initialData={{
          gitCommitSha: 'a8f20a70f40d1234567890abcdef',
          buildTime: '2026-09-07 15:25:00',
          expectedMigrationHead: '20260907_production_truth_ledger',
          schemaContractHash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
          ready: true,
        }}
      />
    )

    expect(screen.getByText(/런타임 빌드 & 스키마 정본 식별자/i)).toBeDefined()
    expect(screen.getAllByText(/a8f20a7/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/20260907_production_truth_ledger/i)).toBeDefined()
    expect(screen.getByText(/READY \(진실 보장\)/i)).toBeDefined()
  })

  it('renders EmployeeWorkCard with situation context summary and actions', () => {
    render(
      <EmployeeWorkCard
        item={{
          id: 'work_001',
          title: '스레드 신규 고객 문의 자동 답변',
          category: 'dm',
          status: 'approval_required',
          summary: '예약 취소 및 환불 규정에 대한 인바운드 문의 접수',
          occurredAt: '2026-09-07 15:10:00',
        }}
      />
    )

    expect(screen.getByText(/스레드 신규 고객 문의 자동 답변/i)).toBeDefined()
    expect(screen.getByText(/사장님 승인 대기/i)).toBeDefined()
    expect(screen.getByText(/예약 취소 및 환불 규정에 대한 인바운드 문의 접수/i)).toBeDefined()
  })

  it('renders WebhookHealthBadge with healthy status', () => {
    render(
      <WebhookHealthBadge
        status="HEALTHY"
        lastReceivedAt="2026-09-07 15:20:00"
      />
    )

    expect(screen.getByText(/웹훅 정상 수신/i)).toBeDefined()
    expect(screen.queryByText(/HEALTHY/)).toBeNull()
    expect(screen.getByText(/마지막 수신: 2026-09-07 15:20:00/i)).toBeDefined()
  })

  it('renders ScopeDriftAlert displaying missing permissions and reconnect link', () => {
    render(
      <ScopeDriftAlert
        channel="threads"
        requiredScopes={['threads_basic', 'threads_content_publish', 'threads_read_replies']}
        grantedScopes={['threads_basic', 'threads_content_publish']}
        missingScopes={['threads_read_replies']}
      />
    )

    expect(screen.getByText(/스레드 \(Threads\) 권한 범위 불일치 감지/i)).toBeDefined()
    expect(screen.queryByText(/SCOPE_DRIFT/)).toBeNull()
    expect(screen.getByText(/누락 1개/i)).toBeDefined()
    expect(screen.getByText(/threads_read_replies/i)).toBeDefined()
    expect(screen.getByText(/권한 재인증 \(1-Click\)/i)).toBeDefined()
  })
})
