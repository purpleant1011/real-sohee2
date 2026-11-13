declare module './matcher.mjs' {
  export type ScanContext = 'ui' | 'copy'

  export interface Rule {
    id: string
    name: string
    description: string
    pattern: string
    flags?: string
    category: string
    severity?: 'error' | 'warn'
    scanContexts?: ScanContext[]
    excludePatterns?: string[]
    contextFilter?: {
      pathIncludes?: string[]
      orTextIncludes?: string[]
    }
  }

  export interface WarnRule {
    id: string
    name: string
    description: string
    assurancePattern: string
    hedgePattern?: string
    maxLength?: number
    skipElements?: string[]
  }

  export interface AllowlistEntry {
    file: string
    reason: string
    allowedRules?: string[]
  }

  export interface ViolationMatch {
    ruleId: string
    ruleName: string
    category: string
    severity: 'error' | 'warn'
    matched: string
    index: number
  }

  export function loadRules(customRulesPath?: string): Rule[]
  export function loadWarnRules(customRulesPath?: string): WarnRule[]
  export function loadAllowlist(customAllowlistPath?: string): AllowlistEntry[]
  export function ruleAppliesToContext(rule: Rule, context: ScanContext): boolean
  export function matchText(text: string, filePath: string, rules: Rule[], options?: { context?: ScanContext }): ViolationMatch[]
}

declare module './assurance.mjs' {
  import type { WarnRule } from './matcher.mjs'

  export interface AssuranceWarning {
    file: string
    line: number
    column: number
    ruleId: string
    ruleName: string
    severity: 'warn'
    matched: string
    context: string
    snippet: string
  }

  export function scanAssuranceWarnings(filePath: string, content: string, warnRules?: WarnRule[]): AssuranceWarning[]
}

declare module './scanner.mjs' {
  import type { Rule, AllowlistEntry } from './matcher.mjs'
  import type { AssuranceWarning } from './assurance.mjs'

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
}

declare module './index.mjs' {
  import type { FileViolation } from './scanner.mjs'
  import type { AssuranceWarning } from './assurance.mjs'

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
}
