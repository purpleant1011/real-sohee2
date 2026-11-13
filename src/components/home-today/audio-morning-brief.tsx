'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Volume2, VolumeX, Pause, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { HomeApprovalItem } from '@/features/home/home-approval-types'

export interface AudioMorningBriefProps {
  businessName?: string
  items: HomeApprovalItem[]
  autonomyLevel: 'L1' | 'L2' | 'L3'
  autoHandledCount: number
}

export function AudioMorningBrief({
  businessName = '사장님',
  items,
  autonomyLevel,
  autoHandledCount,
}: AudioMorningBriefProps) {
  const [isSupported, setIsSupported] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setIsSupported(true)
    }
  }, [])

  // Build natural, warm conversational Korean briefing text
  const buildBriefingScript = useCallback(() => {
    const total = items.length
    const dms = items.filter((i) => i.category === 'dm_reply').length
    const posts = items.filter((i) => i.category === 'post_publish').length

    let script = `${businessName} 사장님, 좋은 아침이에요! `

    if (total === 0) {
      script += `오늘 사장님이 승인하실 항목이 모두 완료되었어요! 새로운 고객 문의나 포스팅이 생기면 소희가 바로 알려드릴게요.`
      return script
    }

    script += `오늘 승인이 필요한 작업은 총 ${total}건이에요. `

    if (dms > 0) {
      const dmItem = items.find((i) => i.category === 'dm_reply')
      const customer = dmItem?.targetLabel ? dmItem.targetLabel.replace(/\([^)]*\)/g, '').trim() : '고객님'
      script += `인스타그램으로 ${customer}의 예약 및 가격 문의가 도착해 있어요. `
    }

    if (posts > 0) {
      script += `오늘 저녁 19시 골든타임에 맞춰 발행할 소셜 콘텐츠가 준비되어 있어요. `
    }

    if (autoHandledCount > 0 && (autonomyLevel === 'L2' || autonomyLevel === 'L3')) {
      script += `일상 칭찬 댓글 ${autoHandledCount}건은 소희가 알아서 답글을 발송하고 있으니 안심하세요. `
    }

    script += `승인 센터에서 한 번에 싹 확인해 주시면 소희가 바로 처리할게요!`
    return script
  }, [businessName, items, autonomyLevel, autoHandledCount])

  const stopAudio = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setIsPlaying(false)
    setIsPaused(false)
  }, [])

  const startAudio = useCallback(() => {
    if (!isSupported) return
    const synth = window.speechSynthesis
    synth.cancel()

    const text = buildBriefingScript()
    const utterance = new SpeechSynthesisUtterance(text)

    // Voice selection: prioritize Korean voice
    const voices = synth.getVoices()
    const koreanVoice = voices.find(
      (v) => v.lang.startsWith('ko') || v.name.includes('Korean') || v.name.includes('Yuna')
    )
    if (koreanVoice) {
      utterance.voice = koreanVoice
    }
    utterance.lang = 'ko-KR'
    utterance.rate = 1.05
    utterance.pitch = 1.05

    utterance.onstart = () => {
      setIsPlaying(true)
      setIsPaused(false)
    }

    utterance.onend = () => {
      setIsPlaying(false)
      setIsPaused(false)
    }

    utterance.onerror = () => {
      setIsPlaying(false)
      setIsPaused(false)
    }

    utteranceRef.current = utterance
    synth.speak(utterance)
  }, [isSupported, buildBriefingScript])

  const togglePlayPause = () => {
    if (!isSupported) return
    const synth = window.speechSynthesis

    if (isPlaying && !isPaused) {
      synth.pause()
      setIsPaused(true)
    } else if (isPlaying && isPaused) {
      synth.resume()
      setIsPaused(false)
    } else {
      startAudio()
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  if (!isSupported) return null

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={togglePlayPause}
        aria-label="소희 10초 출근 음성 브리핑"
        className={`h-7 px-2.5 text-xs font-medium rounded-lg transition-all ${
          isPlaying
            ? 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800 animate-pulse'
            : 'text-foreground/80 hover:text-purple-700 hover:border-purple-300'
        }`}
      >
        {isPlaying ? (
          <>
            {isPaused ? <Play className="w-3.5 h-3.5 mr-1 text-purple-600" /> : <Pause className="w-3.5 h-3.5 mr-1 text-purple-600" />}
            <span className="flex items-center gap-1">
              {isPaused ? '브리핑 일시정지' : '브리핑 듣는 중'}
              {!isPaused && (
                <span className="flex gap-0.5 items-center ml-0.5">
                  <span className="w-1 h-2 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-3 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1.5 bg-purple-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <Volume2 className="w-3.5 h-3.5 mr-1 text-purple-600 dark:text-purple-400" />
            <span>🔊 10초 출근 브리핑</span>
          </>
        )}
      </Button>

      {isPlaying && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={stopAudio}
          className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          aria-label="음성 끄기"
        >
          <VolumeX className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  )
}
