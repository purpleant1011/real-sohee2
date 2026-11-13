import { describe, expect, it } from 'vitest'
import {
  BYREUM_IMAGE_HARNESS,
  composeByreumImagePrompt,
  parseByreumImageHarness,
} from './byreum-image-harness'
import type { ContentBrief } from '@/features/chat/content-interview'

describe('BYREUM_IMAGE_HARNESS', () => {
  it('captures the approved channels, draft boundary, and 4:5 output contract', () => {
    const harness = parseByreumImageHarness(BYREUM_IMAGE_HARNESS)

    expect(harness.channels).toEqual(['instagram', 'threads', 'naver_blog'])
    expect(harness.output).toMatchObject({
      width: 1088,
      height: 1360,
      format: 'png',
      textAllowed: false,
      logoAllowed: false,
      watermarkAllowed: false,
    })
    expect(harness.approval.defaultStatus).toBe('DRAFT_OWNER_APPROVAL_PENDING')
    expect(harness.claims.realCustomerResultAllowed).toBe(false)
  })

  it.each(['instagram', 'threads', 'naver_blog'] as const)(
    'composes a channel-safe image prompt for %s without reference identity markers',
    (channel) => {
      const prompt = composeByreumImagePrompt({
        harness: BYREUM_IMAGE_HARNESS,
        channel,
        userPrompt: '가을 예약 안내에 사용할 자연눈썹 이미지',
      })

      expect(prompt).toContain('1088x1360')
      expect(prompt).toContain('fictional Korean adult')
      expect(prompt).toContain('neutral-white three-pleat disposable medical mask')
      expect(prompt).toContain('No visible text')
      expect(prompt).toContain('real customer result')
      expect(prompt).not.toContain('noor.brow')
      expect(prompt).not.toContain('바이름')
    },
  )

  it('rejects a structurally weakened active harness', () => {
    expect(() => parseByreumImageHarness({
      ...BYREUM_IMAGE_HARNESS,
      output: { ...BYREUM_IMAGE_HARNESS.output, textAllowed: true },
    })).toThrow()
  })

  it('adds interview image intent without weakening the fixed safety harness', () => {
    const contentBrief = {
      channels: ['instagram'], goal: { value: 'consultation' }, audience: { value: 'local' },
      audienceProblem: '눈썹 비대칭이 고민인 분',
      textDirection: { structure: { value: 'empathy_info_consult' }, tone: '차분하게', messageAngle: '상담 기준' },
      imageDirection: {
        mood: { value: 'design_consult' }, composition: '눈썹 결 가까운 구도', sceneRoles: ['표지'], avoid: ['전후 비교'],
        templateId: 'design_consult', modelAge: '40s', framing: 'upper_body', pose: 'explaining',
        background: 'warm_studio', textOverlay: 'none', extraDirection: '상담 도구가 자연스럽게 보이게',
      },
      callToAction: { value: 'consult' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
    } satisfies ContentBrief
    const prompt = composeByreumImagePrompt({
      harness: BYREUM_IMAGE_HARNESS, channel: 'instagram', userPrompt: '눈썹 이미지', contentBrief,
    })

    expect(prompt).toContain('콘텐츠 목표: consultation')
    expect(prompt).toContain('대상 독자와 고민: 눈썹 비대칭이 고민인 분')
    expect(prompt).toContain('장면 역할: 표지')
    expect(prompt).toContain('피할 장면: 전후 비교')
    expect(prompt).toContain('선택 이미지 템플릿: design_consult')
    expect(prompt).toContain('Template visual direction: calm one-to-one brow design consultation')
    expect(prompt).toContain('모델 연령: 40s')
    expect(prompt).toContain('인물 범위: upper_body')
    expect(prompt).toContain('포즈: explaining')
    expect(prompt).toContain('배경: warm_studio')
    expect(prompt).toContain('텍스트 요소: none')
    expect(prompt).toContain('추가 이미지 요청: 상담 도구가 자연스럽게 보이게')
    expect(prompt).toContain('Selected model age: 40 to 49')
    expect(prompt).toContain('Selected framing: waist-up upper-body portrait')
    expect(prompt).toContain('Selected pose: actively explaining a brow design')
    expect(prompt).toContain('Selected background: warm cream-toned beauty studio')
    expect(prompt).toContain('Text overlay handling: no visible text')
    expect(prompt).toContain('No visible text')
    expect(prompt.indexOf('No visible text')).toBeGreaterThan(prompt.indexOf('콘텐츠 목표'))
  })

  it('비인물 또는 일러스트 추가 요청이 있을 때 하네스 포트레이트/마스크보다 우선(override)된다', () => {
    const contentBrief = {
      channels: ['instagram'], goal: { value: 'awareness' }, audience: { value: 'local' },
      audienceProblem: '가게 소개',
      textDirection: { structure: { value: 'short_natural' }, tone: '자연스럽게', messageAngle: '소개' },
      imageDirection: {
        mood: { value: 'workspace_style' }, composition: '자연스러운 구도', sceneRoles: ['대표 장면'], avoid: [],
        templateId: 'workspace_style', modelAge: '30s', framing: 'upper_body', pose: 'front',
        background: 'bright_studio', textOverlay: 'none',
        extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
      },
      callToAction: { value: 'explore' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
    } satisfies ContentBrief

    const prompt = composeByreumImagePrompt({
      harness: BYREUM_IMAGE_HARNESS, channel: 'instagram', userPrompt: '홍보 포스팅', contentBrief,
    })

    expect(prompt).toContain('MUST OVERRIDE')
    expect(prompt).toContain('이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트')
    expect(prompt).toContain('Do NOT include any human face')
    expect(prompt).not.toContain('medical mask')
    expect(prompt).not.toContain('One fictional Korean adult')
    expect(prompt).not.toContain('synthetic-person')
    expect(prompt).not.toContain('Selected model age')
    expect(prompt).not.toContain('photorealistic portrait image')
    expect(prompt).not.toContain('모델 연령')
    expect(prompt).not.toContain('인물 범위')
    expect(prompt).not.toContain('포즈:')
  })

  it('비인물 요청에 배경 옵션이 없어도 인물 구도로 fallback하지 않고 safe 배경이 적용된다', () => {
    const contentBrief = {
      channels: ['instagram'], goal: { value: 'awareness' }, audience: { value: 'local' },
      audienceProblem: '가게 소개',
      textDirection: { structure: { value: 'short_natural' }, tone: '자연스럽게', messageAngle: '소개' },
      imageDirection: {
        mood: { value: 'workspace_style' }, composition: '자연스러운 구도', sceneRoles: ['대표 장면'], avoid: [],
        templateId: 'workspace_style',
        extraDirection: '사람없는 매장 전경 사진',
      },
      callToAction: { value: 'explore' }, mustInclude: [], mustAvoid: [], referenceMediaIds: [],
    } satisfies ContentBrief

    const prompt = composeByreumImagePrompt({
      harness: BYREUM_IMAGE_HARNESS, channel: 'instagram', userPrompt: '홍보 포스팅', contentBrief,
    })

    expect(prompt).toContain('Composition and setting: warm cream-toned clean beauty studio or treatment room without people.')
    expect(prompt).not.toContain('waist-up upper-body portrait')
    expect(prompt).not.toContain('medical mask')
  })
})
