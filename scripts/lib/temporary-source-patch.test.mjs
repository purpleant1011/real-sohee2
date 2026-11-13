import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TemporaryPatchSession,
  withTemporaryPatches,
  patchNextServerContent,
} from './temporary-source-patch.mjs'
import { run } from '../cloudflare-build.mjs'

describe('temporary-source-patch library', () => {
  async function createFixtureDir() {
    return await mkdtemp(join(tmpdir(), 'sohee-temp-patch-test-'))
  }

  it('정상 실행 시 원본 exact bytes로 복원된다', async () => {
    const dir = await createFixtureDir()
    try {
      const filePath = join(dir, 'test-target.js')
      const originalBytes = Buffer.from('const version = "1.0.0";\nconsole.log("hello world");\r\n', 'utf8')
      await writeFile(filePath, originalBytes)

      const session = new TemporaryPatchSession()
      const applied = await session.patch(filePath, (content) => {
        return content.replace('1.0.0', '2.0.0-patched')
      })
      expect(applied).toBe(true)

      const patchedContent = await readFile(filePath, 'utf8')
      expect(patchedContent).toContain('2.0.0-patched')

      await session.restore()

      const restoredBytes = await readFile(filePath)
      expect(Buffer.compare(originalBytes, restoredBytes)).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('두 번째 패치 적용 자체가 실패해도 첫 번째 파일은 원복된다', async () => {
    const dir = await createFixtureDir()
    try {
      const first = join(dir, 'first.js')
      const second = join(dir, 'second.js')
      await writeFile(first, 'first original')
      await writeFile(second, 'second original')
      const action = vi.fn()
      await expect(withTemporaryPatches([
        { filePath: first, transform: () => 'first patched' },
        { filePath: second, transform: () => { throw new Error('patch failed') } },
      ], action)).rejects.toThrow('patch failed')
      expect(await readFile(first, 'utf8')).toBe('first original')
      expect(await readFile(second, 'utf8')).toBe('second original')
      expect(action).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throw 예외 발생 시에도 withTemporaryPatches finally에서 복원된다', async () => {
    const dir = await createFixtureDir()
    try {
      const filePath = join(dir, 'throw-test.js')
      const originalBytes = Buffer.from('console.log("preserve-this-byte-sequence");\n', 'utf8')
      await writeFile(filePath, originalBytes)

      let caughtError = null
      try {
        await withTemporaryPatches(
          [{
            filePath,
            transform: (content) => content.replace('preserve', 'corrupt')
          }],
          async () => {
            const inProgress = await readFile(filePath, 'utf8')
            expect(inProgress).toContain('corrupt')
            throw new Error('Simulation of build failure')
          }
        )
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeInstanceOf(Error)
      expect(caughtError.message).toBe('Simulation of build failure')

      const restoredBytes = await readFile(filePath)
      expect(Buffer.compare(originalBytes, restoredBytes)).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('원본 byte 정확성: BOM 및 특수 바이트 시퀀스가 1바이트 오차 없이 복원된다', async () => {
    const dir = await createFixtureDir()
    try {
      const filePath = join(dir, 'bytes-test.bin')
      // UTF-8 BOM + 멀티바이트 한글 + 제어문자 + CRLF
      const originalBytes = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('export default function 안녕() { return "특수문자 🌟 🚀"; }\r\n\t// end\n', 'utf8')
      ])
      await writeFile(filePath, originalBytes)

      const session = new TemporaryPatchSession()
      await session.patch(filePath, (text) => text.replace('안녕', 'hello'))

      await session.restore()

      const restoredBytes = await readFile(filePath)
      expect(Buffer.compare(originalBytes, restoredBytes)).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('존재하지 않는 파일은 에러 없이 안전하게 skip된다', async () => {
    const dir = await createFixtureDir()
    try {
      const nonExistentPath = join(dir, 'does-not-exist.js')
      const session = new TemporaryPatchSession()

      const applied = await session.patch(nonExistentPath, (text) => text + '\npatched')
      expect(applied).toBe(false)

      await expect(session.restore()).resolves.not.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('중첩 safe: 동일 파일에 다중/중첩 패치 적용 시 최초 원본 bytes가 보존된다', async () => {
    const dir = await createFixtureDir()
    try {
      const filePath = join(dir, 'nested.js')
      const initialBytes = Buffer.from('const initial = true;\n', 'utf8')
      await writeFile(filePath, initialBytes)

      const session = new TemporaryPatchSession()
      // 1차 패치
      await session.patch(filePath, (text) => text.replace('true', 'false'))
      // 2차 패치 (중첩 호출)
      await session.patch(filePath, (text) => text.replace('false', 'null'))

      const intermediate = await readFile(filePath, 'utf8')
      expect(intermediate).toContain('null')

      // 복구 시 최초 initialBytes로 돌아와야 함
      await session.restore()

      const restoredBytes = await readFile(filePath)
      expect(Buffer.compare(initialBytes, restoredBytes)).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('원복 실패 삼키지 않기: restore 실패 시 에러를 throw한다', async () => {
    const dir = await createFixtureDir()
    try {
      const filePath = join(dir, 'readonly-file.js')
      const originalBytes = Buffer.from('original content', 'utf8')
      await writeFile(filePath, originalBytes)

      const session = new TemporaryPatchSession()
      await session.patch(filePath, () => 'modified content')

      // 파일 권한을 읽기 전용으로 만들어 writeFile 복구 실패 유도
      await chmod(filePath, 0o444)

      let restoreError = null
      try {
        await session.restore()
      } catch (err) {
        restoreError = err
      } finally {
        // cleanup을 위해 권한 복구
        await chmod(filePath, 0o666).catch(() => {})
      }

      // 실패를 삼키지 않고 throw했는지 검증
      expect(restoreError).not.toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('파일 원본 로그 출력 금지: 콘솔에 파일 내용이 노출되지 않는다', async () => {
    const dir = await createFixtureDir()
    try {
      const filePath = join(dir, 'secret-source.js')
      const secretKeyword = 'SUPER_SECRET_PAYLOAD_ABC_123'
      await writeFile(filePath, `const secret = "${secretKeyword}";\n`)

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await withTemporaryPatches(
          [{
            filePath,
            transform: (text) => text.replace(secretKeyword, 'REPLACED')
          }],
          async () => {
            // no-op
          }
        )

        const allLogs = [
          ...logSpy.mock.calls,
          ...infoSpy.mock.calls,
          ...warnSpy.mock.calls,
          ...errorSpy.mock.calls,
        ].flat().join(' ')

        expect(allLogs).not.toContain(secretKeyword)
      } finally {
        logSpy.mockRestore()
        infoSpy.mockRestore()
        warnSpy.mockRestore()
        errorSpy.mockRestore()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('patchNextServerContent는 getMiddlewareManifest와 patchLoadCustomCacheHandlers를 멱등하게 적용한다', () => {
    const inputCode = `
class NextNodeServer {
  getMiddlewareManifest() {
    if (this.minimalMode) {
      return null;
    } else {
      const manifest = require(this.middlewareManifestPath);
      return manifest;
    }
  }
  async loadCustomCacheHandlers() {
    const x = await import('./handler.js');
    return x;
  }
  const manifest = require(this.middlewareManifestPath);
  const manifest = (0, _loadmanifest.loadManifest)(this.middlewareManifestPath);
  const { cacheHandler } = this.nextConfig;
}
`
    const patchedOnce = patchNextServerContent(inputCode)
    expect(patchedOnce).toContain('getMiddlewareManifest() { return null; }')
    expect(patchedOnce).toContain('const manifest = null;')
    expect(patchedOnce).toContain('const cacheHandler = null;')
    expect(patchedOnce).toContain('async loadCustomCacheHandlers(){return;}')

    // 멱등성 검증: 다시 적용해도 결과가 동일
    const patchedTwice = patchNextServerContent(patchedOnce)
    expect(patchedTwice).toBe(patchedOnce)
  })
})

describe('cloudflare-build run function contract', () => {
  it('run 함수 실패 시 process.exit로 즉시 탈출하지 않고 nonzero status를 가진 에러를 throw한다', () => {
    // mock spawnSync to simulate non-zero exit
    const fakeSpawnSync = vi.fn().mockReturnValue({ status: 42 })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit should not have been called!')
    })

    try {
      expect(() => {
        run('some-command', ['arg1'], process.env, { spawnSync: fakeSpawnSync })
      }).toThrow()

      expect(exitSpy).not.toHaveBeenCalled()

      try {
        run('some-command', ['arg1'], process.env, { spawnSync: fakeSpawnSync })
      } catch (err) {
        expect(err.status).toBe(42)
        expect(err.exitCode).toBe(42)
      }
    } finally {
      exitSpy.mockRestore()
    }
  })
})
