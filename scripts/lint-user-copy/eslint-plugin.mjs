import { loadRules, loadAllowlist, matchText } from './matcher.mjs'
import { isUiJsxAttr } from './ast-context.mjs'

// ESLint 는 JSX 텍스트/속성만 즉시 피드백한다. 문자열 프로퍼티·라벨 맵 등 AST 컨텍스트 검사는
// `npm run lint:user-copy` (scripts/lint-user-copy/index.mjs)가 담당한다.
// severity 'warn' 규칙은 CLI 리포트 전용이므로 여기서는 제외한다 (에디터 경고 소음 방지).
const rules = loadRules().filter(rule => rule.severity !== 'warn')
const allowlist = loadAllowlist()

export const noInternalTermsRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow internal terms, status codes, English status words, UUIDs, and Figma node IDs in user-facing copy (ANI-1553)',
    },
    schema: [],
    messages: {
      forbiddenTerm: '사용자 화면에 금지된 내부 용어/코드 "{{matched}}"가 노출되었습니다. (규칙: {{ruleName}})',
    },
  },
  create(context) {
    const filename = (context.filename || '').replace(/\\/g, '/')
    const allowedEntry = allowlist.find(item => filename.endsWith(item.file.replace(/\\/g, '/')))
    const allowedRuleSet = new Set(allowedEntry?.allowedRules || [])

    function checkText(node, text) {
      if (!text || typeof text !== 'string') return
      for (const match of matchText(text, filename, rules, { context: 'ui' })) {
        if (allowedRuleSet.has(match.ruleId)) continue
        context.report({
          node,
          messageId: 'forbiddenTerm',
          data: {
            matched: match.matched,
            ruleName: match.ruleName,
          },
        })
      }
    }

    return {
      JSXText(node) {
        checkText(node, node.value)
      },
      JSXAttribute(node) {
        const attrName = node.name?.name
        if (typeof attrName === 'string' && isUiJsxAttr(attrName)) {
          if (node.value?.type === 'Literal' && typeof node.value.value === 'string') {
            checkText(node.value, node.value.value)
          }
        }
      },
    }
  },
}

const userCopyPlugin = {
  rules: {
    'no-internal-terms': noInternalTermsRule,
  },
}

export default userCopyPlugin
