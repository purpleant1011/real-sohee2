import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NaverReadinessCard } from './naver-readiness-card'
import type { ReadinessEvaluation } from '../editorial-readiness'

describe('NaverReadinessCard', () => {
  const completeReadyEvaluation: ReadinessEvaluation = {
    rubricVersion: '1.2.0',
    evaluatedAt: '2026-11-03T10:00:00Z',
    dimensions: [
      {
        key: 'FACTUAL_SUPPORT',
        maxScore: 30,
        rawScore: 28,
        status: 'ASSESSED',
        reason: '승인된 사실 근거가 잘 반영되었습니다.',
        suggestedFixes: [],
      },
      {
        key: 'READER_QUESTION_COVERAGE',
        maxScore: 25,
        rawScore: 22,
        status: 'ASSESSED',
        reason: '독자 질문에 대한 답변이 포함되었습니다.',
        suggestedFixes: ['질문 내용을 조금 더 상세히 다뤄보세요.'],
      },
      {
        key: 'UNIQUENESS_AND_NOVELTY',
        maxScore: 20,
        rawScore: 18,
        status: 'ASSESSED',
        reason: '독창적인 제목과 새로운 내용으로 구성되었습니다.',
        suggestedFixes: [],
      },
      {
        key: 'READABILITY',
        maxScore: 15,
        rawScore: 14,
        status: 'ASSESSED',
        reason: '읽기 편하게 구성되었습니다.',
        suggestedFixes: [],
      },
      {
        key: 'IMAGE_RIGHTS_AND_CTA',
        maxScore: 10,
        rawScore: 9,
        status: 'ASSESSED',
        reason: '이미지 권리 및 CTA 요건을 충족했습니다.',
        suggestedFixes: [],
      },
    ],
    hardStops: [],
    totalIfComplete: 91,
    eligibility: 'READY',
    actionableFixes: ['질문 내용을 조금 더 상세히 다뤄보세요.'],
    disclaimer: '소희가 발행 전 원고를 점검한 내부 진단이며 네이버 검색 순위·노출과는 관련 없어요.',
  }

  const incompleteEvaluation: ReadinessEvaluation = {
    rubricVersion: '1.2.0',
    evaluatedAt: '2026-11-03T10:00:00Z',
    dimensions: [
      {
        key: 'FACTUAL_SUPPORT',
        maxScore: 30,
        rawScore: null,
        status: 'NOT_ASSESSED',
        reason: '승인된 사실 근거가 제공되지 않아 평가하지 않았습니다.',
        suggestedFixes: ['본문의 사실 관계를 확인하고 승인 근거를 등록해 주세요.'],
      },
      {
        key: 'READER_QUESTION_COVERAGE',
        maxScore: 25,
        rawScore: 20,
        status: 'ASSESSED',
        reason: '독자 질문이 반영되었습니다.',
        suggestedFixes: [],
      },
      {
        key: 'UNIQUENESS_AND_NOVELTY',
        maxScore: 20,
        rawScore: 16,
        status: 'ASSESSED',
        reason: '독창적인 구성입니다.',
        suggestedFixes: [],
      },
      {
        key: 'READABILITY',
        maxScore: 15,
        rawScore: 12,
        status: 'ASSESSED',
        reason: '가독성이 양호합니다.',
        suggestedFixes: [],
      },
      {
        key: 'IMAGE_RIGHTS_AND_CTA',
        maxScore: 10,
        rawScore: null,
        status: 'NOT_ASSESSED',
        reason: '이미지 정보가 제공되지 않았습니다.',
        suggestedFixes: ['원고에 사용할 이미지를 등록해 주세요.'],
      },
    ],
    hardStops: [],
    totalIfComplete: null,
    eligibility: 'INCOMPLETE',
    actionableFixes: [
      '본문의 사실 관계를 확인하고 승인 근거를 등록해 주세요.',
      '원고에 사용할 이미지를 등록해 주세요.',
    ],
    disclaimer: '소희가 발행 전 원고를 점검한 내부 진단이며 네이버 검색 순위·노출과는 관련 없어요.',
  }

  const hardStopEvaluation: ReadinessEvaluation = {
    rubricVersion: '1.2.0',
    evaluatedAt: '2026-11-03T10:00:00Z',
    dimensions: [
      {
        key: 'FACTUAL_SUPPORT',
        maxScore: 30,
        rawScore: 0,
        status: 'BLOCKED',
        reason: '승인되지 않은 가격이나 의학적 효능 등 사실 왜곡 위험 표현이 있습니다.',
        suggestedFixes: ['미승인 가격/할인 표기를 삭제하거나 사실 근거를 승인해 주세요.'],
      },
      {
        key: 'READER_QUESTION_COVERAGE',
        maxScore: 25,
        rawScore: 20,
        status: 'ASSESSED',
        reason: '독자 질문 반영됨',
        suggestedFixes: [],
      },
      {
        key: 'UNIQUENESS_AND_NOVELTY',
        maxScore: 20,
        rawScore: 15,
        status: 'ASSESSED',
        reason: '독창성 양호',
        suggestedFixes: [],
      },
      {
        key: 'READABILITY',
        maxScore: 15,
        rawScore: 12,
        status: 'ASSESSED',
        reason: '가독성 양호',
        suggestedFixes: [],
      },
      {
        key: 'IMAGE_RIGHTS_AND_CTA',
        maxScore: 10,
        rawScore: 8,
        status: 'ASSESSED',
        reason: 'CTA 포함',
        suggestedFixes: [],
      },
    ],
    hardStops: [
      {
        code: 'UNAPPROVED_PRICE_CLAIM',
        message: '승인되지 않은 가격 또는 할인 표현이 본문에 포함되어 있습니다.',
      },
    ],
    totalIfComplete: null,
    eligibility: 'NOT_READY',
    actionableFixes: ['승인되지 않은 가격 또는 할인 표현이 본문에 포함되어 있습니다.'],
    disclaimer: '소희가 발행 전 원고를 점검한 내부 진단이며 네이버 검색 순위·노출과는 관련 없어요.',
  }

  it('renders card title, experimental badge, and disclaimer', () => {
    render(<NaverReadinessCard evaluation={completeReadyEvaluation} />)

    expect(screen.getByRole('heading', { name: /소희 콘텐츠 준비도\(자체 진단\)/ })).toBeInTheDocument()
    expect(screen.getByText('실험적 진단')).toBeInTheDocument()
    expect(screen.getByText(/소희가 발행 전 원고를 점검한 내부 진단이며/)).toBeInTheDocument()
  })

  it('displays "아직 확인이 필요한 항목이 있어요" and "미평가" for NOT_ASSESSED when total is null, without fake 0 points', () => {
    render(<NaverReadinessCard evaluation={incompleteEvaluation} />)

    expect(screen.getByText('아직 확인이 필요한 항목이 있어요')).toBeInTheDocument()
    const unassessedBadges = screen.getAllByText('미평가')
    expect(unassessedBadges.length).toBeGreaterThanOrEqual(2)

    // 0점 날조 금지: total이나 NOT_ASSESSED 축에 단독 '0점'이나 '0 / 30' 등으로 표시되면 안 됨
    expect(screen.queryByText(/^0점$/)).toBeNull()
    expect(screen.queryByText(/0 \/ 30/)).toBeNull()
  })

  it('displays "게시 준비 불가/확인 필요" before any score when hardStops exist', () => {
    render(<NaverReadinessCard evaluation={hardStopEvaluation} />)

    expect(screen.getByText('게시 준비 불가/확인 필요')).toBeInTheDocument()
    const stopMessages = screen.getAllByText('승인되지 않은 가격 또는 할인 표현이 본문에 포함되어 있습니다.')
    expect(stopMessages.length).toBeGreaterThanOrEqual(1)
  })

  it('displays dimension raw/max scores for assessed axes and actionable fixes up to 3', () => {
    render(<NaverReadinessCard evaluation={completeReadyEvaluation} />)

    expect(screen.getByText('91점')).toBeInTheDocument()
    expect(screen.getByText('28 / 30점')).toBeInTheDocument()
    expect(screen.getByText('22 / 25점')).toBeInTheDocument()
    expect(screen.getByText('질문 내용을 조금 더 상세히 다뤄보세요.')).toBeInTheDocument()
  })

  it('handles null evaluation gracefully without crashing', () => {
    const { container } = render(<NaverReadinessCard evaluation={null} />)
    expect(container.firstChild).toBeNull()
  })
})
