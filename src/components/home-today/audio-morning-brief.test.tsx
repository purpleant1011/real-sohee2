import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AudioMorningBrief } from './audio-morning-brief'

describe('AudioMorningBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders briefing button when speechSynthesis is available', () => {
    const mockSynth = {
      cancel: vi.fn(),
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
    }
    vi.stubGlobal('speechSynthesis', mockSynth)

    render(
      <AudioMorningBrief
        businessName="바이름 청라점"
        items={[]}
        autonomyLevel="L2"
        autoHandledCount={0}
      />
    )

    expect(screen.getByText('🔊 10초 출근 브리핑')).toBeInTheDocument()
  })

  it('triggers speech synthesis when clicked', () => {
    const mockSynth = {
      cancel: vi.fn(),
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
    }
    vi.stubGlobal('speechSynthesis', mockSynth)
    vi.stubGlobal('SpeechSynthesisUtterance', vi.fn().mockImplementation(function (text) { return { text } }))

    const items = [
      {
        id: 'dm:1',
        category: 'dm_reply' as const,
        channel: 'instagram' as const,
        title: 'DM 문의',
        targetLabel: '김민지 (@customer)',
        sourceSnippet: '예약 문의',
        draftSnippet: '답변',
        createdAt: '2026-10-15T00:00:00Z',
      },
    ]

    render(
      <AudioMorningBrief
        businessName="바이름 청라점"
        items={items}
        autonomyLevel="L2"
        autoHandledCount={2}
      />
    )

    const btn = screen.getByText('🔊 10초 출근 브리핑')
    fireEvent.click(btn)

    expect(mockSynth.cancel).toHaveBeenCalled()
    expect(mockSynth.speak).toHaveBeenCalled()
  })
})
