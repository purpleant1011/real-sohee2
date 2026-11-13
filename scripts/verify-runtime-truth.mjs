import fs from 'node:fs'
import path from 'node:path'
import { analyzeSource } from './runtime-truth-rules.mjs'

// Parse CLI options: --root <dir>, --json
const args = process.argv.slice(2)
let targetRoot = process.cwd()
let jsonOutput = false

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1]) {
    targetRoot = path.resolve(args[i + 1])
    i++
  } else if (args[i] === '--json') {
    jsonOutput = true
  }
}

const errors = []
const analysisErrors = []

function scanDir(dir, fileList = [], visited = new Set()) {
  if (!fs.existsSync(dir)) return fileList
  const realDir = fs.realpathSync(dir)
  if (visited.has(realDir)) return fileList
  visited.add(realDir)

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') &&
          entry.name !== 'node_modules' &&
          entry.name !== '__tests__' &&
          entry.name !== 'fixtures' &&
          entry.name !== 'e2e-fixture' &&
          entry.name !== 'v075-qa' &&
          entry.name !== 'dist' &&
          entry.name !== '.next') {
        scanDir(fullPath, fileList, visited)
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (['.ts', '.tsx', '.js', '.mjs'].includes(ext)) {
        if (!entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
          fileList.push(fullPath)
        }
      }
    }
  }
  return fileList
}

const srcDir = path.join(targetRoot, 'src')
const scriptsDir = path.join(targetRoot, 'scripts')
const scanRoots = [srcDir, scriptsDir].filter(d => fs.existsSync(d))
const allFiles = scanRoots.flatMap(r => scanDir(r))

if (!jsonOutput) {
  console.log(`🔍 [Runtime Truth Gate V2.0] Scanning ${allFiles.length} source files (root: ${targetRoot})...`)
}

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8')
  const relPath = path.relative(targetRoot, file)

  // Reporting may never substitute sample outcomes or treat reservation prices as cash.
  const isReportingSurface = /src\/(features\/reporting\/|app\/app\/(results|customers)\/)/.test(relPath)
  if (isReportingSurface && (
    /effective(?:Bookings|Revenue|Posts|Engagements)\s*=/.test(content) ||
    /(?:hoursSaved|costSavedWon)\s*=\s*\{\s*[1-9]\d*/.test(content) ||
    /(?:totalRev\w*|totalRevenueWon)\s*=\s*[^\n]*reduce\([^\n]*(?:total_amount_krw|deposit_krw)/.test(content) ||
    /setCustomerState\(['"]demo['"]\)/.test(content)
  )) {
    errors.push({
      file: relPath,
      line: 1,
      rule: 'NO_FABRICATED_REPORTING_KPI',
      message: 'Reporting must use observed evidence, not sample outcomes, fixed savings, or reservation prices as revenue.'
    })
  }

  // -------------------------------------------------------------------------
  // Baseline Rules 1-5 (Preserved on src/ files)
  // -------------------------------------------------------------------------
  if (relPath.startsWith('src/')) {
    // 1. Check for localStorage used for Credit Balance in production
    const hasLocalStorageCreditUsage = /localStorage\.(get|set)Item\([^)]*(credit|balance)/i.test(content) || /localStorage\[['"`][^'"`]*(credit|balance)/i.test(content)
    if (hasLocalStorageCreditUsage) {
      if (!relPath.includes('theme') && !relPath.includes('ui-state')) {
        errors.push({
          file: relPath,
          line: 1,
          rule: 'NO_LOCALSTORAGE_CREDIT',
          message: 'Credit or balance logic must NOT use localStorage. Use Server Credit Ledger.'
        })
      }
    }

    // 2. Check for hardcoded workspace ID in production UI/Routes
    if (content.includes('ws-byreum') && !relPath.includes('fixtures') && !relPath.includes('mock') && !relPath.includes('seed')) {
      const isHardcodedDefault = /workspaceId\s*[:=]\s*['"]ws-byreum['"]/i.test(content) || /['"]ws-byreum['"]/.test(content)
      if (isHardcodedDefault && !relPath.includes('fixture')) {
        errors.push({
          file: relPath,
          line: 1,
          rule: 'NO_HARDCODED_WORKSPACE',
          message: 'Hardcoded workspace ID "ws-byreum" detected in production code. Use dynamic Workspace Context.'
        })
      }
    }

    // 3. Check for fake verification fallback URLs
    if (content.includes('blog.naver.com') && (content.includes('fallback') || content.includes('fake') || content.includes('mock')) && content.includes('VERIFIED')) {
      errors.push({
        file: relPath,
        line: 1,
        rule: 'NO_FAKE_VERIFICATION_FALLBACK',
        message: 'Fake verification URL fallback detected. External actions must only transition to VERIFIED with real provider evidence.'
      })
    }

    // 4. Check for in-memory store labeled as persistent
    if (content.includes('InMemoryHarnessStore') || (content.includes('new Map()') && content.includes('harnessStore'))) {
      errors.push({
        file: relPath,
        line: 1,
        rule: 'NO_IN_MEMORY_PERSISTENT_STORE',
        message: 'In-memory store detected for user harness. Harness assets must be persisted in Supabase / Server store.'
      })
    }

    // 5. Check for legacy 500 SC Trial in production code (Must be 6,000 SC)
    const hasLegacy500Trial =
      content.includes('initialCreditGrant: 500') ||
      content.includes('500 SC 무료체험') ||
      (/TRIAL_GRANT/i.test(content) && /\b500\s*SC\b/i.test(content)) ||
      /TRIAL_GRANT[^\n]{0,100}\bamount\s*:\s*500\b/i.test(content)
    if (hasLegacy500Trial && !content.includes('6000') && !content.includes('5500') && !relPath.includes('legacy') && !relPath.includes('migration')) {
      errors.push({
        file: relPath,
        line: 1,
        rule: 'NO_LEGACY_500_TRIAL',
        message: 'Legacy 500 SC Trial detected in source code. 3rd revision canonical Trial grant is strictly 6,000 SC.'
      })
    }
  }

  // -------------------------------------------------------------------------
  // AST-based Rules G1 - G5 (V2.0 Addition)
  // -------------------------------------------------------------------------
  const astResult = analyzeSource(relPath, content)
  if (astResult.analysisErrors?.length) {
    analysisErrors.push(...astResult.analysisErrors)
  }
  for (const finding of astResult.findings) {
    errors.push({
      file: finding.file,
      line: finding.line,
      rule: finding.rule,
      message: finding.message,
    })
  }
}

// -------------------------------------------------------------------------
// Report Output
// -------------------------------------------------------------------------
const byRule = errors.reduce((acc, err) => {
  acc[err.rule] = (acc[err.rule] || 0) + 1
  return acc
}, {})

if (jsonOutput) {
  const output = {
    targetRoot,
    scannedFiles: allFiles.length,
    violationsCount: errors.length,
    byRule,
    violations: errors,
    analysisErrors,
    passed: errors.length === 0 && analysisErrors.length === 0,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exit(output.passed ? 0 : 1)
}

console.log('\n======================================================')
console.log('       SOHEE RUNTIME TRUTH VERIFICATION REPORT        ')
console.log('======================================================')

if (errors.length === 0 && analysisErrors.length === 0) {
  console.log('✅ ALL CHECKS PASSED: 0 Runtime Truth violations found.')
  console.log('ℹ️  Note: 0 static gate violations does not constitute production Same Truth certification.')
  process.exit(0)
} else {
  console.error(`❌ FAILED: Found ${errors.length} Runtime Truth violation(s) across ${allFiles.length} files:\n`)
  for (const err of errors) {
    console.error(`- [${err.rule}] in ${err.file}:${err.line} -> ${err.message}`)
  }
  if (analysisErrors.length > 0) {
    console.error(`\n⚠️ Analysis Errors (${analysisErrors.length}):`)
    for (const aErr of analysisErrors) {
      console.error(`- ${aErr.file}: ${aErr.message}`)
    }
  }
  console.error('\nBreakdown by rule:')
  for (const [rule, count] of Object.entries(byRule)) {
    console.error(`  - ${rule}: ${count}`)
  }
  console.error('\nResolve all violations before proceeding.')
  process.exit(1)
}
