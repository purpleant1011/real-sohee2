import {
  CanonicalPublicationSchedule,
  PublishingChannel,
  PublishingJobStatus,
} from './types';

export class CanonicalPublishingScheduleManager {
  private schedulesByJobId: Map<string, CanonicalPublicationSchedule> = new Map();
  private schedulesByCalendarEventId: Map<string, string> = new Map(); // calendarEventId -> jobId

  /**
   * 신규 정본 발행 일정 등록 (ANI-828, ANI-872)
   * calendarEventId와 jobId의 1:1 양방향 정본 인덱싱
   */
  registerSchedule(params: {
    calendarEventId: string;
    jobId: string;
    workspaceId: string;
    assetId: string;
    channel: PublishingChannel;
    title: string;
    scheduledAt: string;
    status?: PublishingJobStatus;
  }): CanonicalPublicationSchedule {
    const {
      calendarEventId,
      jobId,
      workspaceId,
      assetId,
      channel,
      title,
      scheduledAt,
      status = 'SCHEDULED',
    } = params;

    // 이미 등록된 calendarEventId나 jobId가 있는지 확인
    if (this.schedulesByCalendarEventId.has(calendarEventId)) {
      throw new Error(`Calendar event ${calendarEventId} is already linked to a job.`);
    }

    const schedule: CanonicalPublicationSchedule = {
      calendarEventId,
      jobId,
      workspaceId,
      assetId,
      channel,
      title,
      scheduledAt,
      status,
      retryCount: 0,
      maxRetries: 3,
      updatedAt: new Date().toISOString(),
    };

    this.schedulesByJobId.set(jobId, schedule);
    this.schedulesByCalendarEventId.set(calendarEventId, jobId);

    return schedule;
  }

  /**
   * Job ID로 정본 조회 (Admin 및 Worker 큐 공용)
   */
  getByJobId(jobId: string): CanonicalPublicationSchedule | undefined {
    return this.schedulesByJobId.get(jobId);
  }

  /**
   * Calendar Event ID로 정본 조회 (사용자 캘린더 뷰 공용)
   */
  getByCalendarEventId(calendarEventId: string): CanonicalPublicationSchedule | undefined {
    const jobId = this.schedulesByCalendarEventId.get(calendarEventId);
    if (!jobId) return undefined;
    return this.schedulesByJobId.get(jobId);
  }

  /**
   * 상태 전이 (ANI-872 Same Truth 보장)
   * 큐나 워커에서 상태가 변경되면 사용자 캘린더 뷰에서도 실시간 동일 반영
   */
  updateStatus(params: {
    jobId: string;
    status: PublishingJobStatus;
    statusDetail?: string;
    publishedUrl?: string;
    externalPostId?: string;
    errorMessage?: string;
    incrementRetry?: boolean;
  }): CanonicalPublicationSchedule {
    const {
      jobId,
      status,
      statusDetail,
      publishedUrl,
      externalPostId,
      errorMessage,
      incrementRetry = false,
    } = params;

    const existing = this.schedulesByJobId.get(jobId);
    if (!existing) {
      throw new Error(`Publishing job not found: ${jobId}`);
    }

    const updated: CanonicalPublicationSchedule = {
      ...existing,
      status,
      statusDetail: statusDetail ?? existing.statusDetail,
      publishedUrl: publishedUrl ?? existing.publishedUrl,
      externalPostId: externalPostId ?? existing.externalPostId,
      errorMessage: errorMessage ?? existing.errorMessage,
      retryCount: incrementRetry ? existing.retryCount + 1 : existing.retryCount,
      updatedAt: new Date().toISOString(),
    };

    this.schedulesByJobId.set(jobId, updated);
    return updated;
  }

  /**
   * 워크스페이스의 전체 큐 목록 조회
   */
  listJobs(workspaceId: string, statusFilter?: PublishingJobStatus): CanonicalPublicationSchedule[] {
    return Array.from(this.schedulesByJobId.values()).filter((s) => {
      if (s.workspaceId !== workspaceId) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      return true;
    });
  }
}
