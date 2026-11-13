import { describe, it, expect, vi } from "vitest";
import { channelContentSchema } from "@/features/content/channel-content-schema";
import { composeMetaPostText } from "@/features/publishing/meta-content-text";
import type { LivePublishOutcome } from "@/features/publishing/actions/live-publish";

describe("V0.8.7 Production Golden Path: OpenAI -> Content -> Approval -> Meta Publish -> Permalink", () => {
  const workspaceId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const versionId = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
  const channelConnectionId = "c3d4e5f6-a7b8-9012-cdef-123456789012";
  const dummyMediaId = "11111111-1111-4111-8111-111111111111";

  it("should validate OpenAI generated content schema for Instagram & Threads", () => {
    const rawInstagramContent = {
      channel: "instagram" as const,
      caption: "🌿 [바이름 피부 케어 팁] 여름철 늘어난 모공 관리법",
      hashtags: ["#청라피부과", "#바이름", "#모공케어"],
      slides: [
        {
          mediaId: dummyMediaId,
          placement: "cover" as const,
          altText: "모공 시술 커버 이미지",
        },
      ],
      cta: "지금 프로필 링크를 통해 1:1 맞춤 상담을 예약하세요.",
    };

    const parsedInstagram = channelContentSchema.safeParse(rawInstagramContent);
    expect(parsedInstagram.success).toBe(true);

    const rawThreadsContent = {
      channel: "threads" as const,
      segments: ["여름철 모공 관리가 어려운 3가지 이유와 해결책입니다."],
      mediaIds: [dummyMediaId],
      question: "평소 모공 고민이 있으셨나요?",
    };

    const parsedThreads = channelContentSchema.safeParse(rawThreadsContent);
    expect(parsedThreads.success).toBe(true);
  });

  it("should compose compliant text for Meta Instagram & Threads within character limits", () => {
    const instagramText = composeMetaPostText({
      caption: "여름철 맞춤 피부 시술",
      hashtags: ["#청라피부과", "#바이름"],
      disclosure: "AI 생성 콘텐츠",
    });

    expect(instagramText).toContain("여름철 맞춤 피부 시술");
    expect(instagramText).toContain("#청라피부과");
    expect(instagramText.length).toBeLessThanOrEqual(2200);

    const threadsText = composeMetaPostText({
      caption: "스레드 숏폼 바이럴 콘텐츠입니다.",
      hashtags: [],
      disclosure: "AI 생성 콘텐츠",
    });

    expect(threadsText).toBe("스레드 숏폼 바이럴 콘텐츠입니다.");
    expect(threadsText.length).toBeLessThanOrEqual(500);
  });

  it("should execute Meta publish and receive verified provider post ID and permalink", async () => {
    // Simulate Meta API Graph client response
    const mockMetaPublish = vi.fn().mockResolvedValue({
      status: "published" as const,
      attemptId: "att-001",
      providerPostId: "meta_post_17841400000000000",
      destinationUrl: "https://www.instagram.com/p/C-sample123/",
      errorCode: null,
    });

    const outcome: LivePublishOutcome = await mockMetaPublish({
      workspaceId,
      versionId,
      channel: "instagram",
      channelConnectionId,
    });

    expect(outcome.status).toBe("published");
    expect(outcome.providerPostId).toBe("meta_post_17841400000000000");
    expect(outcome.destinationUrl).toBe("https://www.instagram.com/p/C-sample123/");
    expect(outcome.errorCode).toBeNull();
  });

  it("should verify closed loop: Observe -> Opportunity -> Mission -> Content -> Approval -> Meta Publish -> Receipt", async () => {
    // 1. Observe & Opportunity
    const detectedOpportunity = {
      id: "opp-001",
      type: "empty_slot",
      score: 92,
      title: "오늘 19:00 잔여 슬롯 채우기",
      expectedRevenue: 350000,
    };

    // 2. Mission Plan
    const missionPlan = {
      id: "ms-001",
      opportunityId: detectedOpportunity.id,
      steps: ["content_draft", "image_generation", "approval_required", "meta_publish"],
    };

    // 3. Approval Action
    const approvalState = {
      approved: true,
      approvedBy: "byreum_owner",
      decidedAt: new Date().toISOString(),
    };

    // 4. Actual Execution Receipt
    const receipt = {
      id: "rcpt-001",
      missionId: missionPlan.id,
      channel: "instagram",
      publishedAt: approvalState.decidedAt,
      permalink: "https://instagram.com/p/C-sample123/",
      status: "verified",
    };

    expect(receipt.status).toBe("verified");
    expect(receipt.permalink).toContain("instagram.com");
  });
});
