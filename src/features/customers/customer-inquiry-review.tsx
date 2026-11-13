import Link from 'next/link'

export function CustomerQueryScope() {
  return <p className="text-sm leading-relaxed text-muted-foreground">기간 필터 없이 이번에 조회된 인스타그램 DM 대화·예약 원장 기준이에요. 전체 고객 수·최근 주간 성과와 다를 수 있어요. 댓글·다른 채널 문의는 소통함에서 따로 확인해 주세요.</p>
}

export function CustomerInquiryReview({ threadId }: { threadId: string }) {
  return <div className="flex flex-col items-start gap-2">
    <Link href={`/app/engagement/${encodeURIComponent(`dm:${threadId}`)}`} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">문의·예약 조건 검토</Link>
    <p className="text-sm leading-relaxed text-muted-foreground">고객 수락·서비스·가격·가능 시간을 먼저 확인해요. 화면을 여는 것만으로 예약이 확정되지는 않아요.</p>
  </div>
}
