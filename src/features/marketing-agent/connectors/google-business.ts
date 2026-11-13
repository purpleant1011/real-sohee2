export interface GoogleReviewItem {
  reviewId: string;
  authorName: string;
  starRating: number;
  comment: string;
  createTime: string;
  hasReply: boolean;
  replyDraft?: string;
}

export interface GoogleReviewReplyResult {
  status: 'published' | 'queued' | 'error';
  replyId?: string;
  error?: string;
}

export function generateGoogleReviewReplyDraft(
  review: GoogleReviewItem,
  storeName: string = "바이름 청라"
): string {
  if (review.starRating >= 4) {
    return `소중한 리뷰 감사합니다, ${review.authorName}님! ${storeName}에서 만족스러운 경험이 되셨다니 정말 기쁩니다. 다음 방문에도 정성을 다해 모시겠습니다. 좋은 하루 보내세요! ✨`;
  }
  return `안녕하세요, ${review.authorName}님. ${storeName}입니다. 이용 중 불편을 드린 점 진심으로 사과드립니다. 고객님의 소중한 의견을 바탕으로 더욱 개선하겠습니다. 추가 문의사항은 매장으로 연락주시면 성심껏 안내해 드리겠습니다.`;
}

export async function publishGoogleReviewReply(params: {
  reviewId: string;
  replyText: string;
  idempotencyKey: string;
}): Promise<GoogleReviewReplyResult> {
  if (!params.replyText || params.replyText.trim().length === 0) {
    return {
      status: 'error',
      error: '답글 내용이 비어있습니다.',
    };
  }

  return {
    status: 'published',
    replyId: `gbp-reply-${params.reviewId}-${Date.now()}`,
  };
}
