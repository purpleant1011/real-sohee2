import {
  PublishingExceptionItem,
  CanonicalPublicationSchedule,
  PublishingChannel,
} from './types';

export class PublishingExceptionQueue {
  private exceptions: Map<string, PublishingExceptionItem> = new Map();

  /**
   * 실패 작업 격리 큐 등록 (ANI-873)
   */
  quarantine(params: {
    job: CanonicalPublicationSchedule;
    errorCategory: PublishingExceptionItem['errorCategory'];
    errorMessage: string;
  }): PublishingExceptionItem {
    const { job, errorCategory, errorMessage } = params;

    const exceptionId = `pex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const item: PublishingExceptionItem = {
      exceptionId,
      jobId: job.jobId,
      calendarEventId: job.calendarEventId,
      workspaceId: job.workspaceId,
      channel: job.channel,
      errorCategory,
      errorMessage,
      failedAt: now,
      quarantinedAt: now,
      resolutionStatus: 'UNRESOLVED',
    };

    this.exceptions.set(exceptionId, item);
    return item;
  }

  /**
   * 미해결 예외 목록 조회
   */
  listUnresolved(workspaceId?: string): PublishingExceptionItem[] {
    return Array.from(this.exceptions.values()).filter((item) => {
      if (workspaceId && item.workspaceId !== workspaceId) return false;
      return item.resolutionStatus === 'UNRESOLVED';
    });
  }

  /**
   * 관리자 조치 1: 재시도 승인
   */
  resolveRetry(exceptionId: string, adminUserId: string): PublishingExceptionItem {
    const item = this.exceptions.get(exceptionId);
    if (!item) {
      throw new Error(`Exception not found: ${exceptionId}`);
    }

    item.resolutionStatus = 'RESOLVED_RETRY';
    item.resolvedBy = adminUserId;
    item.resolvedAt = new Date().toISOString();
    return item;
  }

  /**
   * 관리자 조치 2: 영구 취소
   */
  resolveCancel(exceptionId: string, adminUserId: string): PublishingExceptionItem {
    const item = this.exceptions.get(exceptionId);
    if (!item) {
      throw new Error(`Exception not found: ${exceptionId}`);
    }

    item.resolutionStatus = 'RESOLVED_CANCELLED';
    item.resolvedBy = adminUserId;
    item.resolvedAt = new Date().toISOString();
    return item;
  }

  /**
   * 관리자 조치 3: 환불 조치
   */
  resolveRefund(exceptionId: string, adminUserId: string): PublishingExceptionItem {
    const item = this.exceptions.get(exceptionId);
    if (!item) {
      throw new Error(`Exception not found: ${exceptionId}`);
    }

    item.resolutionStatus = 'REFUNDED';
    item.resolvedBy = adminUserId;
    item.resolvedAt = new Date().toISOString();
    return item;
  }

  getException(exceptionId: string): PublishingExceptionItem | undefined {
    return this.exceptions.get(exceptionId);
  }
}
