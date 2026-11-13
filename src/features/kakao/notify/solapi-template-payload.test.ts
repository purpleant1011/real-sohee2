import { describe, expect, it } from 'vitest'
import {
  ALIMTALK_TEMPLATE_LIST,
  ALIMTALK_TEMPLATES,
  type AlimtalkTemplate,
} from './templates'
import {
  buildSolapiTemplateCreateBody,
  DEFAULT_CATEGORY_CODE,
  type SolapiTemplateCreateBody,
} from './solapi-template-payload'
import { containsAdvertisingContent } from './alimtalk-contract'

describe('buildSolapiTemplateCreateBody (KAPI-12 / SOLAPI Kakao Template Payload)', () => {
  const dummyChannelId = 'CH01TESTCHANNEL'

  describe('6종 템플릿 개별 생성 및 페이로드 정합성 검증', () => {
    it.each(ALIMTALK_TEMPLATE_LIST)(
      '$code ($name) 템플릿의 솔라피 등록 페이로드가 스펙과 일치한다',
      (template) => {
        const payload: SolapiTemplateCreateBody = buildSolapiTemplateCreateBody(template, {
          channelId: dummyChannelId,
        })

        // 1. 필수 기본 필드 검증
        expect(payload.channelId).toBe(dummyChannelId)
        expect(payload.name).toBe(template.name)
        expect(payload.messageType).toBe('BA')
        expect(payload.content).toBe(template.templateBody)
        expect(payload.categoryCode).toBe(DEFAULT_CATEGORY_CODE)

        // 2. 광고 문구 검출 차단 (정보통신망법 및 카카오 심사 기준)
        expect(containsAdvertisingContent(payload.content)).toBe(false)

        // 3. 1,000자 이내 준수
        expect(payload.content.length).toBeLessThanOrEqual(1000)

        // 4. 본문 변수 #{...} 추출 및 template.variables와의 정합성 일치
        const extractedVars = Array.from(payload.content.matchAll(/#\{([^}]+)\}/g)).map((m) => m[1])
        const uniqueExtractedVars = Array.from(new Set(extractedVars))
        expect(uniqueExtractedVars.sort()).toEqual([...template.variables].sort())

        // 5. 버튼 필드 매핑 검증 (WL, buttonName, linkMo, linkPc)
        if (template.buttons.length > 0) {
          expect(payload.buttons).toBeDefined()
          expect(payload.buttons).toHaveLength(template.buttons.length)

          for (let i = 0; i < template.buttons.length; i++) {
            const originalBtn = template.buttons[i]
            const mappedBtn = payload.buttons![i]

            expect(mappedBtn.buttonType).toBe(originalBtn.type)
            expect(mappedBtn.buttonName).toBe(originalBtn.name)
            expect(mappedBtn.linkMo).toBe(originalBtn.urlMobile)
            expect(mappedBtn.linkPc).toBe(originalBtn.urlPc)
          }
        } else {
          expect(payload.buttons).toBeUndefined()
        }

        // 6. 금지된 유니코드 이모지 부재 확인
        const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
        expect(emojiRegex.test(payload.content)).toBe(false)
      },
    )
  })

  it('categoryCode 옵션을 지정하면 기본값 대신 해당 categoryCode가 반영된다', () => {
    const template: AlimtalkTemplate = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED
    const customCategoryCode = '009001'

    const payload = buildSolapiTemplateCreateBody(template, {
      channelId: dummyChannelId,
      categoryCode: customCategoryCode,
    })

    expect(payload.categoryCode).toBe(customCategoryCode)
  })

  it('channelId가 누락되거나 빈 문자열인 경우 에러를 던진다', () => {
    const template: AlimtalkTemplate = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED

    expect(() => {
      buildSolapiTemplateCreateBody(template, { channelId: '' })
    }).toThrow(/channelId/)
    expect(() => {
      buildSolapiTemplateCreateBody(template, { channelId: '   ' })
    }).toThrow(/channelId/)
  })

  it('버튼이 없는 6종 템플릿의 페이로드에서 buttons 필드가 완전히 생략된다', () => {
    for (const template of ALIMTALK_TEMPLATE_LIST) {
      expect(template.buttons).toHaveLength(0)
      const payload = buildSolapiTemplateCreateBody(template, { channelId: dummyChannelId })
      expect(payload.buttons).toBeUndefined()
      expect('buttons' in payload).toBe(false)
    }
  })

  it('부가정보(extraInfo)가 정의된 템플릿(예: BOOKING_CHANGED)도 payload.content는 부가정보 제외 본문(templateBody)만 포함한다', () => {
    const changedTemplate = ALIMTALK_TEMPLATES.BOOKING_CHANGED
    const payload = buildSolapiTemplateCreateBody(changedTemplate, { channelId: dummyChannelId })
    expect(payload.content).toBe(changedTemplate.templateBody)
    expect(payload.content).not.toContain('부가정보')
  })
})
