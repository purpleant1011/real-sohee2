#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { loadRules, loadAllowlist } from './matcher.mjs'
import { collectTargetFiles, scanSourceFile, scanSourceFileWarnings } from './scanner.mjs'

const BASELINE_PATH = path.resolve(import.meta.dirname, 'baseline.json')

/**
 * Baseline 데이터 로드
 */
export function loadBaseline(customPath) {
  const p = customPath || BASELINE_PATH
  if (!fs.existsSync(p)) {
    return { version: '1.0.0', violations: [] }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

/**
 * Baseline 데이터 저장
 */
export function saveBaseline(violations, customPath) {
  const p = customPath || BASELINE_PATH
  const data = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    totalViolations: violations.length,
    violations: violations.map(v => ({
      file: v.file,
      line: v.line,
      column: v.column,
      ruleId: v.ruleId,
      ruleName: v.ruleName,
      category: v.category,
      matched: v.matched,
      context: v.context,
      snippet: v.snippet,
    })),
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  return data
}

/**
 * 현재 스캔 결과와 baseline을 비교하여 신규 위반 분리
 * 파일 + ruleId + matched 기준 빈도수(count) 비교 알고리즘 적용
 */
export function compareWithBaseline(currentViolations, baselineViolations) {
  // Baseline 카운터 구성
  const baselineCountMap = new Map()
  for (const b of baselineViolations) {
    const key = `${b.file}::${b.ruleId}::${b.matched}`
    baselineCountMap.set(key, (baselineCountMap.get(key) || 0) + 1)
  }

  const baselineMatched = []
  const newViolations = []

  for (const curr of currentViolations) {
    const key = `${curr.file}::${curr.ruleId}::${curr.matched}`
    const available = baselineCountMap.get(key) || 0
    if (available > 0) {
      baselineCountMap.set(key, available - 1)
      baselineMatched.push(curr)
    } else {
      newViolations.push(curr)
    }
  }

  return {
    baselineMatched,
    newViolations,
  }
}

/**
 * 메인 린터 실행 함수
 */
export async function runLintUserCopy(options = {}) {
  const rootDir = options.rootDir || process.cwd()
  const isUpdateBaseline = options.updateBaseline || process.argv.includes('--update-baseline')
  const isJson = options.json || process.argv.includes('--json')
  const showAllWarnings = options.showWarnings || process.argv.includes('--show-warnings')
  const warningsAsErrors = options.strictWarnings || process.argv.includes('--strict-warnings')

  const rules = loadRules(options.rulesPath)
  const allowlist = loadAllowlist(options.allowlistPath)

  const files = collectTargetFiles(rootDir)
  const allViolations = []
  const allWarnings = []

  for (const relFile of files) {
    const absPath = path.resolve(rootDir, relFile)
    const content = fs.readFileSync(absPath, 'utf-8')
    const fileFindings = scanSourceFile(relFile, content, rules, allowlist)
    for (const finding of fileFindings) {
      // severity 'warn' 규칙은 실패 조건이 아니라 경고로만 보고한다
      if (finding.severity === 'warn') allWarnings.push(finding)
      else allViolations.push(finding)
    }
    const assuranceWarnings = scanSourceFileWarnings(relFile, content)
    if (assuranceWarnings.length > 0) {
      allWarnings.push(...assuranceWarnings)
    }
  }

  if (isUpdateBaseline) {
    saveBaseline(allViolations, options.baselinePath)
    if (!isJson) {
      console.log(`[lint-user-copy] Baseline이 갱신되었습니다: 총 ${allViolations.length}건의 기존 위반이 기록되었습니다.`)
    }
    return {
      success: true,
      totalViolations: allViolations.length,
      newViolations: [],
      baselineViolations: allViolations,
    }
  }

  const baselineData = loadBaseline(options.baselinePath)
  const { baselineMatched, newViolations } = compareWithBaseline(allViolations, baselineData.violations || [])
  const failedByWarnings = warningsAsErrors && allWarnings.length > 0
  const success = newViolations.length === 0 && !failedByWarnings

  const result = {
    success,
    targetFilesCount: files.length,
    totalViolations: allViolations.length,
    newViolations,
    baselineViolations: baselineMatched,
    warnings: allWarnings,
  }

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          success,
          targetFilesCount: files.length,
          totalViolations: allViolations.length,
          baselineCount: baselineMatched.length,
          newViolationsCount: newViolations.length,
          newViolations,
          baselineViolations: baselineMatched,
          warningsCount: allWarnings.length,
          warnings: allWarnings,
        },
        null,
        2
      )
    )
    return result
  }

  // 콘솔 리포트 출력
  console.log('='.repeat(70))
  console.log('  🔍 Sohee User-Facing Copy Linter (ANI-1553 v2)')
  console.log('='.repeat(70))
  console.log(`대상 사용자 화면 파일: ${files.length}개`)
  console.log(`전체 감지된 위반: ${allViolations.length}건 (Baseline 고정: ${baselineMatched.length}건, 신규: ${newViolations.length}건)`)
  const warningsByRule = {}
  for (const w of allWarnings) warningsByRule[w.ruleId] = (warningsByRule[w.ruleId] || 0) + 1
  const warningSummary = Object.entries(warningsByRule)
    .map(([id, n]) => `${id} ${n}건`)
    .join(', ')
  console.log(`경고(실패 아님): ${allWarnings.length}건${warningSummary ? ` — ${warningSummary}` : ''}`)
  console.log('-'.repeat(70))

  if (allWarnings.length > 0) {
    const shown = showAllWarnings ? allWarnings : allWarnings.slice(0, 10)
    console.log('\n⚠️  [WARN] 경고 (실패 아님 — 영문 대문자 코드 노출 / 조건 없이 렌더되는 정상 확인 문구):')
    for (const w of shown) {
      console.log(`  - ${w.file}:${w.line}:${w.column} [${w.ruleId}] "${w.matched}" → "${w.snippet}"`)
    }
    if (!showAllWarnings && allWarnings.length > shown.length) {
      console.log(`  … 외 ${allWarnings.length - shown.length}건 (전체 목록: --show-warnings, 실패로 취급: --strict-warnings)`)
    }
    console.log('')
  }

  if (newViolations.length > 0) {
    console.error('\n❌ [FAIL] 신규 금칙어 위반이 발견되었습니다:')
    console.error('사용자 화면에 내부 영문 상태 코드, 영문 상태어(ERROR/EMPTY/UNKNOWN 등), SHA, UUID, 피그마 노드 ID, 하네스 등의 노출은 금지됩니다.\n')

    for (const v of newViolations) {
      console.error(`  - ${v.file}:${v.line}:${v.column} [${v.ruleId}] "${v.matched}" (${v.context})`)
      console.error(`    스니펫: "${v.snippet}"`)
    }

    console.error('\n' + '='.repeat(70))
    console.error(`❌ 검사 실패: 신규 위반 ${newViolations.length}건 발생. 코드를 수정하거나 승인 절차를 거치세요.`)
    console.error('='.repeat(70))

    return result
  }

  if (failedByWarnings) {
    console.error(`❌ 검사 실패: --strict-warnings 모드에서 경고 ${allWarnings.length}건이 실패로 취급되었습니다.`)
    console.error('='.repeat(70))
    return result
  }

  console.log(`✅ [PASS] 신규 금칙어 위반 0건! (기존 Baseline ${baselineMatched.length}건은 격리/추적 관리 중)`)
  console.log('='.repeat(70))

  return result
}

// 직접 CLI 실행 시
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runLintUserCopy()
    .then(result => {
      if (!result.success) {
        process.exit(1)
      }
      process.exit(0)
    })
    .catch(err => {
      console.error('[lint-user-copy] 치명적 오류 발생:', err)
      process.exit(1)
    })
}
