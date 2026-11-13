import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

import { generateMetaAuthorizationUrl, verifyMetaOAuthState } from "./meta-oauth-broker"

describe("MetaOAuthBroker", () => {
  beforeEach(() => {
    process.env.ADMIN_REVIEW_SESSION_SECRET = "test-secret-key-32-chars-long-abc"
  })

  it("생성된 Meta Auth URL은 테넌트 정보와 HMAC 서명된 state를 포함한다", () => {
    const { authUrl, state } = generateMetaAuthorizationUrl({
      workspaceId: "ws-test-456",
      userId: "user-123",
      redirectUri: "https://example.com/api/channels/meta/callback",
    })

    expect(authUrl).toContain("https://www.facebook.com/v21.0/dialog/oauth")
    expect(authUrl).toContain("client_id=")
    expect(authUrl).toContain("scope=instagram_basic%2Cinstagram_content_publish")

    const verified = verifyMetaOAuthState(state)
    expect(verified).not.toBeNull()
    expect(verified?.workspaceId).toBe("ws-test-456")
    expect(verified?.userId).toBe("user-123")
  })

  it("위변조된 state는 서명 검증에 실패하여 null을 반환한다", () => {
    const { state } = generateMetaAuthorizationUrl({
      workspaceId: "ws-test-456",
      userId: "user-123",
    })

    const [payload] = state.split(".")
    const tampered = `${payload}.invalid_signature_123`

    expect(verifyMetaOAuthState(tampered)).toBeNull()
  })
})
