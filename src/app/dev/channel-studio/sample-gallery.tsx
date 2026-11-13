'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChannelPreview, type ChannelPreviewProps } from '@/features/preview/channel-preview'
import {
  STUDIO_CHANNELS,
  STUDIO_CHANNEL_LABELS,
  type ChannelDraftResult,
  type ChannelDraftVariant,
  type StudioChannel,
} from '@/features/channel-studio/types'
import {
  SAMPLE_CAFE_DRAFT,
  SAMPLE_DRAFTS_BY_INDUSTRY,
} from '@/features/channel-studio/ui/sample-draft'

type IndustryKey = keyof typeof SAMPLE_DRAFTS_BY_INDUSTRY

/**
 * ChannelDraftVariant payload를 ChannelPreview props로 변환하는 최소 로컬 변환기.
 * 정식 변환기(payload-to-preview.ts)는 스트림 3 소유이므로 여기서는 자체 최소 변환만 유지합니다.
 */
function toPreviewProps(variant: ChannelDraftVariant, contextLabel?: string): ChannelPreviewProps {
  const p = variant.payload
  switch (variant.channel) {
    case 'instagram': {
      const imageUrls = Array.isArray(p.imageUrls)
        ? (p.imageUrls.filter((item): item is string => typeof item === 'string'))
        : typeof p.imageUrl === 'string'
          ? [p.imageUrl]
          : undefined
      return {
        channel: 'instagram',
        contextLabel,
        variant: {
          handle: typeof p.handle === 'string' ? p.handle : '@소희_스튜디오',
          caption: typeof p.caption === 'string' ? p.caption : '',
          hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]) : undefined,
          imageUrls,
          imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : undefined,
          timeLabel: typeof p.timeLabel === 'string' ? p.timeLabel : undefined,
        },
      }
    }
    case 'threads':
      return {
        channel: 'threads',
        contextLabel,
        variant: {
          handle: typeof p.handle === 'string' ? p.handle : '@소희_스튜디오',
          caption: typeof p.caption === 'string' ? p.caption : '',
          hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]) : undefined,
          imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : undefined,
          timeLabel: typeof p.timeLabel === 'string' ? p.timeLabel : undefined,
        },
      }
    case 'naver_blog':
      return {
        channel: 'naver_blog',
        contextLabel,
        variant: {
          title: typeof p.title === 'string' ? p.title : '',
          text: typeof p.text === 'string' ? p.text : '',
          hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]) : undefined,
        },
      }
    case 'daangn_business':
      return {
        channel: 'daangn_business',
        contextLabel,
        variant: {
          text: typeof p.text === 'string' ? p.text : '',
          businessName: typeof p.businessName === 'string' ? p.businessName : undefined,
          firstLineHighlight: typeof p.firstLineHighlight === 'string' ? p.firstLineHighlight : undefined,
        },
      }
  }
}

export interface SampleGalleryProps {
  readonly initialDraft?: ChannelDraftResult
}

export function SampleGallery({ initialDraft = SAMPLE_CAFE_DRAFT }: SampleGalleryProps) {
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryKey>('cafe')
  const [selectedChannelTab, setSelectedChannelTab] = useState<'all' | StudioChannel>('all')

  const activeDraft = selectedIndustry === 'cafe' && initialDraft !== SAMPLE_CAFE_DRAFT
    ? initialDraft
    : SAMPLE_DRAFTS_BY_INDUSTRY[selectedIndustry].draft

  const industryLabel = SAMPLE_DRAFTS_BY_INDUSTRY[selectedIndustry].label

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-8 text-foreground">
      {/* 면책 및 샘플 안내 상단 바 */}
      <section aria-label="샘플 안내" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-medium">샘플 데이터</Badge>
          <span className="text-sm font-medium text-foreground">4채널 스튜디오 실측·증거 갤러리</span>
        </div>
        <p className="text-xs text-muted-foreground">실제 게시 화면과 다를 수 있어요.</p>
      </section>

      {/* 업종 선택 탭 */}
      <section aria-label="업종별 샘플 선택" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">업종별 샘플 초안</h2>
        <Tabs value={selectedIndustry} onValueChange={(val) => setSelectedIndustry(val as IndustryKey)}>
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            {(Object.keys(SAMPLE_DRAFTS_BY_INDUSTRY) as IndustryKey[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {SAMPLE_DRAFTS_BY_INDUSTRY[key].label.split(' ')[0]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </section>

      {/* 현재 선택된 초안 요약 카드 */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg font-bold">{activeDraft.topic}</CardTitle>
            <Badge variant="outline">{industryLabel}</Badge>
          </div>
          <CardDescription>
            생성 기준: {activeDraft.basisNotes.join(' · ')}
          </CardDescription>
        </CardHeader>
        {activeDraft.imageNotice ? (
          <CardContent className="pt-0 text-xs text-muted-foreground">
            안내: {activeDraft.imageNotice}
          </CardContent>
        ) : null}
      </Card>

      {/* 채널 뷰 탭 그리드 */}
      <section aria-label="채널별 초안 및 예상 화면" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">채널별 예상 화면 및 점검 상태</h2>
          <Tabs value={selectedChannelTab} onValueChange={(val) => setSelectedChannelTab(val as 'all' | StudioChannel)}>
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="all">전체 채널</TabsTrigger>
              {STUDIO_CHANNELS.map((ch) => (
                <TabsTrigger key={ch} value={ch}>
                  {STUDIO_CHANNEL_LABELS[ch]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* 그리드 렌더링 */}
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {activeDraft.variants
            .filter((v) => selectedChannelTab === 'all' || v.channel === selectedChannelTab)
            .map((variant) => {
              const previewProps = toPreviewProps(variant, `${industryLabel} · ${STUDIO_CHANNEL_LABELS[variant.channel]}`)
              const isNeedsCheck = variant.status === 'NEEDS_CHECK'

              return (
                <div key={variant.channel} className="min-w-0 space-y-3">
                  {/* 채널 헤더 및 상태 */}
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="font-semibold text-sm">{STUDIO_CHANNEL_LABELS[variant.channel]}</span>
                    <Badge variant={isNeedsCheck ? 'destructive' : 'secondary'}>
                      {variant.statusLabel}
                    </Badge>
                  </div>

                  {/* 확인 필요 안내 (이유 문구 한국어) */}
                  {variant.issues.length > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                      <p className="font-semibold mb-1">확인이 필요한 항목:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {variant.issues.map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* 예상 화면 컴포넌트 */}
                  <div className="min-w-0">
                    <ChannelPreview {...previewProps} />
                  </div>
                </div>
              )
            })}
        </div>
      </section>
    </div>
  )
}
