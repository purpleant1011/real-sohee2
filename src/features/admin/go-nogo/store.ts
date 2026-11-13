import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CHECKLIST } from './checklist'
import type { RecordRead } from './evaluate'

export const RUNS_DIR = 'evidence/runs'

/**
 * 실행 결과 저장소(evidence/runs/<id>.json)만 읽는다. 다른 출처 값은 쓰지 않는다.
 * ENOENT = 기록 없음(MISSING), 그 밖의 읽기/파싱 실패 = ERROR(확인 불가).
 */
export async function readAllRecords(root: string = process.cwd()): Promise<Record<string, RecordRead>> {
  const out: Record<string, RecordRead> = {}
  for (const item of CHECKLIST) {
    const file = path.join(root, RUNS_DIR, `${item.id}.json`)
    try {
      const record = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
      let logExists = false
      const logPath = (record as { logPath?: unknown } | null)?.logPath
      if (typeof logPath === 'string' && !path.isAbsolute(logPath) && !logPath.includes('..')) {
        try {
          await fs.access(path.join(root, logPath))
          logExists = true
        } catch {
          logExists = false
        }
      }
      out[item.id] = { kind: 'RECORD', record, logExists }
    } catch (error) {
      out[item.id] = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'MISSING' } : { kind: 'ERROR' }
    }
  }
  return out
}
