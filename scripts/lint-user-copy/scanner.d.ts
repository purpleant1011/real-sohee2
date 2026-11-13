import type { Rule, AllowlistEntry } from './matcher'
import type { AssuranceWarning } from './assurance'

export interface FileViolation {
  file: string
  line: number
  column: number
  ruleId: string
  ruleName: string
  category: string
  severity: 'error' | 'warn'
  matched: string
  context: string
  snippet: string
}

export function isUserFacingPath(filePath: string): boolean
export function scanSourceFile(filePath: string, content: string, rules: Rule[], allowlist?: AllowlistEntry[]): FileViolation[]
export function scanSourceFileWarnings(filePath: string, content: string): AssuranceWarning[]
export function collectTargetFiles(rootDir: string): string[]
