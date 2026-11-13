import { describe, expect, it } from 'vitest'
import { parseConversationPostRequest } from './conversation-post-intent'

describe('parseConversationPostRequest', () => {
  it('turns a generic posting-plan request into the approved three channel-complete candidates', () => {
    const result = parseConversationPostRequest('이번 주 포스팅 기획해줘')

    expect(result).toMatchObject({ prompt: '이번 주 포스팅 기획해줘' })
    expect(result?.candidates.map(({ channel, count, direction }) => ({ channel, count, direction }))).toEqual([
      { channel: 'instagram', count: 3, direction: 'result' },
      { channel: 'threads', count: 1, direction: 'trust' },
      { channel: 'instagram', count: 2, direction: 'question' },
    ])
  })

  it('keeps an explicit Threads request on Threads while offering two finished directions', () => {
    const result = parseConversationPostRequest('스레드 게시물을 두 가지 방향으로 써 줘')

    expect(result?.candidates).toHaveLength(2)
    expect(result?.candidates.every((candidate) => candidate.channel === 'threads')).toBe(true)
  })

  it.each([
    ['스레드에 포스팅을 하고 싶어', 'threads'],
    ['스레드에 포스팅 진행해줘', 'threads'],
    ['인스타에 포스팅하고 싶어', 'instagram'],
    ['인스타에 올리고 싶어', 'instagram'],
    ['네이버 블로그에 포스팅하고 싶어', 'naver_blog'],
  ] as const)('%s 제작 의사를 %s 포스팅 요청으로 인식한다', (prompt, channel) => {
    const result = parseConversationPostRequest(prompt)

    expect(result?.prompt).toBe(prompt)
    expect(result?.candidates.length).toBeGreaterThan(0)
    expect(result?.candidates.every((candidate) => candidate.channel === channel)).toBe(true)
  })

  it('creates two Instagram and two Threads candidates when both channels request two posts', () => {
    const result = parseConversationPostRequest('인스타와 스레드를 각각 2개씩 게시물로 만들어줘')

    expect(result?.candidates.map(({ channel, count, direction }) => ({ channel, count, direction }))).toEqual([
      { channel: 'instagram', count: 3, direction: 'result' },
      { channel: 'instagram', count: 2, direction: 'question' },
      { channel: 'threads', count: 1, direction: 'trust' },
      { channel: 'threads', count: 1, direction: 'question' },
    ])
  })

  it('creates one fitted candidate per channel when both channels are requested without a post count', () => {
    const result = parseConversationPostRequest('인스타와 스레드에 이미지 2장으로 게시물을 만들어줘')

    expect(result?.candidates.map(({ channel, count, direction }) => ({ channel, count, direction }))).toEqual([
      { channel: 'instagram', count: 2, direction: 'result' },
      { channel: 'threads', count: 1, direction: 'trust' },
    ])
  })

  it('keeps a Naver Blog post request with an image on one Naver Blog candidate', () => {
    const result = parseConversationPostRequest(
      '네이버 블로그 게시물 1건을 제목과 본문, 이미지 1장으로 만들어줘.',
    )

    expect(result?.candidates).toEqual([
      expect.objectContaining({ channel: 'naver_blog', count: 1, direction: 'trust' }),
    ])
  })

  it('defaults a simple Naver Blog request to seven generated images', () => {
    const result = parseConversationPostRequest('네이버 블로그 게시물을 만들어줘.')

    expect(result?.candidates).toEqual([
      expect.objectContaining({ channel: 'naver_blog', count: 7, direction: 'trust' }),
    ])
  })

  it('does not intercept analysis, negation, or a direct image-only request', () => {
    expect(parseConversationPostRequest('지난 게시물 성과를 분석해줘')).toBeNull()
    expect(parseConversationPostRequest('포스팅은 만들지 말고 일정만 정리해줘')).toBeNull()
    expect(parseConversationPostRequest('인스타 이미지 한 장 만들어줘')).toBeNull()
  })

  it('인스타그램과 네이버 블로그가 함께 요청되어도 인스타그램을 누락하지 않고 두 채널 후보를 모두 생성한다', () => {
    const prompt = '인스타그램, 네이버 블로그에 올릴 이벤트 포스팅을 만들어줘. 만들기 전에 필요한 것을 먼저 질문해줘.'
    const result = parseConversationPostRequest(prompt)

    expect(result).not.toBeNull()
    expect(result?.purpose).toBe('event')
    expect(result?.candidates.map((c) => c.channel)).toEqual(['instagram', 'naver_blog'])
    expect(result?.candidates).toEqual([
      expect.objectContaining({ channel: 'instagram', direction: 'result' }),
      expect.objectContaining({ channel: 'naver_blog', direction: 'trust' }),
    ])
  })

  it('4개 채널(인스타, 스레드, 네이버 블로그, 당근) 조합을 안정된 순서로 수집하고 목적을 파싱한다', () => {
    const prompt = '인스타, 스레드, 네이버 블로그, 당근에 올릴 프로모션 포스팅을 작성해줘'
    const result = parseConversationPostRequest(prompt)

    expect(result).not.toBeNull()
    expect(result?.purpose).toBe('promotion')
    expect(result?.candidates.map((c) => c.channel)).toEqual([
      'instagram',
      'threads',
      'naver_blog',
      'daangn_business',
    ])
  })

  it.each([
    ['일상 포스팅을 만들어줘', 'daily'],
    ['브랜드 홍보 포스팅 써 줘', 'branding'],
    ['여름 이벤트 포스팅 준비해줘', 'event'],
    ['특별 프로모션 게시물 작성해줘', 'promotion'],
  ] as const)('%s 에서 목적 %s을 파싱한다', (prompt, expectedPurpose) => {
    const result = parseConversationPostRequest(prompt)
    expect(result?.purpose).toBe(expectedPurpose)
  })
})

describe('당근 오탐 방지 (리뷰 반영)', () => {
  it('"당근 케이크 신메뉴 기획해줘" 같은 일반 문장은 포스팅 요청이 아니다', () => {
    expect(parseConversationPostRequest('당근 케이크 신메뉴 기획해줘')).toBeNull()
    expect(parseConversationPostRequest('당근 주스 메뉴 만들어줘')).toBeNull()
  })
  it('당근마켓·당근 비즈프로필·"당근에 올릴"은 당근 채널로 읽는다', () => {
    expect(parseConversationPostRequest('당근에 올릴 포스팅 만들어줘')?.candidates.some(c => c.channel === 'daangn_business')).toBe(true)
    expect(parseConversationPostRequest('당근마켓 소식 포스팅 작성해줘')?.candidates.some(c => c.channel === 'daangn_business')).toBe(true)
  })
})

describe('채널 부정(negation) 파싱', () => {
  it('"인스타 말고 스레드에만 올려줘" 요청 시 스레드만 후보로 생성한다', () => {
    const result = parseConversationPostRequest('인스타 말고 스레드에만 올려줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.length).toBeGreaterThan(0)
    expect(result?.candidates.every(c => c.channel === 'threads')).toBe(true)
  })

  it('"스레드 말고 인스타" 요청 시 인스타그램만 후보로 생성한다', () => {
    const result = parseConversationPostRequest('스레드 말고 인스타')
    expect(result).not.toBeNull()
    expect(result?.candidates.length).toBeGreaterThan(0)
    expect(result?.candidates.every(c => c.channel === 'instagram')).toBe(true)
  })

  it('"네이버 블로그는 빼고 인스타만" 요청 시 인스타그램만 후보로 생성한다', () => {
    const result = parseConversationPostRequest('네이버 블로그는 빼고 인스타만')
    expect(result).not.toBeNull()
    expect(result?.candidates.length).toBeGreaterThan(0)
    expect(result?.candidates.every(c => c.channel === 'instagram')).toBe(true)
  })

  it('"당근은 제외"처럼 긍정 채널이 남지 않으면 기본 동작(3개 후보)을 유지한다', () => {
    const result = parseConversationPostRequest('당근은 제외')
    expect(result).not.toBeNull()
    expect(result?.candidates.map(c => c.channel)).toEqual(['instagram', 'threads', 'instagram'])
  })

  it('"스레드는 빼"처럼 긍정 채널이 없으면 기본 동작을 유지한다', () => {
    const result = parseConversationPostRequest('스레드는 빼')
    expect(result).not.toBeNull()
    expect(result?.candidates.map(c => c.channel)).toEqual(['instagram', 'threads', 'instagram'])
  })

  it('회귀 검증: "인스타와 스레드에 올려줘"는 두 채널 모두 포함한다', () => {
    const result = parseConversationPostRequest('인스타와 스레드에 올려줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.map(c => c.channel)).toEqual(['instagram', 'threads'])
  })

  it('"네이버 블로그는 제외하고 인스타만 올려줘" 요청 시 인스타그램만 후보로 생성한다', () => {
    const result = parseConversationPostRequest('네이버 블로그는 제외하고 인스타만 올려줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.every(c => c.channel === 'instagram')).toBe(true)
  })

  it('"인스타 없이 스레드로 써 줘" 요청 시 스레드만 후보로 생성한다', () => {
    const result = parseConversationPostRequest('인스타 없이 스레드로 써 줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.every(c => c.channel === 'threads')).toBe(true)
  })

  it('"인스타 아니고 스레드에 작성해줘" 요청 시 스레드만 후보로 생성한다', () => {
    const result = parseConversationPostRequest('인스타 아니고 스레드에 작성해줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.every(c => c.channel === 'threads')).toBe(true)
  })

  it('다중 채널 제외 후 남은 단일 채널을 정확하게 선택한다', () => {
    const result = parseConversationPostRequest('인스타 말고 스레드도 빼고 네이버 블로그에 포스팅 써줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.every(c => c.channel === 'naver_blog')).toBe(true)
  })

  it('모든 언급 채널이 제외되면 기본 동작(3개 후보)으로 복귀한다', () => {
    const result = parseConversationPostRequest('인스타는 빼고 스레드는 빼줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.map(c => c.channel)).toEqual(['instagram', 'threads', 'instagram'])
  })

  it('부정된 채널과 긍정된 당근 채널 조합을 정상 처리한다', () => {
    const result = parseConversationPostRequest('인스타는 빼고 당근마켓에 올릴 포스팅 만들어줘')
    expect(result).not.toBeNull()
    expect(result?.candidates.every(c => c.channel === 'daangn_business')).toBe(true)
  })

  it('구조화된 인터뷰 답변 JSON 내부에 게시물/작성 키워드가 있어도 신규 포스팅 요청으로 오판하지 않는다', () => {
    const interviewPayload = JSON.stringify({
      image: { value: 'warm_brand', source: 'option' },
      callToAction: {
        value: 'custom',
        source: 'free_text',
        customText: '행동 유도 없음. 본문은 …테스트 게시물입니다. 한 문장만, 해시태그·링크·추가 소개 없이 작성해 주세요.',
      },
      imagePreferences: { templateId: 'warm_brand', extraDirection: '비인물 1장' },
    })

    expect(parseConversationPostRequest(interviewPayload)).toBeNull()

    // 반면 일반 자연어 새 요청은 정상 파싱 유지
    const naturalPrompt = '인스타그램에 새 포스팅 만들어줘'
    expect(parseConversationPostRequest(naturalPrompt)).not.toBeNull()
  })

  it('brace-framed malformed JSON with image/callToAction+작성문구 returns null and does not promote to new post request', () => {
    const malformedJson = '{"image":{"value":"warm_brand"},"callToAction":{"customText":"게시물 작성해 주세요"... malformed brace-framed'
    expect(parseConversationPostRequest(malformedJson)).toBeNull()

    // 정상 plain 새 요청 해석 기능은 유지
    expect(parseConversationPostRequest('인스타그램에 포스팅 작성해 주세요')).not.toBeNull()
  })
})

