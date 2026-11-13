import { describe, expect, it } from 'vitest'
import type { NaverBlogDraft } from './naver-blog-draft-provider'
import { createNaverBlogImagePrompts } from './naver-blog-image-brief'
import type { ContentBrief } from './content-interview'

const draft: NaverBlogDraft = {
  title: '청라 눈썹 반영구, 자연스러운 디자인을 위한 상담 기준',
  introduction: '매일 아침 눈썹 대칭 때문에 고민하는 분을 위한 안내입니다.',
  sections: [
    { heading: '얼굴형과 결을 함께 봅니다', body: '골격과 눈가 움직임을 살펴 맞춤 디자인 방향을 정합니다.' },
    { heading: '상담에서 확인할 세 가지', body: '원하는 두께와 평소 메이크업, 남아 있는 흔적을 함께 확인합니다.' },
  ],
  editorBlueprint: [
    { kind: 'paragraph', text: '매일 아침 눈썹 대칭 때문에 고민하는 분을 위한 안내입니다.' },
    { kind: 'image_slot', position: 1, altText: '정면에서 자연스러운 눈썹 결이 보이는 표지 이미지' },
    { kind: 'heading', text: '얼굴형과 결을 함께 봅니다' },
    { kind: 'image_slot', position: 2, altText: '눈썹 결의 부드러운 흐름이 보이는 상세 이미지' },
    { kind: 'heading', text: '상담에서 확인할 세 가지' },
    { kind: 'image_slot', position: 3, altText: '상담을 편안하게 연상시키는 마무리 이미지' },
  ],
  keywords: ['청라눈썹', '눈썹반영구'], cta: '바이름 상담으로 어울리는 방향을 확인해 보세요.', disclosure: '',
  observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
}

describe('createNaverBlogImagePrompts', () => {
  it('binds every image position to the blog title, nearby section, and exact slot description', () => {
    const prompts = createNaverBlogImagePrompts({ draft, count: 3, userPrompt: '바이름 홍보 글과 이미지 3장' })

    expect(prompts).toHaveLength(3)
    expect(prompts[0]).toContain('청라 눈썹 반영구')
    expect(prompts[0]).toContain('정면에서 자연스러운 눈썹 결이 보이는 표지 이미지')
    expect(prompts[1]).toContain('얼굴형과 결을 함께 봅니다')
    expect(prompts[1]).toContain('눈썹 결의 부드러운 흐름이 보이는 상세 이미지')
    expect(prompts[2]).toContain('상담에서 확인할 세 가지')
    expect(prompts[2]).toContain('상담을 편안하게 연상시키는 마무리 이미지')
    expect(new Set(prompts).size).toBe(3)
  })

  it('keeps every image brief within the image harness input limit for long blog sections', () => {
    const prompts = createNaverBlogImagePrompts({
      draft: {
        ...draft,
        sections: draft.sections.map((section) => ({ ...section, body: '긴 상담 설명입니다. '.repeat(700) })),
      },
      count: 3,
      userPrompt: '바이름 눈썹 블로그 글과 이미지 3장',
    })

    expect(prompts.every((prompt) => prompt.length <= 1_400)).toBe(true)
    expect(prompts[1]).toContain('눈썹 결의 부드러운 흐름이 보이는 상세 이미지')
  })

  it('aligns each image slot with the same interview brief and its scene role', () => {
    const contentBrief = {
      channels: ['naver_blog'], goal: { value: 'consultation' }, audience: { value: 'local' },
      audienceProblem: '눈썹 비대칭 때문에 상담 기준을 찾는 분',
      textDirection: { structure: { value: 'empathy_info_consult' }, tone: '차분하게', messageAngle: '고민 공감 뒤 기준 안내' },
      imageDirection: { mood: { value: 'detail' }, composition: '자연스러운 눈썹 결', sceneRoles: ['편안한 표지', '눈썹 결 상세', '상담 마무리'], avoid: ['전후 비교'] },
      callToAction: { value: 'consult' }, mustInclude: [], mustAvoid: ['가격 단정'], referenceMediaIds: [],
    } satisfies ContentBrief
    const prompts = createNaverBlogImagePrompts({ draft, count: 3, userPrompt: '바이름 글', contentBrief })

    expect(prompts[0]).toContain('콘텐츠 목표: consultation')
    expect(prompts[0]).toContain('장면 역할: 편안한 표지')
    expect(prompts[1]).toContain('장면 역할: 눈썹 결 상세')
    expect(prompts[2]).toContain('장면 역할: 상담 마무리')
    expect(prompts.every((prompt) => prompt.includes('피할 장면: 전후 비교'))).toBe(true)
  })

  it('uses industry-neutral sentence for non-Byreum business', () => {
    const taxDraft: NaverBlogDraft = {
      title: '개인사업자 종합소득세 신고 핵심 팁',
      introduction: '5월 종합소득세 신고 시 챙겨야 할 서류를 안내합니다.',
      sections: [{ heading: '서류 준비', body: '누락 서류를 점검하세요.' }],
      editorBlueprint: [
        { kind: 'image_slot', position: 1, altText: '세무 상담 데스크' },
      ],
      keywords: ['종합소득세'], cta: '세무 상담을 받아보세요.', disclosure: '',
      observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    }
    const prompts = createNaverBlogImagePrompts({
      draft: taxDraft,
      count: 1,
      userPrompt: '세무 상담 안내 글',
      isByreum: false,
    })

    expect(prompts[0]).toContain('텍스트와 이미지가 본문 내용 및 주제와 자연스럽게 이어져야 합니다.')
    expect(prompts[0]).not.toContain('바이름')
    expect(prompts[0]).not.toContain('눈썹 반영구')
  })

  it('appends image style promptHint when imageStyle is provided', () => {
    const prompts = createNaverBlogImagePrompts({
      draft,
      count: 2,
      userPrompt: '매장 사진과 글',
      imageStyle: 'bright_space',
    })

    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Bright and airy space with natural sunlight')
    expect(prompts[1]).toContain('Bright and airy space with natural sunlight')
  })
})
