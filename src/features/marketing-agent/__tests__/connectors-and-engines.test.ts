import { describe, it, expect } from "vitest";
import { filterRecontactSegment, generateKakaoFollowupDraft } from "../connectors/kakaotalk";
import { generateGoogleReviewReplyDraft } from "../connectors/google-business";
import { evaluateWithStrategyCouncil } from "../engine/strategy-council";
import { compileVideoVariants } from "../engine/video-content-engine";
import { createBusinessGoal } from "../engine/goal-engine";
import { detectOpportunities } from "../engine/opportunity-radar";

describe("소희 V0.8.7 커넥터 및 전략 평의회, 숏폼 엔진 테스트", () => {
  describe("[ANI-143] KakaoTalk Channel Connector", () => {
    it("마케팅 동의 및 쿨다운(7일)을 만족하는 고객만 선별한다", () => {
      const now = new Date("2026-08-30T12:00:00Z");
      const candidates = [
        { customerIdentifier: "c1", customerName: "김서연", lastVisitDate: "2026-08-20T00:00:00Z", marketingConsent: true, serviceCategory: "자연눈썹", cooldownSatisfied: true },
        { customerIdentifier: "c2", customerName: "이지은", lastVisitDate: "2026-08-28T00:00:00Z", marketingConsent: true, serviceCategory: "자연눈썹", cooldownSatisfied: false }, // 쿨다운 미달 (2일 전)
        { customerIdentifier: "c3", customerName: "박민영", lastVisitDate: "2026-08-10T00:00:00Z", marketingConsent: false, serviceCategory: "자연눈썹", cooldownSatisfied: true }, // 미동의
      ];


      const filtered = filterRecontactSegment(candidates, 7, now);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].customerIdentifier).toBe("c1");
    });

    it("개인화된 슬롯 안내 메시지 초안을 생성한다", () => {
      const draft = generateKakaoFollowupDraft("김서연", "목요일 14:00", "바이름 청라");
      expect(draft.templateId).toBe("tpl_slot_followup_v1");
      expect(draft.message).toContain("김서연님");
      expect(draft.message).toContain("목요일 14:00");
    });
  });

  describe("[ANI-143] Google Business Profile Review Connector", () => {
    it("별점 5점 리뷰에 대한 감사 답글 초안을 생성한다", () => {
      const draft = generateGoogleReviewReplyDraft({
        reviewId: "r-1",
        authorName: "이지은",
        starRating: 5,
        comment: "눈썹 모양이 너무 자연스럽고 원장님이 친절해요!",
        createTime: "2026-08-30T10:00:00Z",
        hasReply: false,
      });

      expect(draft).toContain("이지은님");
      expect(draft).toContain("만족스러운 경험");
    });
  });

  describe("[ANI-147] Marketing Strategy Council", () => {
    it("다중 관점(매출분석, 브랜드위험, 반대자) 검토 보고서를 생성한다", () => {
      const goal = createBusinessGoal({
        workspaceId: "fixture:TEST:marketing",
        title: "예약 10건 확보",
        type: "booking_count",
        period: "weekly",
        targetValue: 10,
        currentMeasuredValue: 8,
        unit: "건",
        startDate: "2026-08-25T00:00:00Z",
        endDate: "2026-09-01T20:00:00Z",
        rationale: "주간 목표",
      });

      const opps = detectOpportunities({
        workspaceId: "fixture:TEST:marketing",
        emptySlotsCount: 2,
        emptySlotTargetDay: "목요일",
        unbookedInquiriesCount: 4,
        recontactEligibleCount: 3,
        pendingReviewsCount: 1,
        disconnectedChannelsCount: 0,
        expiringChannelsCount: 1,
      });

      const report = evaluateWithStrategyCouncil(goal, opps[0]);
      expect(report.confidenceScore).toBe(92);
      expect(report.perspectives.length).toBe(3);
      expect(report.perspectives.find((p) => p.role === "devils_advocate")).toBeDefined();
    });
  });

  describe("[ANI-149] Video Content Foundation", () => {
    it("단일 영상 소재로부터 채널별(Reels, Shorts, TikTok) 최적 9:16 규격 메타데이터를 산출한다", () => {
      const variants = compileVideoVariants({
        rawVideoUrl: "https://example.com/raw.mp4",
        originalDurationSec: 45,
        hookText: "민낯 자신감 30초 눈썹 결 완성",
        mainCaption: "자연스러운 결을 살린 바이름 시그니처 브로우",
        callToAction: "프로필 링크에서 예약 가능 슬롯 확인",
        tags: ["#바이름청라", "#자연눈썹"],
      });

      expect(variants.instagram_reels).toBeDefined();
      expect(variants.instagram_reels.aspectRatio).toBe("9:16");
      expect(variants.instagram_reels.targetDurationSec).toBe(30); // 30초 cap
      expect(variants.youtube_shorts).toBeDefined();
      expect(variants.tiktok).toBeDefined();
    });
  });
});
