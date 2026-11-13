export type NotificationKind = 'approval' | 'schedule' | 'publish' | 'system'
export type NotificationTarget = { ok: true; href: string } | { ok: false; reason: 'other_workspace' | 'unsafe_link' | 'no_link' }

/** 알림 이동 전 검증: 현재 매장 + /app 내부 경로만. */
export function resolveNotificationTarget(n: { workspaceId: string; href: string | null }, currentWorkspaceId: string): NotificationTarget {
  if (n.workspaceId !== currentWorkspaceId) return { ok: false, reason: 'other_workspace' }
  if (!n.href) return { ok: false, reason: 'no_link' }
  const safe = (n.href === '/app' || n.href.startsWith('/app/')) && !n.href.startsWith('//') &&
    !n.href.includes('\\') && !n.href.split('?')[0].split('/').includes('..')
  return safe ? { ok: true, href: n.href } : { ok: false, reason: 'unsafe_link' }
}

const masked: Partial<Record<NotificationKind, string>> = { approval: '확인할 답변이 있어요', schedule: '예약 관련 소식이 있어요' }
/** 고객 문맥이 섞일 수 있는 종류는 목록·잠금화면에서 본문 대신 일반 문구. */
export function previewText(kind: NotificationKind, sanitizedBody: string): string {
  return masked[kind] ?? sanitizedBody
}
