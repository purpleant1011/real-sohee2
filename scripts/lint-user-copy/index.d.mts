import type { FileViolation } from './scanner'
import type { AssuranceWarning } from './assurance'

export interface BaselineData {
  version: string
  generatedAt?: string
  totalViolations: number
  violations: FileViolation[]
}

export interface LintResult {
  success: boolean
  targetFilesCount?: number
  totalViolations: number
  newViolations: FileViolation[]
  baselineViolations: FileViolation[]
  /** 실패 조건이 아닌 경고 (영문 대문자 코드, 조건 없는 정상 확인 문구) */
  warnings?: Array<FileViolation | AssuranceWarning>
}

export function loadBaseline(customPath?: string): BaselineData
export function saveBaseline(violations: FileViolation[], customPath?: string): BaselineData
export function compareWithBaseline<T extends { file: string; ruleId: string; matched: string }>(
  currentViolations: T[],
  baselineViolations: T[]
): {
  baselineMatched: T[]
  newViolations: T[]
}
export function runLintUserCopy(options?: Record<string, any>): Promise<LintResult>
