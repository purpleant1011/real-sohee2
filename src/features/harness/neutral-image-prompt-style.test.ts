import { describe, expect, it } from 'vitest'
import { composeNeutralImagePrompt } from './neutral-image-prompt'
import type { ContentBrief } from '@/features/chat/content-interview'

const brief: ContentBrief = {
  channels: ['instagram'], goal: { value: 'awareness' }, audience: { value: 'local' },
  audienceProblem: '선물을 고르는 고객',
  textDirection: { structure: { value: 'short_natural' }, tone: '따뜻한', messageAngle: '소개' },
  imageDirection: {
    mood: { value: 'detail' }, composition: '작업대를 가까이', sceneRoles: ['상품 디테일'],
    avoid: ['비닐 포장'], templateId: 'detail', modelAge: '40s', framing: 'upper_body',
    pose: 'side', background: 'natural_light', textOverlay: 'short_copy', extraDirection: '보라색 꽃다발만 사용',
  },
  callToAction: { value: 'explore' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
}

describe('composeNeutralImagePrompt with an owner style', () => {
  const style = { subject: '네일 아트 완성 손', mood: '', setting: '', lookAndColor: '파스텔', people: 'hands' as const, avoid: ['네온'], extra: '', composition: '', guide: '', referenceAssetIds: [], referenceNotes: {} }

  it('injects the registered style and keeps the no-text constraints', () => {
    const prompt = composeNeutralImagePrompt({ channel: 'instagram', userPrompt: '봄 신상', workspaceStyle: style })
    expect(prompt).toContain('네일 아트 완성 손')
    expect(prompt).toContain('네온')
    expect(prompt).toContain('no visible text')
  })

  it('passes the interview scene settings and extra instruction to the general image prompt', () => {
    const prompt = composeNeutralImagePrompt({ channel: 'instagram', userPrompt: '선물 소개', workspaceStyle: style, contentBrief: brief })
    expect(prompt).toContain('보라색 꽃다발만 사용')
    expect(prompt).toContain('비닐 포장')
    expect(prompt).toContain('upper-body')
    expect(prompt).toContain('three-quarter')
    expect(prompt).toContain('40 to 49')
    expect(prompt).toContain('negative space')
    expect(prompt).toContain('상품 디테일')
  })

  it('does not impose default model or room choices when using the workspace style', () => {
    const prompt = composeNeutralImagePrompt({
      channel: 'instagram', userPrompt: '선물 소개', workspaceStyle: style,
      contentBrief: { ...brief, imageDirection: { ...brief.imageDirection, templateId: 'workspace_style' } },
    })
    expect(prompt).not.toContain('40 to 49')
    expect(prompt).not.toContain('upper-body')
    expect(prompt).toContain('보라색 꽃다발만 사용')
  })

  it('is unchanged when no style is registered', () => {
    const a = composeNeutralImagePrompt({ channel: 'instagram', userPrompt: '봄 신상' })
    const b = composeNeutralImagePrompt({ channel: 'instagram', userPrompt: '봄 신상', workspaceStyle: null })
    expect(a).toBe(b)
    expect(a).not.toContain('Owner-defined')
  })

  it('이번 글의 extraDirection이 전역 workspaceStyle과 기본 사진 규칙보다 우선(override)된다', () => {
    const prompt = composeNeutralImagePrompt({
      channel: 'instagram',
      userPrompt: '홍보 글',
      workspaceStyle: {
        ...style,
        subject: '시술 포트레이트',
        people: 'people',
        guide: '반드시 시술 중인 인물을 포함할 것',
      },
      contentBrief: {
        ...brief,
        imageDirection: {
          ...brief.imageDirection,
          extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
        },
      },
    })

    // extraDirection이 최우선 override로 프롬프트에 명시되어야 함
    expect(prompt).toContain('Critical post-specific override (MUST OVERRIDE all owner styles, stock rules, and photograph defaults above): 이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트')
    // 일러스트 요청 시 illustration 금지 문구가 들어가지 않아야 함
    expect(prompt).not.toContain('without artificial polish or illustration style')
    // 비인물 요청 시 인물 포함 지시문이 들어가지 않아야 함
    expect(prompt).not.toContain('include a natural-looking fictional adult person')
    expect(prompt).not.toContain('If a person is needed, use a fictional adult')
  })
})
