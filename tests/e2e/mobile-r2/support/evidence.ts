import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

/**
 * 증거 디렉터리 규약: evidence/mobile-r2/<이슈ID>/<YYYYMMDD>/<project>__<name>.<ext>
 * 상세는 evidence/mobile-r2/README.md. 비밀값·개인정보·실토큰은 저장 금지.
 */
const ROOT = path.resolve(process.cwd(), 'evidence', 'mobile-r2')
const ISSUE_RE = /^ANI-\d{3,5}$/u

export function evidenceDir(issue: string, date = new Date()): string {
  if (!ISSUE_RE.test(issue)) throw new Error(`증거 이슈 ID 형식 오류: ${issue}`)
  const ymd = date.toISOString().slice(0, 10).replaceAll('-', '')
  const dir = path.join(ROOT, issue, ymd)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** EVIDENCE=1 일 때만 파일을 남긴다 (평소 CI 실행이 저장소를 더럽히지 않도록). */
export const evidenceEnabled = (): boolean => process.env.EVIDENCE === '1'

export async function saveScreenshot(page: Page, info: TestInfo, issue: string, name: string, opts: { fullPage?: boolean } = {}): Promise<string | null> {
  if (!evidenceEnabled()) return null
  const file = path.join(evidenceDir(issue), `${info.project.name}__${name}.png`)
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? true })
  return file
}

export function saveJson(info: TestInfo, issue: string, name: string, data: unknown): string | null {
  if (!evidenceEnabled()) return null
  const file = path.join(evidenceDir(issue), `${info.project.name}__${name}.json`)
  writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), project: info.project.name, ...((data as object) ?? {}) }, null, 2) + '\n')
  return file
}
