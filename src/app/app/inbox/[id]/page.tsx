import { BookingInquiryEntry } from './booking-inquiry-entry'

/**
 * M14 예약 문의(`/app/inbox/:id`) — 셸 라우트 맵이 선언해 둔 경로를 실제 페이지로 만든다.
 * `:id` 는 예약 회수 케이스 id 이고, 조회는 기존 읽기 API 만 쓴다.
 */
export default async function BookingInquiryRoute({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params
  return <BookingInquiryEntry caseId={id} />
}
