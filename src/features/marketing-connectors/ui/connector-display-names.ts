import type { ConnectorId } from '../catalog'

export const CONNECTOR_DISPLAY_NAMES: Record<ConnectorId, string> = {
  gmail: '지메일',
  google_calendar: '구글 캘린더',
  apple_calendar: '애플 캘린더',
  apple_reminders: '애플 미리알림',
  google_docs: '구글 문서',
  google_sheets: '구글 스프레드시트',
  outlook_mail: '아웃룩 메일',
  threads: '스레드',
  instagram: '인스타그램',
  instagram_messages: '인스타그램 메시지',
  google_drive: '구글 드라이브',
}

export function getConnectorDisplayName(id: string, fallbackName?: string): string {
  if (id in CONNECTOR_DISPLAY_NAMES) {
    return CONNECTOR_DISPLAY_NAMES[id as ConnectorId]
  }
  return fallbackName || id
}
