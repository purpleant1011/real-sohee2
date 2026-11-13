import { describe, expect, it } from 'vitest'
import {
  parseFirstPostReturnPath,
  safeFirstPostReturnPath,
} from './first-post-return-path'

describe('safeFirstPostReturnPath (W12 13 tests 통합 규격)', () => {
  const origin = 'https://example.com'
  const validUuid = '123e4567-e89b-12d3-a456-426614174000'

  it('유효한 same-origin 상대경로 및 쿼리를 올바르게 정규화한다', () => {
    const result = safeFirstPostReturnPath(
      `/app/work/new?post=${validUuid}&step=preview`,
      origin,
    )
    expect(result).toBe(`/app/work/new?post=${validUuid}&step=preview`)
  })

  it('/start/preview-r2 경로도 allowlist로 허용한다', () => {
    const result = safeFirstPostReturnPath(
      `/start/preview-r2?post=${validUuid}&step=approval`,
      origin,
    )
    expect(result).toBe(`/start/preview-r2?post=${validUuid}&step=approval`)
  })

  it('same-origin 절대경로 URL도 허용한다', () => {
    const result = safeFirstPostReturnPath(
      `https://example.com/app/work/new?post=${validUuid}&step=approval`,
      origin,
    )
    expect(result).toBe(`/app/work/new?post=${validUuid}&step=approval`)
  })

  it('다른 host(외부 origin)는 거부한다 (null 반환)', () => {
    expect(
      safeFirstPostReturnPath(
        `https://attacker.com/app/work/new?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()

    expect(
      safeFirstPostReturnPath(
        `//attacker.com/app/work/new?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()
  })

  it('외부 scheme(javascript, data, ftp 등)은 거부한다', () => {
    expect(
      safeFirstPostReturnPath(
        `javascript:alert(1)?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()

    expect(
      safeFirstPostReturnPath(
        `data:text/html,test?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()
  })

  it('credentials(user/pass)가 포함된 URL은 거부한다', () => {
    expect(
      safeFirstPostReturnPath(
        `https://user:pass@example.com/app/work/new?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()
  })

  it('CRLF 및 backslash(\\), control character는 거부한다', () => {
    expect(
      safeFirstPostReturnPath(
        `/app/work/new\r\n?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()

    expect(
      safeFirstPostReturnPath(
        `/app/work/new\\evil?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()
  })

  it('경로 탈출(path traversal)로 allowlist를 벗어나는 경우 거부한다', () => {
    expect(
      safeFirstPostReturnPath(
        `/app/work/new/../../etc/passwd?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()

    expect(
      safeFirstPostReturnPath(
        `/app/dashboard?post=${validUuid}`,
        origin,
      ),
    ).toBeNull()
  })

  it('post 파라미터가 누락되었거나 유효하지 않은 UUID 형식이면 거부한다', () => {
    expect(
      safeFirstPostReturnPath(`/app/work/new?step=preview`, origin),
    ).toBeNull()

    expect(
      safeFirstPostReturnPath(
        `/app/work/new?post=invalid-uuid&step=preview`,
        origin,
      ),
    ).toBeNull()

    expect(
      safeFirstPostReturnPath(
        `/app/work/new?post=12345&step=preview`,
        origin,
      ),
    ).toBeNull()
  })

  it('post 파라미터가 2개 이상 중복 전달(반복 post)되면 거부한다', () => {
    const anotherUuid = '223e4567-e89b-12d3-a456-426614174001'
    expect(
      safeFirstPostReturnPath(
        `/app/work/new?post=${validUuid}&post=${anotherUuid}&step=preview`,
        origin,
      ),
    ).toBeNull()
  })

  it('step=approved 등 임의의 단계 승격 시도는 step=preview로 안전 정규화한다', () => {
    const result = safeFirstPostReturnPath(
      `/app/work/new?post=${validUuid}&step=approved`,
      origin,
    )
    expect(result).toBe(`/app/work/new?post=${validUuid}&step=preview`)
  })

  it('step이 누락되었거나 허용되지 않은 값이면 preview로 안전 정규화한다', () => {
    expect(
      safeFirstPostReturnPath(`/app/work/new?post=${validUuid}`, origin),
    ).toBe(`/app/work/new?post=${validUuid}&step=preview`)

    expect(
      safeFirstPostReturnPath(
        `/app/work/new?post=${validUuid}&step=draft`,
        origin,
      ),
    ).toBe(`/app/work/new?post=${validUuid}&step=preview`)

    expect(
      safeFirstPostReturnPath(
        `/app/work/new?post=${validUuid}&step=admin`,
        origin,
      ),
    ).toBe(`/app/work/new?post=${validUuid}&step=preview`)
  })

  it('body, assetURL, fingerprint, workspace, PII 등 민감 파라미터와 fragment(#)를 완전히 제거한다', () => {
    const dirtyUrl = `/app/work/new?post=${validUuid}&step=approval&body=secret&assetURL=https://s3.com/pic.jpg&fingerprint=sha256&workspace=ws_123&email=user@test.com&token=secret#section1`
    const result = safeFirstPostReturnPath(dirtyUrl, origin)

    expect(result).toBe(`/app/work/new?post=${validUuid}&step=approval`)
    expect(result).not.toContain('body')
    expect(result).not.toContain('assetURL')
    expect(result).not.toContain('fingerprint')
    expect(result).not.toContain('workspace')
    expect(result).not.toContain('email')
    expect(result).not.toContain('token')
    expect(result).not.toContain('section1')
  })
})

describe('safeFirstPostReturnPath (W7 PWA/복원 소비처 통합 규격)', () => {
  const validUuid = '11111111-2222-4333-8444-555555555555'

  it('유효한 missionId에 대해 안전한 기본 복귀 URL을 생성한다', () => {
    expect(safeFirstPostReturnPath({ missionId: validUuid })).toBe(
      `/app/missions/${validUuid}`,
    )
  })

  it('허용된 step(preview, approval)만 유지하고 approved/result 등 임의 승격은 preview로 정규화한다', () => {
    expect(safeFirstPostReturnPath({ missionId: validUuid, step: 'preview' })).toBe(
      `/app/missions/${validUuid}?step=preview`,
    )
    expect(safeFirstPostReturnPath({ missionId: validUuid, step: 'APPROVAL' })).toBe(
      `/app/missions/${validUuid}?step=approval`,
    )
    // 임의 단계 승격 차단: approved, result 등은 preview로 안전 정규화
    expect(safeFirstPostReturnPath({ missionId: validUuid, step: 'approved' })).toBe(
      `/app/missions/${validUuid}?step=preview`,
    )
    expect(safeFirstPostReturnPath({ missionId: validUuid, step: 'result' })).toBe(
      `/app/missions/${validUuid}?step=preview`,
    )
  })

  it('허용되지 않은 step이나 악의적 쿼리는 배제하고 기본 복귀 URL을 반환한다', () => {
    expect(safeFirstPostReturnPath({ missionId: validUuid, step: 'malicious' })).toBe(
      `/app/missions/${validUuid}`,
    )
    expect(
      safeFirstPostReturnPath({ missionId: validUuid, step: 'token=secret&step=preview' }),
    ).toBe(`/app/missions/${validUuid}`)
  })

  it('유효하지 않은 missionId는 기본 경로(/app)를 반환한다', () => {
    expect(safeFirstPostReturnPath({ missionId: 'not-a-uuid' })).toBe('/app')
    expect(safeFirstPostReturnPath({ missionId: '' })).toBe('/app')
  })
})

describe('parseFirstPostReturnPath (W7 복원 파서 규격)', () => {
  const validUuid = '11111111-2222-4333-8444-555555555555'

  it('유효한 첫 포스팅 복원 URL을 정상 파싱한다', () => {
    expect(parseFirstPostReturnPath(`/app/missions/${validUuid}`)).toBe(
      `/app/missions/${validUuid}`,
    )
    expect(parseFirstPostReturnPath(`/app/missions/${validUuid}?step=preview`)).toBe(
      `/app/missions/${validUuid}?step=preview`,
    )
  })

  it('외부 파라미터나 개인정보 쿼리를 탈색하고 허용 step만 남긴다', () => {
    expect(
      parseFirstPostReturnPath(`/app/missions/${validUuid}?token=xyz&step=preview&pii=user@email.com`),
    ).toBe(`/app/missions/${validUuid}?step=preview`)
  })

  it('step=approved 등 임의의 단계 승격 시도는 step=preview로 안전 정규화한다 (반례 차단 검증)', () => {
    expect(parseFirstPostReturnPath(`/app/missions/${validUuid}?step=approved`)).toBe(
      `/app/missions/${validUuid}?step=preview`,
    )
    expect(parseFirstPostReturnPath(`/app/missions/${validUuid}?step=result`)).toBe(
      `/app/missions/${validUuid}?step=preview`,
    )
  })

  it('step 파라미터 개수(0건/1건/2건 이상 중복)에 따라 form1과 동일하게 정규화한다 (중복 step 반례 차단)', () => {
    // 0건: step 파라미터 없이 깨끗한 경로 유지
    expect(parseFirstPostReturnPath(`/app/missions/${validUuid}`)).toBe(
      `/app/missions/${validUuid}`,
    )
    // 1건 정상 approval
    expect(parseFirstPostReturnPath(`/app/missions/${validUuid}?step=approval`)).toBe(
      `/app/missions/${validUuid}?step=approval`,
    )
    // 2건 이상 중복(?step=approval&step=x): 첫 값이 approval이어도 중복 파라미터는 preview로 안전 정규화
    expect(
      parseFirstPostReturnPath(`/app/missions/${validUuid}?step=approval&step=x`),
    ).toBe(`/app/missions/${validUuid}?step=preview`)
    // 2건 이상 동일 중복(?step=approval&step=approval): preview로 안전 정규화
    expect(
      parseFirstPostReturnPath(`/app/missions/${validUuid}?step=approval&step=approval`),
    ).toBe(`/app/missions/${validUuid}?step=preview`)
  })

  it('Open Redirect 및 악성 입력을 철저히 차단하고 /app으로 fail-closed 한다', () => {
    expect(parseFirstPostReturnPath(null)).toBe('/app')
    expect(parseFirstPostReturnPath(undefined)).toBe('/app')
    expect(parseFirstPostReturnPath('')).toBe('/app')
    expect(parseFirstPostReturnPath('https://evil.com/app/missions/' + validUuid)).toBe('/app')
    expect(parseFirstPostReturnPath('//evil.com/app/missions/' + validUuid)).toBe('/app')
    expect(parseFirstPostReturnPath('/\\evil.com')).toBe('/app')
    expect(parseFirstPostReturnPath(`/app/missions/invalid-id`)).toBe('/app')
    expect(parseFirstPostReturnPath(`/app/channels`)).toBe('/app')
  })
})
