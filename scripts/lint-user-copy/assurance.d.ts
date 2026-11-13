import type { WarnRule } from './matcher'

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
