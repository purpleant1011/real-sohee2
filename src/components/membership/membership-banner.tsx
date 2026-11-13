import React from 'react';
import Link from 'next/link';
import { ArrowRight, Clock, Sparkles } from 'lucide-react';

export type UserMembershipTier = 'TRIAL' | 'PENDING_REVIEW' | 'FORMAL' | 'REJECTED';

interface MembershipBannerProps {
  tier: UserMembershipTier;
}

export function MembershipBanner({ tier }: MembershipBannerProps) {
  // 정식회원이면 배너를 표시하지 않음
  if (tier === 'FORMAL') {
    return null;
  }

  if (tier === 'PENDING_REVIEW') {
    return (
      <aside
        role="status"
        aria-live="polite"
        className="w-full border-b border-state-warn/20 bg-state-warn/10 px-4 py-2.5 text-xs text-foreground transition-colors"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-state-warn" aria-hidden="true" />
            <span className="font-medium">
              사업자 인증 심사 중이에요. 승인되면 혜택이 추가 지급되고 모든 기능을 이용하실 수 있어요.
            </span>
          </div>
        </div>
      </aside>
    );
  }

  // TRIAL 및 그 외 (미제출, 반려 등)
  return (
    <aside
      role="status"
      aria-live="polite"
      className="w-full border-b border-primary/20 bg-primary/10 px-4 py-2.5 text-xs text-foreground transition-colors"
    >
      <div className="mx-auto flex flex-wrap items-center justify-between gap-2.5 max-w-7xl">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="font-medium">
            Instagram·Threads 중 1곳 이상 연결하면 첫 포스팅을 무료로 체험해 보세요. 사업자 인증 승인 시 혜택이 추가 지급돼요.
          </span>
        </div>
        <Link
          href="/start"
          className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span>사업자 정보 등록하기</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
