/**
 * 요청 스코프 키·지문 계산 (운영 모듈).
 *
 * 왜 `testing/` 밖에 있는가: 이 두 함수는 테스트 더블이 아니라 순수 결정론적 계산이다.
 * 운영 코드(`notice-schedule.ts`)가 지문을 계산해야 하는데, `testing/` 아래에 두면
 * "운영 코드는 테스트 모의를 값으로 import 할 수 없다"는 lint 가드에 걸린다.
 * 가드의 의도(런타임 의존 금지)를 지키려면 계산 함수는 운영 모듈에 있어야 한다.
 *
 * `Scope` 타입은 아직 `testing/minimal-admission` 에 정의되어 있어 타입으로만 가져온다
 * (컴파일 시 소거되므로 런타임 의존이 아니다).
 */

import { createHash } from 'node:crypto'
import type { Scope } from './testing/minimal-admission'

/** 스코프의 4-튜플을 안정적인 문자열로 만든다. */
export function scopeKey(scope: Scope): string {
  return JSON.stringify([scope.workspaceId, scope.provider, scope.action, scope.operationKey])
}

/**
 * 요청 지문. 길이 접두사를 붙여 튜플과 본문의 경계를 명확히 한다(모호성 없는 해시).
 * 같은 스코프·같은 본문이면 항상 같은 값이 나온다.
 */
export function computeRequestFingerprint(scope: Scope, payloadBytes: Uint8Array): string {
  const tupleJson = JSON.stringify([scope.workspaceId, scope.provider, scope.action, scope.operationKey])
  const tupleBytes = Buffer.from(tupleJson, 'utf8')
  const lenPrefix = Buffer.alloc(4)
  lenPrefix.writeUInt32BE(tupleBytes.length, 0)

  const hash = createHash('sha256')
  hash.update(lenPrefix)
  hash.update(tupleBytes)
  hash.update(payloadBytes)
  return `sha256:${hash.digest('hex')}`
}
