import type { JobKey } from './types'

export interface JobCopy {
  /** 소희가 이 일을 하면 무엇을 해주는지 1~2문장 */
  summary: string
  /** 사장님께 어떻게 확인받는지 */
  approval: string
}

export const JOB_COPY: Record<JobKey, JobCopy> = {
  post_social: {
    summary: '가게 소식과 상품을 인스타그램·스레드 글로 만들어 올려요',
    approval: '올리기 전에 사장님이 확인해야 해요',
  },
  reply_comments: {
    summary: '인스타그램과 스레드에 달린 고객 댓글에 정성껏 답변을 달아요',
    approval: '답변을 달기 전에 사장님이 확인해야 해요',
  },
  write_blog: {
    summary: '가게 소개와 전문 지식을 담은 네이버 블로그 글을 작성해요',
    approval: '블로그에 올리기 전에 사장님이 직접 확인해요',
  },
  write_daangn: {
    summary: '동네 이웃에게 가게 소식과 할인 혜택을 알리는 당근 글을 작성해요',
    approval: '동네에 알리기 전에 사장님이 직접 확인해요',
  },
  booking_guide: {
    summary: '예약 방법과 예약금 입금 안내를 고객에게 친절하게 전달해요',
    approval: '예약 안내를 보내기 전에 사장님이 확인해야 해요',
  },
  kakao_1on1: {
    summary: '카카오톡 채널로 들어온 1:1 고객 문의를 실시간으로 상담해요',
    approval: '메시지를 보내기 전에 사장님이 확인해야 해요',
  },
}
