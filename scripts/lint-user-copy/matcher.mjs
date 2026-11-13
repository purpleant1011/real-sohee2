import fs from 'node:fs'
import path from 'node:path'

/**
 * 금칙어 규칙 로드
 */
export function loadRules(customRulesPath) {
  const rulesPath = customRulesPath || path.resolve(import.meta.dirname, 'rules.json')
  const content = fs.readFileSync(rulesPath, 'utf-8')
  return JSON.parse(content).rules
}

/**
 * 경고 전용 규칙 로드 (실패 조건이 아닌 휴리스틱 규칙)
 */
export function loadWarnRules(customRulesPath) {
  const rulesPath = customRulesPath || path.resolve(import.meta.dirname, 'rules.json')
  const content = fs.readFileSync(rulesPath, 'utf-8')
  return JSON.parse(content).warnRules || []
}

/**
 * Allowlist 검증 및 로드
 */
export function loadAllowlist(customAllowlistPath) {
  const allowlistPath = customAllowlistPath || path.resolve(import.meta.dirname, 'allowlist.json')
  if (!fs.existsSync(allowlistPath)) {
    return []
  }
  const content = fs.readFileSync(allowlistPath, 'utf-8')
  const data = JSON.parse(content)
  const items = data.allowlist || []

  for (const item of items) {
    if (!item.file || typeof item.file !== 'string') {
      throw new Error(`[lint-user-copy] allowlist 항목에 file 필드가 필요합니다: ${JSON.stringify(item)}`)
    }
    if (item.file.includes('*') || item.file.includes('?')) {
      throw new Error(`[lint-user-copy] allowlist에는 와일드카드를 사용할 수 없습니다: ${item.file}`)
    }
    if (!item.reason || typeof item.reason !== 'string' || item.reason.trim().length < 5) {
      throw new Error(`[lint-user-copy] allowlist 항목에는 구체적인 사유(reason)가 필수입니다: ${item.file}`)
    }
  }

  return items
}

/**
 * 규칙이 해당 스캔 컨텍스트에서 동작하는지 확인한다.
 *  - 'ui'   : 사용자 화면 문구가 확실한 위치 (기본값, 모든 규칙 기본 동작)
 *  - 'copy' : 일반 위치의 한글 문구. 규칙이 scanContexts 에 'copy' 를 명시한 경우에만 동작
 */
export function ruleAppliesToContext(rule, context) {
  const contexts = Array.isArray(rule.scanContexts) && rule.scanContexts.length > 0 ? rule.scanContexts : ['ui']
  return contexts.includes(context)
}

/**
 * 텍스트 내에서 규칙 위반 검사
 * 같은 위치를 여러 규칙이 동시에 잡으면 먼저 선언된 규칙 1건만 남긴다 (이중 보고 방지).
 * @param {string} text 검사할 텍스트
 * @param {string} filePath 파일 상대/절대 경로
 * @param {Array} rules 규칙 목록
 * @param {{ context?: 'ui' | 'copy' }} [options]
 * @returns {Array<{ ruleId: string, ruleName: string, category: string, matched: string, index: number }>}
 */
export function matchText(text, filePath, rules, options = {}) {
  if (!text || typeof text !== 'string') return []

  const context = options.context || 'ui'
  const violations = []
  const normPath = filePath.replace(/\\/g, '/')

  for (const rule of rules) {
    if (!ruleAppliesToContext(rule, context)) continue

    // 컨텍스트 필터 확인
    if (rule.contextFilter) {
      const { pathIncludes, orTextIncludes } = rule.contextFilter
      const pathMatched = pathIncludes ? pathIncludes.some(p => normPath.toLowerCase().includes(p.toLowerCase())) : false
      const textMatched = orTextIncludes ? orTextIncludes.some(t => text.toLowerCase().includes(t.toLowerCase())) : false
      if (!pathMatched && !textMatched) {
        continue
      }
    }

    const regex = new RegExp(rule.pattern, rule.flags || 'g')
    let match
    while ((match = regex.exec(text)) !== null) {
      const matchedStr = match[0]
      if (matchedStr.length === 0) {
        regex.lastIndex++
        continue
      }

      // 제외 패턴 확인 (Figma node id의 시간/화면비 제외 등)
      if (rule.excludePatterns && rule.excludePatterns.length > 0) {
        const isFigmaPrefix = /^Figma\s+/i.test(matchedStr)
        if (!isFigmaPrefix) {
          const isExcluded = rule.excludePatterns.some(exPattern => {
            const exRegex = new RegExp(exPattern)
            return exRegex.test(matchedStr)
          })
          if (isExcluded) {
            continue
          }
        }
      }

      // 이미 다른 규칙이 같은 위치를 잡았으면 이중 보고하지 않는다
      const start = match.index
      const end = match.index + matchedStr.length
      const overlapped = violations.some(v => start < v.index + v.matched.length && v.index < end)
      if (overlapped) continue

      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity === 'warn' ? 'warn' : 'error',
        matched: matchedStr,
        index: match.index,
      })
    }
  }

  return violations
}
