export type ScanContext = 'ui' | 'copy'

export interface Rule {
  id: string
  name: string
  description: string
  pattern: string
  flags?: string
  category: string
  /** 'warn' 규칙은 실패 조건이 아니라 경고로만 보고된다 (기본 'error') */
  severity?: 'error' | 'warn'
  /** 규칙이 동작하는 스캔 컨텍스트 (기본 ['ui']). 'copy'는 일반 위치의 한글 문구 안 영문 상태어 */
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
