import { describe, it, expect, vi } from "vitest";
import { checkKillSwitchPreflight } from "@/lib/safety/kill-switch-guard";
import { calculateEffectiveCapability } from "@/lib/channels/capability-engine";
import { detectCostAnomaly, calculateFinOpsMargin } from "@/lib/admin/finops-ledger";

describe("V0.8.9 4차 수정 프로덕션 계약 복구 검증 테스트 (ANI-594 ~ ANI-612)", () => {
  describe("ANI-599: Kill Switch Fail-Closed Guard", () => {
    it("DB 쿼리 오류 발생 시 Fail-Open 하지 않고 Fail-Closed로 차단해야 한다", async () => {
      const mockSupabase: any = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Database connection timed out", code: "57014" }
            })
          })
        })
      };

      const result = await checkKillSwitchPreflight(mockSupabase, {
        workspaceId: "ws-123",
        channel: "INSTAGRAM"
      });

      expect(result.blocked).toBe(true);
      expect(result.scope).toBe("FAIL_CLOSED");
      expect(result.reason).toContain("보안 제어 시스템 조회 실패");
    });

    it("예외 throw 발생 시에도 Fail-Closed로 차단해야 한다", async () => {
      const mockSupabase: any = {
        from: vi.fn().mockImplementation(() => {
          throw new Error("Unexpected network abort");
        })
      };

      const result = await checkKillSwitchPreflight(mockSupabase, {
        workspaceId: "ws-123",
        channel: "THREADS"
      });

      expect(result.blocked).toBe(true);
      expect(result.scope).toBe("FAIL_CLOSED");
      expect(result.reason).toContain("보안 제어 시스템 예외 발생");
    });
  });

  describe("ANI-605: Effective Capability Engine DB 정본화", () => {
    it("CAPABILITY_PENDING 상태 채널(DAANGN)은 canPublish: false, CAPABILITY_PENDING 상태를 반환해야 한다", async () => {
      const mockSupabase: any = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "kill_switches") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            };
          }
          if (table === "channel_capabilities") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        channel: "DAANGN",
                        action_type: "BIZ_PROFILE_POST",
                        status: "CAPABILITY_PENDING",
                        description: "당근 자동화 검증 준비 중"
                      },
                      error: null
                    })
                  })
                })
              })
            };
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
                })
              })
            })
          };
        })
      };

      const result = await calculateEffectiveCapability(mockSupabase, "ws-test", "DAANGN");
      expect(result.canPublish).toBe(false);
      expect(result.status).toBe("CAPABILITY_PENDING");
      expect(result.catalogStatus).toBe("CAPABILITY_PENDING");
      expect(result.lastVerifiedAt).toBeUndefined(); // 가짜 날짜 생성 금지 검증
    });

    it("검증 시각이 없는 채널에 대해 임의의 현재 시각을 지어내지 않고 undefined를 반환해야 한다", async () => {
      const mockSupabase: any = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "kill_switches") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null })
              })
            };
          }
          if (table === "channel_capabilities") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { channel: "INSTAGRAM", action_type: "PUBLISH_FEED", status: "SUPPORTED" },
                      error: null
                    })
                  })
                })
              })
            };
          }
          if (table === "channel_connections") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { channel: "INSTAGRAM", status: "connected", updated_at: null },
                      error: null
                    })
                  })
                })
              })
            };
          }
          return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
        })
      };

      const result = await calculateEffectiveCapability(mockSupabase, "ws-test", "INSTAGRAM");
      expect(result.canPublish).toBe(true);
      expect(result.status).toBe("AVAILABLE");
      expect(result.lastVerifiedAt).toBeUndefined(); // 임의 현재시각 생성 방지 검증
    });
  });

  describe("ANI-607: FinOps Anomaly & Margin Engine", () => {
    it("24시간 COGS가 임계치 200% 초과 시 CRITICAL 이상 징후를 감지해야 한다", () => {
      const anomaly = detectCostAnomaly(120.0, 50.0);
      expect(anomaly.isAnomaly).toBe(true);
      expect(anomaly.severity).toBe("CRITICAL");
      expect(anomaly.reason).toContain("200%를 초과");
    });

    it("정상 범위 내의 비용은 이상 징후 없음으로 판정해야 한다", () => {
      const normal = detectCostAnomaly(25.0, 50.0);
      expect(normal.isAnomaly).toBe(false);
      expect(normal.severity).toBe("NONE");
    });

    it("마진 계산 시 매출 0 이하일 경우 0% 마진을 안전하게 반환해야 한다", () => {
      expect(calculateFinOpsMargin(1000, 0)).toBe(0);
      expect(calculateFinOpsMargin(300, 1000)).toBe(70);
    });
  });
});
