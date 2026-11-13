import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { patchLoadCustomCacheHandlers } from './patch-cache-handlers.mjs'

/**
 * Next.js next-server.js의 Dynamic require 및 Cloudflare Workers 비호환 코드 패치
 * 멱등성 보존: 이미 패치된 코드에 다시 적용해도 동일한 결과가 유지됩니다.
 */
export function patchNextServerContent(code) {
  let content = code
  content = content.replace(
    /getMiddlewareManifest\(\)\s*\{[\s\S]*?return manifest;\s*\}\s*\}/g,
    'getMiddlewareManifest() { return null; }'
  )
  content = content.replace(
    /const manifest = require\(this\.middlewareManifestPath\);?/g,
    'const manifest = null;'
  )
  content = content.replace(
    /const manifest = \(0, _loadmanifest\.loadManifest\)\(this\.middlewareManifestPath\);?/g,
    'const manifest = null;'
  )
  content = content.replace(
    /const\s*\{\s*cacheHandler\s*\}\s*=\s*this\.nextConfig;?/g,
    'const cacheHandler = null;'
  )
  content = patchLoadCustomCacheHandlers(content)
  return content
}

/**
 * TemporaryPatchSession
 *
 * 빌드/배포 패치 동안 파일 원본 exact bytes(Buffer)를 메모리에 저장하고,
 * 작업 완료 또는 예외 발생 시 finally 블록에서 파일 상태를 정확히 원복합니다.
 *
 * [보안 및 무결성 원칙]
 * 1. Exact Bytes 보존: Buffer 그대로 저장하고 복원하여 줄바꿈(CRLF/LF) 및 인코딩 손상을 방지합니다.
 * 2. 원본 로그 출력 금지: 파일 본문이나 원본 바이트는 절대 로그로 노출하지 않습니다.
 * 3. 중첩 안전(Nested-safe): 동일 파일에 대해 여러 번 patch가 호출되더라도 최초 원본 바이트를 덮어쓰지 않습니다.
 * 4. 실패 삼키지 않기: restore 과정에서 발생하는 모든 fs 오류는 무시하지 않고 상위로 throw합니다.
 * 5. 미존재 파일 처리: 존재하지 않는 파일 경로는 안전하게 건너뜁니다.
 *
 * [한계 명시]
 * 본 모듈은 '세션 시작 시점'의 디스크 파일 바이트를 원본으로 캡처하여 복원합니다.
 * 따라서 본 모듈 도입 이전에 과거 빌드 실행으로 인해 이미 영구 변조된 파일
 * (예: node_modules/next 의 getMiddlewareManifest() 가 이미 return null 로 덮어씌워진 상태)은
 * 본 모듈이 과거의 클린 상태로 자동 역산하여 복구할 수 없습니다.
 * (이미 변조된 node_modules 는 npm clean install 또는 git checkout 등으로 원본 복원이 필요합니다.)
 */
export class TemporaryPatchSession {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.quiet=true] - 파일 내용이 아닌 진행 상태 요약만 출력
   */
  constructor(options = {}) {
    this.options = options
    /** @type {Map<string, Buffer>} */
    this.originals = new Map()
  }

  /**
   * 파일에 임시 패치를 적용하고 원본 exact bytes를 저장합니다.
   * @param {string} rawFilePath
   * @param {(currentContent: string) => string | Promise<string>} transform
   * @returns {Promise<boolean>} 패치 적용 여부 (파일이 없으면 false)
   */
  async patch(rawFilePath, transform) {
    const filePath = resolve(rawFilePath)
    if (!existsSync(filePath)) {
      return false
    }

    // 중첩 호출 시: 이미 최초 원본이 저장되어 있다면 최초 원본 버퍼를 유지합니다.
    if (!this.originals.has(filePath)) {
      const originalBytes = await readFile(filePath)
      this.originals.set(filePath, originalBytes)
    }

    const currentText = await readFile(filePath, 'utf8')
    const transformedText = await transform(currentText)
    await writeFile(filePath, transformedText, 'utf8')
    return true
  }

  /**
   * 여러 타깃에 대해 순차적으로 패치를 적용합니다.
   * @param {Array<{ filePath: string, transform: (current: string) => string | Promise<string> }>} targets
   */
  async patchAll(targets) {
    for (const target of targets) {
      await this.patch(target.filePath, target.transform)
    }
  }

  /**
   * 세션에서 변경된 모든 파일을 원본 exact bytes로 복원합니다.
   * 원복 실패 시 에러를 절대 삼키지 않고 throw합니다.
   */
  async restore() {
    if (this.originals.size === 0) {
      return
    }

    const errors = []
    // LIFO (역순) 복원
    const entries = Array.from(this.originals.entries()).reverse()

    for (const [filePath, originalBytes] of entries) {
      try {
        await writeFile(filePath, originalBytes)
        this.originals.delete(filePath)
      } catch (err) {
        errors.push(err)
      }
    }

    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0]
      }
      throw new AggregateError(errors, `Failed to restore ${errors.length} temporary source patches`)
    }
  }
}

/**
 * 고차 함수: action 실행 중 임시 패치를 유지하고,
 * 정상 리턴 또는 throw에 관계없이 finally에서 항상 원본을 복원합니다.
 */
export async function withTemporaryPatches(targets, action) {
  const session = new TemporaryPatchSession()
  try {
    await session.patchAll(targets)
    return await action(session)
  } finally {
    await session.restore()
  }
}
