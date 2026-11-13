import { SafeActionService, ActionExecutionRecord } from "./safe-action-service";

export type SupportedPublishChannel = "instagram" | "threads" | "naver_blog";

export interface PublishRequest {
  workspaceId: string;
  channel: SupportedPublishChannel;
  contentId: string;
  title?: string;
  text: string;
  imageUrls: string[];
  tags?: string[];
  scheduledAt?: string;
  isTestMode?: boolean;
}

export interface PublishResult {
  success: boolean;
  executionId: string;
  channel: SupportedPublishChannel;
  externalPostId?: string;
  permalink?: string;
  publishedAt?: string;
  error?: {
    code: string;
    message: string;
    needsReauth?: boolean;
    needsUserAction?: boolean;
  };
}

export class PublishingService {
  /**
   * Dispatches a publish command through the SafeAction layer
   */
  static async publishContent(request: PublishRequest): Promise<PublishResult> {
    const revision = `${request.contentId}_${Date.now().toString(36)}`;
    const execution = SafeActionService.registerExecution(
      request.workspaceId,
      `publish_${request.channel}`,
      request.channel,
      revision,
      "approved"
    );

    // 1. Preflight validation
    const preflight = SafeActionService.validatePreflight({
      workspaceId: request.workspaceId,
      actionType: `publish_${request.channel}`,
      channel: request.channel,
      contentRevision: revision,
      killSwitchActive: false, // In production, read from server policy
    });

    if (!preflight.allowed) {
      SafeActionService.transitionStatus(
        execution.idempotencyKey,
        preflight.statusIfBlocked || "blocked_by_policy",
        { errorMessage: preflight.reason }
      );
      return {
        success: false,
        executionId: execution.id,
        channel: request.channel,
        error: {
          code: "POLICY_BLOCKED",
          message: preflight.reason || "정책에 의해 차단되었습니다.",
        },
      };
    }

    // 2. Transition to executing
    SafeActionService.transitionStatus(execution.idempotencyKey, "executing");

    try {
      // 3. Channel-specific provider execution
      if (request.channel === "instagram") {
        return await this.executeInstagramPublish(request, execution);
      } else if (request.channel === "threads") {
        return await this.executeThreadsPublish(request, execution);
      } else if (request.channel === "naver_blog") {
        return await this.executeNaverBlogPublish(request, execution);
      }

      throw new Error(`지원되지 않는 채널입니다: ${request.channel}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "게시 중 오류가 발생했습니다.";
      SafeActionService.transitionStatus(execution.idempotencyKey, "failed", {
        errorMessage,
        errorCode: "PROVIDER_ERROR",
      });

      return {
        success: false,
        executionId: execution.id,
        channel: request.channel,
        error: {
          code: "PROVIDER_ERROR",
          message: errorMessage,
        },
      };
    }
  }

  private static async executeInstagramPublish(
    request: PublishRequest,
    execution: ActionExecutionRecord
  ): Promise<PublishResult> {
    if (!request.isTestMode) {
      SafeActionService.transitionStatus(execution.idempotencyKey, "blocked_by_policy", {
        errorMessage: "Production direct publishing via legacy service is disabled. Use Canonical Instant Publishing API.",
      });
      return {
        success: false,
        executionId: execution.id,
        channel: "instagram",
        error: {
          code: "LEGACY_PUBLISH_DISABLED",
          message: "운영 환경에서는 정규 즉시 발행 API를 통해서만 게시할 수 있습니다.",
        },
      };
    }

    const externalPostId = `ig_post_${Date.now()}`;
    const permalink = `https://www.instagram.com/p/${Math.random().toString(36).slice(2, 11)}/`;
    const publishedAt = new Date().toISOString();

    SafeActionService.transitionStatus(execution.idempotencyKey, "succeeded", {
      externalPostId,
      externalUrl: permalink,
      providerRequestId: `req_meta_${Date.now()}`,
    });

    return {
      success: true,
      executionId: execution.id,
      channel: "instagram",
      externalPostId,
      permalink,
      publishedAt,
    };
  }

  private static async executeThreadsPublish(
    request: PublishRequest,
    execution: ActionExecutionRecord
  ): Promise<PublishResult> {
    if (!request.isTestMode) {
      SafeActionService.transitionStatus(execution.idempotencyKey, "blocked_by_policy", {
        errorMessage: "Production direct publishing via legacy service is disabled. Use Canonical Instant Publishing API.",
      });
      return {
        success: false,
        executionId: execution.id,
        channel: "threads",
        error: {
          code: "LEGACY_PUBLISH_DISABLED",
          message: "운영 환경에서는 정규 즉시 발행 API를 통해서만 게시할 수 있습니다.",
        },
      };
    }

    const externalPostId = `th_post_${Date.now()}`;
    const permalink = `https://www.threads.net/@byreum_cheongna/post/${Math.random().toString(36).slice(2, 11)}`;
    const publishedAt = new Date().toISOString();

    SafeActionService.transitionStatus(execution.idempotencyKey, "succeeded", {
      externalPostId,
      externalUrl: permalink,
      providerRequestId: `req_threads_${Date.now()}`,
    });

    return {
      success: true,
      executionId: execution.id,
      channel: "threads",
      externalPostId,
      permalink,
      publishedAt,
    };
  }

  private static async executeNaverBlogPublish(
    request: PublishRequest,
    execution: ActionExecutionRecord
  ): Promise<PublishResult> {
    if (!request.isTestMode) {
      SafeActionService.transitionStatus(execution.idempotencyKey, "blocked_by_policy", {
        errorMessage: "Production direct publishing via legacy service is disabled. Use Canonical Instant Publishing API.",
      });
      return {
        success: false,
        executionId: execution.id,
        channel: "naver_blog",
        error: {
          code: "LEGACY_PUBLISH_DISABLED",
          message: "운영 환경에서는 정규 즉시 발행 API를 통해서만 게시할 수 있습니다.",
        },
      };
    }

    const externalPostId = `nb_logNo_${Date.now()}`;
    const permalink = `https://blog.naver.com/byreum_cheongna/${Date.now()}`;
    const publishedAt = new Date().toISOString();

    SafeActionService.transitionStatus(execution.idempotencyKey, "succeeded", {
      externalPostId,
      externalUrl: permalink,
      providerRequestId: `req_naver_connector_${Date.now()}`,
    });

    return {
      success: true,
      executionId: execution.id,
      channel: "naver_blog",
      externalPostId,
      permalink,
      publishedAt,
    };
  }
}
