/** Owner-facing wording for policy gate reasons. Internal codes never reach the screen. */
const COPY: Record<string, { message: string; alternative: string }> = {
  MIN_PRICE: { message: '정해 두신 최저 가격보다 낮은 제안이라 막았어요.', alternative: '최저 가격 이상으로 가격을 다시 골라 주세요.' },
  DISCOUNT_LIMIT: { message: '정해 두신 최대 할인율을 넘는 제안이라 막았어요.', alternative: '할인율을 낮추거나 할인 없는 안내로 바꿔 주세요.' },
  DISCOUNT_CASE_LIMIT: { message: '이번 기간에 허용한 할인 횟수를 모두 사용했거나 예약해 두었어요.', alternative: '할인 없는 결과물 소개나 서비스 안내를 권해요.' },
  INVALID_DISCOUNT_CASES: { message: '할인 금액과 횟수가 맞지 않아 막았어요.', alternative: '제안 내용을 다시 만들어 주세요.' },
  CHANNEL_NOT_ALLOWED: { message: '이 서비스에 허용하지 않은 채널이라 막았어요.', alternative: '허용한 채널로 바꾸거나 채널 설정을 먼저 확인해 주세요.' },
  ACTION_BUDGET: { message: '한 번에 쓸 수 있는 비용 한도를 넘어서 막았어요.', alternative: '비용이 들지 않는 방식으로 바꿔 보세요.' },
  PERIOD_BUDGET: { message: '이번 기간 비용 한도를 넘어서 막았어요.', alternative: '비용 없는 공개 안내로 바꾸거나 한도를 먼저 조정해 주세요.' },
  CONSENT_REQUIRED: { message: '수신 동의가 확인되지 않은 고객이 있어 막았어요.', alternative: '공개 게시로 바꾸거나 동의가 확인된 고객만 남겨 주세요.' },
  NO_TARGETS: { message: '보낼 수 있는 고객이 없어 막았어요.', alternative: '공개 게시 안내로 바꾸거나 사장님이 직접 확인해 주세요.' },
  PURPOSE_MISMATCH: { message: '게시 방식과 채널이 맞지 않아 막았어요.', alternative: '채널과 목적을 다시 골라 주세요.' },
  STALE_EVIDENCE: { message: '가격·정책·비용 자료의 확인 시각이 오래되어 다시 확인이 필요해요.', alternative: '자료를 새로 확인한 뒤 다시 제안할게요.' },
  PRICE_FACT_MISMATCH: { message: '확인된 서비스 가격과 제안 가격이 맞지 않아 막았어요.', alternative: '서비스 가격을 먼저 확인해 주세요.' },
  SCOPE_OR_VERSION_MISMATCH: { message: '다른 정책 버전의 자료가 섞여 있어 막았어요.', alternative: '현재 정책으로 제안을 다시 만들게요.' },
  INVALID_INPUT: { message: '제안을 확인할 자료가 부족해 막았어요.', alternative: '자료를 확인한 뒤 다시 제안할게요.' },
  OWNER_APPROVAL_REQUIRED: { message: '사장님 확인이 필요해요.', alternative: '내용·비용·대상을 확인하고 승인해 주세요.' },
  APPROVAL_CHANGED_OR_EXPIRED: { message: '승인 이후 내용이 바뀌었거나 승인 기간이 지나 다시 확인이 필요해요.', alternative: '바뀐 내용을 확인하고 다시 승인해 주세요.' },
  ATOMIC_RESERVATION_REQUIRED: { message: '승인되었어요. 한도를 확보하는 중이에요.', alternative: '' },
}
const FALLBACK = { message: '제안을 확인하지 못해 멈췄어요.', alternative: '자료를 확인한 뒤 다시 시도해 주세요.' }
export function ownerPolicyCopy(reason: string): { message: string; alternative: string } {
  return COPY[reason] ?? FALLBACK
}
