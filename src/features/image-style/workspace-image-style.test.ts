import { describe, expect, it } from 'vitest'
import {
  composeStyleDirectiveLines,
  normalizeWorkspaceImageStyleInput,
  pickWorkspaceImageStyle,
} from './workspace-image-style'

describe('normalizeWorkspaceImageStyleInput', () => {
  it('trims fields, splits avoid list and rejects an empty style', () => {
    expect(normalizeWorkspaceImageStyleInput({
      subject: '  네일 아트 완성 손  ', mood: '', setting: '', lookAndColor: '', people: 'hands',
      avoid: '네온, 과한 보정,  ,글자', extra: '',
    })).toEqual({
      ok: true,
      style: expect.objectContaining({ subject: '네일 아트 완성 손', people: 'hands', avoid: ['네온', '과한 보정', '글자'] }),
    })
    expect(normalizeWorkspaceImageStyleInput({
      subject: '', mood: ' ', setting: '', lookAndColor: '', people: 'any', avoid: '', extra: '',
    })).toEqual({ ok: false, message: expect.stringContaining('한 가지') })
  })

  it('rejects over-long fields', () => {
    const result = normalizeWorkspaceImageStyleInput({
      subject: '가'.repeat(301), mood: '', setting: '', lookAndColor: '', people: 'any', avoid: '', extra: '',
    })
    expect(result.ok).toBe(false)
  })
})

describe('pickWorkspaceImageStyle', () => {
  const custom = { rule_key: 'custom-image-style-v1', structured_rule: { custom: { subject: '네일', people: 'hands', avoid: [] } } }
  const legacy = { rule_key: 'image-harness-v1', structured_rule: { rules: { modelStyle: '제빵 장인', environment: '원목 매장', lighting: '자연광', colorTone: '베이지', composition: '45도', forbiddenElements: ['네온'] } } }
  const quick = { rule_key: 'quick-image-style', structured_rule: { rules: { style: '자연스러운 사진' } } }

  it('prefers the owner-defined style over legacy and quick rules', () => {
    expect(pickWorkspaceImageStyle([quick, legacy, custom])?.subject).toBe('네일')
  })
  it('maps the legacy V0.91 visual rules', () => {
    expect(pickWorkspaceImageStyle([quick, legacy])).toMatchObject({
      subject: '제빵 장인', setting: '원목 매장', avoid: ['네온'],
    })
  })
  it('returns null for unknown or malformed rows', () => {
    expect(pickWorkspaceImageStyle([{ rule_key: 'x', structured_rule: {} }])).toBeNull()
    expect(pickWorkspaceImageStyle([{ rule_key: 'custom-image-style-v1', structured_rule: 'bad' }])).toBeNull()
  })
})

describe('composeStyleDirectiveLines', () => {
  it('turns the style into prompt lines including people and avoid rules', () => {
    const lines = composeStyleDirectiveLines({
      subject: '네일 아트', mood: '화사', setting: '', lookAndColor: '파스텔', people: 'hands', avoid: ['네온'], extra: '', composition: '', guide: '', referenceAssetIds: [], referenceNotes: {},
    }).join('\n')
    expect(lines).toContain('네일 아트')
    expect(lines).toContain('hands')
    expect(lines).toContain('네온')
  })
})

describe('extended teaching fields', () => {
  const base = { subject: '', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: '', extra: '' }

  it('keeps the free-form guide, composition and reference photos', () => {
    const id = '20000000-0000-4000-8000-000000000001'
    const result = normalizeWorkspaceImageStyleInput({
      ...base, guide: '  항상 정면 45도, 제품은 화면 오른쪽 1/3에 둬요  ', composition: '정면 클로즈업', references: [id, id, 'bad'],
    })
    expect(result).toEqual({
      ok: true,
      style: expect.objectContaining({
        guide: '항상 정면 45도, 제품은 화면 오른쪽 1/3에 둬요', composition: '정면 클로즈업', referenceAssetIds: [id],
      }),
    })
  })

  it('accepts a style that only has a guide and rejects more than 5 references or an over-long guide', () => {
    expect(normalizeWorkspaceImageStyleInput({ ...base, guide: '무조건 밝게' }).ok).toBe(true)
    const ids = Array.from({ length: 9 }, (_, i) => `20000000-0000-4000-8000-00000000000${i}`)
    expect(normalizeWorkspaceImageStyleInput({ ...base, subject: 'x', references: ids }).ok).toBe(false)
    expect(normalizeWorkspaceImageStyleInput({ ...base, guide: '가'.repeat(2001) }).ok).toBe(false)
  })

  it('keeps reference notes only for kept references and lists them in the directive', () => {
    const a = '20000000-0000-4000-8000-000000000001'
    const b = '20000000-0000-4000-8000-000000000002'
    const result = normalizeWorkspaceImageStyleInput({
      ...base, subject: 'x', references: [a, b], referenceNotes: { [a]: '여성 정면 상반신', [b]: '남성 정면', '20000000-0000-4000-8000-000000000003': '버려짐' },
    })
    expect(result.ok && result.style.referenceNotes).toEqual({ [a]: '여성 정면 상반신', [b]: '남성 정면' })
    const lines = composeStyleDirectiveLines((result as { ok: true; style: Parameters<typeof composeStyleDirectiveLines>[0] }).style).join('\n')
    expect(lines).toContain('Reference photo 1: 여성 정면 상반신')
    expect(lines).toContain('Reference photo 2: 남성 정면')
  })

  it('old saved styles without the new fields still load, and the directive includes guide and references', () => {
    const picked = pickWorkspaceImageStyle([{ rule_key: 'custom-image-style-v1', structured_rule: { custom: { subject: '네일', people: 'hands', avoid: [] } } }])
    expect(picked).toMatchObject({ guide: '', composition: '', referenceAssetIds: [], referenceNotes: {} })
    const lines = composeStyleDirectiveLines({
      subject: '', mood: '', setting: '', lookAndColor: '', people: 'any', avoid: [], extra: '',
      guide: '제품은 오른쪽 1/3', composition: '정면 클로즈업', referenceAssetIds: ['20000000-0000-4000-8000-000000000001'], referenceNotes: {},
    }).join('\n')
    expect(lines).toContain('제품은 오른쪽 1/3')
    expect(lines).toContain('정면 클로즈업')
    expect(lines).toContain('reference photos')
  })
})
