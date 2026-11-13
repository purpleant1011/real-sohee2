import { describe, expect, it } from 'vitest'
import {
  buildNaverManuscriptTags,
  buildNaverManuscriptText,
  extractNaverTags,
  type NaverManuscript,
} from './naver-manuscript'

const post: NaverManuscript = {
  title: '제목', introduction: '이전 소개',
  sections: [{ heading: '이전 소제목', body: '이전 본문' }],
  keywords: ['#가게', '안내'], cta: '이전 문의', disclosure: 'AI 보조 제작',
  editorBlocks: [
    { kind: 'heading', text: '최종 소제목' },
    { kind: 'paragraph', text: '긴 본문'.repeat(1_000) + '마지막 문장' },
    { kind: 'image', mediaId: 'photo', altText: '사진' },
    { kind: 'quote', text: '인용문' },
    { kind: 'link', title: '상담 안내', url: 'https://example.com/info' },
    { kind: 'map', placeName: '가게 위치' },
    { kind: 'cta', text: '최종 문의' },
  ],
}

describe('Naver manuscript projection', () => {
  it('uses final editor blocks without clipping or reviving the older draft', () => {
    const text = buildNaverManuscriptText(post)
    expect(text).toBe([
      post.title, '최종 소제목', '긴 본문'.repeat(1_000) + '마지막 문장', '인용문',
      '상담 안내 (https://example.com/info)', '가게 위치', '최종 문의', 'AI 보조 제작', '#가게 #안내',
    ].join('\n\n'))
    expect(text).not.toContain('이전')
  })

  it('keeps the body separate from title and tags while preserving disclosure', () => {
    const text = buildNaverManuscriptText(post, 'body')
    expect(text.split('\n')).not.toContain(post.title)
    expect(text).toMatch(/^최종 소제목\n/u)
    expect(text).not.toContain('#가게')
    expect(text).toContain('마지막 문장')
    expect(text).toMatch(/AI 보조 제작$/u)
    expect(buildNaverManuscriptText(post, 'title')).toBe('제목')
    expect(buildNaverManuscriptText(post, 'tags')).toBe('#가게 #안내')
  })

  it('preserves the legacy structured manuscript when editor blocks are absent', () => {
    expect(buildNaverManuscriptText({ ...post, editorBlocks: undefined })).toBe([
      '제목', '이전 소개', '[이전 소제목]', '이전 본문', '이전 문의', 'AI 보조 제작', '#가게 #안내',
    ].join('\n\n'))
  })
})

describe('Naver manuscript tag normalization', () => {
  it('가운뎃점·슬래시·공백·쉼표·기타 특수문자를 구분자로 나누어 별개 태그로 분리한다', () => {
    const rawKeywords = [
      '인천미용·네일·뷰티',
      '피부/에스테틱',
      '강남역 맛집',
      '속눈썹, 속눈썹펌',
      '#청라!힐링~케어?',
    ]
    expect(extractNaverTags(rawKeywords)).toEqual([
      '인천미용', '네일', '뷰티',
      '피부', '에스테틱',
      '강남역', '맛집',
      '속눈썹', '속눈썹펌',
      '청라',
    ])
  })

  it('대소문자를 무시하고 중복을 제거하며 첫 등장 순서를 유지한다', () => {
    const rawKeywords = ['NAIL', '네일', 'nail', '네일아트', 'Nail', '뷰티']
    expect(extractNaverTags(rawKeywords)).toEqual(['NAIL', '네일', '네일아트', '뷰티'])
  })

  it('길이 2~20자만 허용하고 1자 및 21자 이상은 제외한다', () => {
    const rawKeywords = [
      'A',
      '점',
      '강남',
      '가'.repeat(20),
      '나'.repeat(21),
    ]
    expect(extractNaverTags(rawKeywords)).toEqual(['강남', '가'.repeat(20)])
  })

  it('최대 10개까지만 유지한다', () => {
    const rawKeywords = [
      '태그01', '태그02', '태그03', '태그04', '태그05',
      '태그06', '태그07', '태그08', '태그09', '태그10',
      '태그11', '태그12',
    ]
    expect(extractNaverTags(rawKeywords)).toHaveLength(10)
    expect(extractNaverTags(rawKeywords)).toEqual([
      '태그01', '태그02', '태그03', '태그04', '태그05',
      '태그06', '태그07', '태그08', '태그09', '태그10',
    ])
  })

  it('buildNaverManuscriptTags는 # 중복 접두를 제거하고 #태그 형식 한 줄 공백 구분으로 반환한다', () => {
    const manuscript: NaverManuscript = {
      title: '제목',
      introduction: '',
      sections: [],
      keywords: ['###인천미용·네일·뷰티', '#강남역 맛집'],
    }
    expect(buildNaverManuscriptTags(manuscript)).toBe(
      '#인천미용 #네일 #뷰티 #강남역 #맛집',
    )
  })

  it('태그 후보가 없거나 모두 유효하지 않으면 빈 문자열을 반환한다', () => {
    expect(buildNaverManuscriptTags({ title: '제목', introduction: '', sections: [] })).toBe('')
    expect(buildNaverManuscriptTags({
      title: '제목',
      introduction: '',
      sections: [],
      keywords: ['#', '!', ' ', 'a', '1'],
    })).toBe('')
  })
})
