/**
 * Next 16.4 의 loadCustomCacheHandlers 는 Workers 에서 동적 import 가 불가능해 본문을 비운다.
 * 정규식으로 "다음 메서드 앞까지"를 지우면 뒤따르는 메서드(getPublicDir 등)까지 삼켜 런타임 오류가 난다(2026-11-03 사고).
 * 그래서 이 메서드의 중괄호 본문만 균형을 맞춰 정확히 교체한다(문자열·템플릿 안의 중괄호는 무시).
 */
export function patchLoadCustomCacheHandlers(code) {
  const marker = 'async loadCustomCacheHandlers('
  let out = ''
  let index = 0
  for (;;) {
    const start = code.indexOf(marker, index)
    if (start === -1) return out + code.slice(index)
    const paramsEnd = code.indexOf(')', start)
    const open = paramsEnd === -1 ? -1 : code.indexOf('{', paramsEnd)
    if (open === -1) return out + code.slice(index)
    let depth = 0
    let end = -1
    let quote = null
    for (let i = open; i < code.length; i += 1) {
      const ch = code[i]
      if (quote) {
        if (ch === '\\') i += 1
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    if (end === -1) return out + code.slice(index)
    const body = code.slice(open, end + 1).replace(/\s+/g, '')
    const already = body === '{return;}'
    out += code.slice(index, start) + (already ? code.slice(start, end + 1) : 'async loadCustomCacheHandlers(){return;}')
    index = end + 1
  }
}
