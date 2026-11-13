import { describe, expect, it } from 'vitest'
import { CONNECTOR_DISPLAY_NAMES, getConnectorDisplayName } from './connector-display-names'

describe('connector-display-names', () => {
  it('자영업자 친화적 한국어 명칭으로 매핑된다', () => {
    expect(CONNECTOR_DISPLAY_NAMES.gmail).toBe('지메일')
    expect(CONNECTOR_DISPLAY_NAMES.google_calendar).toBe('구글 캘린더')
    expect(CONNECTOR_DISPLAY_NAMES.apple_calendar).toBe('애플 캘린더')
    expect(CONNECTOR_DISPLAY_NAMES.google_docs).toBe('구글 문서')
    expect(CONNECTOR_DISPLAY_NAMES.google_sheets).toBe('구글 스프레드시트')
    expect(CONNECTOR_DISPLAY_NAMES.outlook_mail).toBe('아웃룩 메일')
    expect(CONNECTOR_DISPLAY_NAMES.google_drive).toBe('구글 드라이브')
    expect(CONNECTOR_DISPLAY_NAMES.threads).toBe('스레드')
    expect(CONNECTOR_DISPLAY_NAMES.instagram).toBe('인스타그램')
    expect(CONNECTOR_DISPLAY_NAMES.instagram_messages).toBe('인스타그램 메시지')
  })

  it('getConnectorDisplayName 헬퍼는 매핑된 ID에 대해 친화적 한국어 명칭을 반환한다', () => {
    expect(getConnectorDisplayName('gmail', 'Gmail')).toBe('지메일')
    expect(getConnectorDisplayName('google_calendar', 'Google Calendar')).toBe('구글 캘린더')
    expect(getConnectorDisplayName('unknown_id', '기타 도구')).toBe('기타 도구')
  })
})
