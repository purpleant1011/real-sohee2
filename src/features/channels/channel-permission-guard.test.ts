import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const mockSupabase = {
  from: vi.fn(),
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(() => mockSupabase),
}))

import { preflightActionExecution } from "./channel-permission-guard"

describe("preflightActionExecution (4-Layer Guard)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("Layer 1: ConsentReceipt가 없으면 NO_CONSENT로 차단한다", async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const decision = await preflightActionExecution({
      workspaceId: "ws-123",
      provider: "META_INSTAGRAM",
      capabilityKey: "INSTAGRAM_PUBLISH_FEED",
    })

    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reasonCode).toBe("NO_CONSENT")
    }
  })

  it("Layer 2: ChannelAuthorization이 없거나 CONNECTED가 아니면 차단한다", async () => {
    // 1st call for consent -> returns active consent
    // 2nd call for auth -> returns null
    let callCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === "consent_receipts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "consent-1", status: "ACTIVE" }, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })

    const decision = await preflightActionExecution({
      workspaceId: "ws-123",
      provider: "META_INSTAGRAM",
      capabilityKey: "INSTAGRAM_PUBLISH_FEED",
    })

    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reasonCode).toBe("CHANNEL_NOT_CONNECTED")
    }
  })

  it("Layer 4: CapabilityGrant가 ENABLED이면 실행을 허용(allowed: true)한다", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "consent_receipts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "consent-1", status: "ACTIVE" }, error: null }),
        }
      }
      if (table === "channel_authorizations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "auth-1", status: "CONNECTED", expires_at: null }, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: "cap-1", status: "ENABLED", expires_at: null }, error: null }),
      }
    })

    const decision = await preflightActionExecution({
      workspaceId: "ws-123",
      provider: "META_INSTAGRAM",
      capabilityKey: "INSTAGRAM_PUBLISH_FEED",
    })

    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.authorizationId).toBe("auth-1")
      expect(decision.consentReceiptId).toBe("consent-1")
    }
  })
})
