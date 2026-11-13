import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState, FirstWeekPlan, ComingSoonRoadmap } from './empty-state'

const cases = [
  ['home', '첫 소식 준비하기'],
  ['content', '첫 글 준비하기'],
  ['vault', '콘텐츠 만들기'],
  ['customers', '첫 소식 준비하기'],
  ['results', '첫 콘텐츠 준비하기'],
] as const

describe('성공한 빈 목록 안내', () => {
  it.each(cases)('%s has exactly one action', (area, action) => {
    render(<EmptyState area={area} />)
    expect(screen.getByRole('link', { name: action })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('always labels all three first-week ideas as examples', () => {
    render(<FirstWeekPlan />)
    expect(screen.getAllByText('예시')).toHaveLength(3)
    expect(screen.getByText('월 이벤트 글 준비')).toBeInTheDocument()
    expect(screen.getByText('후기 요청 문구')).toBeInTheDocument()
    expect(screen.getByText('지역 소식 글')).toBeInTheDocument()
  })
  it('presents live features and upcoming items with proper statuses and links', () => {
    render(<ComingSoonRoadmap />)
    expect(screen.getAllByText('가동 중')).toHaveLength(3)
    expect(screen.getByText('준비 중')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getByText('네이버 블로그 원고 준비')).toBeInTheDocument()
    expect(screen.queryByText(/네이버 블로그 실발행/)).not.toBeInTheDocument()
    expect(screen.queryByText(/스마트플레이스 연동 및 원클릭 블로그 발행/)).not.toBeInTheDocument()
    expect(screen.queryByText(/1초/)).not.toBeInTheDocument()
  })
})
