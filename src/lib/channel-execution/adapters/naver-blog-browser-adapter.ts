/**
 * Naver Blog Browser Adapter (ANI-770)
 * 
 * Based on SmartEditor ONE Browser Automation Pattern.
 * 
 * Invariants:
 * 1. Session cookie boundary strictly scoped per workspace/tenant.
 * 2. 3-stage lifecycle: DRAFT -> REVIEW -> PUBLISH.
 * 3. CAPTCHA, 2FA, or abnormal DOM anomalies trigger IMMEDIATE halt and OWNER_HANDOFF_REQUIRED.
 * 4. Destructive publish requires explicit confirmation flag.
 * 5. Authoritative readback verifies published blog post URL.
 */

import {
  ChannelExecutionResult
} from '../core/channel-execution-types';
import { ProviderCircuitBreakerRegistry } from '../core/provider-circuit-breaker';
import { NAVER_AUTOMATION_BLOCKED_MESSAGE } from '@/features/naver-publish/automation-policy';

export interface NaverBlogDraftPayload {
  workspaceId: string;
  blogId: string;
  title: string;
  contentHtml: string;
  categoryNo?: number;
  tags?: string[];
  sessionCookieToken: string;
  confirmPublish?: boolean;
}

export interface BrowserAutomationDriver {
  openSmartEditor(blogId: string, sessionCookie: string): Promise<{ editorReady: boolean; captchaDetected?: boolean; twoFactorRequired?: boolean }>;
  fillContent(title: string, contentHtml: string): Promise<{ filled: boolean; traceSnapshotId: string }>;
  saveDraft(): Promise<{ draftPostId: string }>;
  clickPublish(): Promise<{ publishedPostId: string; publicPostUrl: string }>;
  verifyPublishedPost(publicPostUrl: string): Promise<{ exists: boolean; titleMatch: boolean }>;
}

export class NaverBlogBrowserAdapter {
  private readonly providerName = 'naver_blog_browser';

  constructor(
    private readonly circuitBreaker: ProviderCircuitBreakerRegistry,
    private readonly driver: BrowserAutomationDriver
  ) {}

  public async publishBlogPost(_payload: NaverBlogDraftPayload): Promise<ChannelExecutionResult> {
    const executedAt = new Date().toISOString();

    // V1.2 ADR-01/02: 네이버 외부 자동 포스팅 정책 차단 (드라이버 0회, 서킷 브레이커 불변)
    return {
      success: false,
      channel: 'naver_blog',
      action: 'browser.naver_blog.publish',
      circuitState: 'CLOSED',
      executedAt,
      error: {
        code: 'POLICY_DISABLED',
        message: NAVER_AUTOMATION_BLOCKED_MESSAGE,
        retryable: false,
      },
    };
  }
}
