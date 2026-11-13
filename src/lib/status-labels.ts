const statusLabels: Record<string, string> = {
  draft: '초안 준비',
  review: '승인 대기',
  in_review: '승인 대기',
  approved: '승인 완료',
  scheduled: '게시 준비',
  published: '게시 완료',
  archived: '보관됨',
}

export function toKoreanStatus(status: string) {
  return statusLabels[status] ?? '상태 확인 필요'
}
