import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveChatToolbeltBar } from '../LiveChatToolbeltBar'

describe('LiveChatToolbeltBar Policy Copy Audit', () => {
  it('does not leak hardcoded Byreum accounts (@studio_byreum, byreum_official) and shows 연결 전 when unconnected', () => {
    render(<LiveChatToolbeltBar />)

    // Hardcoded Byreum accounts should never appear in default view
    expect(screen.queryByText(/@studio_byreum/)).not.toBeInTheDocument()
    expect(screen.queryByText(/byreum_official/)).not.toBeInTheDocument()

    // Instagram tooltip shows '연결 전'
    const instagramBtn = screen.getByText('인스타그램')
    fireEvent.mouseEnter(instagramBtn.parentElement!)
    expect(screen.getByText('계정: 연결 전')).toBeInTheDocument()
    expect(screen.queryByText(/@studio_byreum/)).not.toBeInTheDocument()

    // Naver blog tooltip shows '연결 전'
    const naverBtn = screen.getByText('네이버 블로그')
    fireEvent.mouseEnter(naverBtn.parentElement!)
    expect(screen.getByText('계정: 연결 전')).toBeInTheDocument()
    expect(screen.queryByText(/byreum_official/)).not.toBeInTheDocument()
  })

  it('does not claim Instagram story/DM auto publish or Naver blog auto posting, and avoids exaggerated words', () => {
    render(<LiveChatToolbeltBar />)

    // Trigger tooltips to render summaries
    const instagramBtn = screen.getByText('인스타그램')
    fireEvent.mouseEnter(instagramBtn.parentElement!)

    expect(screen.queryByText(/스토리\/DM 자동 발행/)).not.toBeInTheDocument()
    expect(screen.getByText('피드/릴스 발행 및 DM 초안 준비')).toBeInTheDocument()
    expect(screen.queryByText(/READY \(즉시 가동\)/)).not.toBeInTheDocument()

    // Google ads is READY (가동 가능)
    const googleBtn = screen.getByText('구글 광고')
    fireEvent.mouseEnter(googleBtn.parentElement!)
    expect(screen.queryByText(/READY \(즉시 가동\)/)).not.toBeInTheDocument()
    expect(screen.getByText('READY (가동 가능)')).toBeInTheDocument()

    const naverBtn = screen.getByText('네이버 블로그')
    fireEvent.mouseEnter(naverBtn.parentElement!)
    expect(screen.queryByText(/SEO 키워드 최적화 포스팅/)).not.toBeInTheDocument()
    expect(screen.getByText('검색 최적화 원고 및 사진 준비')).toBeInTheDocument()

    const kakaoBtn = screen.getByText('카카오톡')
    fireEvent.mouseEnter(kakaoBtn.parentElement!)
    expect(screen.queryByText(/즉시 응대/)).not.toBeInTheDocument()
    expect(screen.getByText('알림톡·상담톡 답변 초안 준비')).toBeInTheDocument()
  })
})
