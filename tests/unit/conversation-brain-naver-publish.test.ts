import { describe, it, expect } from 'vitest';
import { DRAFT_HONESTY_INSTRUCTION } from '@/lib/ai/conversation-brain';

describe('DRAFT_HONESTY_INSTRUCTION & Naver Publish Guidance Truth', () => {
  it('네이버 블로그 실발행 지원을 정직하게 안내하고 구형 미리보기 전용 문구를 포함하지 않는다', () => {
    // 1. 구형 잘못된 제약 문구 배제
    expect(DRAFT_HONESTY_INSTRUCTION).not.toContain('네이버 블로그·당근은 미리보기까지만');
    expect(DRAFT_HONESTY_INSTRUCTION).not.toContain('네이버 블로그는 미리보기까지만');

    // 2. 최신 규칙: 인스타그램, 스레드, 네이버 블로그는 실발행 가능, 당근은 미리보기 지원
    expect(DRAFT_HONESTY_INSTRUCTION).toContain('네이버 블로그');
    expect(DRAFT_HONESTY_INSTRUCTION).toContain('당근은 미리보기');
  });
});
