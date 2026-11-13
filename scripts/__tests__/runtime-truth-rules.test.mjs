import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { analyzeSource, RULE_IDS } from '../runtime-truth-rules.mjs'

describe('Runtime Truth Gate V2 AST Rules', () => {
  describe('G1: NO_DB_LIST_NULL_AS_EMPTY', () => {
    it('detects unvalidated null data coalesced to empty array in db list query', () => {
      const code = `
        async function resolveSource(admin, workspaceId) {
          const { data, error } = await admin
            .from('media_assets')
            .select('*')
            .eq('workspace_id', workspaceId)
          if (error) throw new Error('fetch failed')
          const rows = (data as any[]) || []
          if (rows.length === 0) return []
          return rows
        }
      `
      const result = analyzeSource('src/features/media/sample.ts', code)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: RULE_IDS.G1,
            line: 8,
          }),
        ]),
      )
    })

    it('passes when data is properly guarded with Array.isArray', () => {
      const code = `
        async function resolveSource(admin, workspaceId) {
          const { data, error } = await admin.from('media_assets').select('*')
          if (error || !Array.isArray(data)) throw new Error('fetch failed')
          const rows = data
          return rows
        }
      `
      const result = analyzeSource('src/features/media/safe.ts', code)
      const g1 = result.findings.filter(f => f.rule === RULE_IDS.G1)
      expect(g1).toHaveLength(0)
    })

    it('passes for scalar optional property fallbacks (not list)', () => {
      const code = `
        function getProfile(profile) {
          const name = profile?.business_name ?? ''
          const location = profile?.location || null
          return { name, location }
        }
      `
      const result = analyzeSource('src/features/profile/safe.ts', code)
      const g1 = result.findings.filter(f => f.rule === RULE_IDS.G1)
      expect(g1).toHaveLength(0)
    })
  })

  describe('G2: NO_QUOTA_COUNT_NULL_AS_ZERO', () => {
    it('detects unverified (count ?? 0) in quota comparison', () => {
      const code = `
        async function assertDailyQuota(admin, workspaceId) {
          const { count, error } = await admin
            .from('missions')
            .select('id', { count: 'exact', head: true })
          if (error) throw new Error('failed')
          if ((count ?? 0) >= DAILY_LIMIT) {
            throw new Error('limit reached')
          }
        }
      `
      const result = analyzeSource('src/features/quota/sample.ts', code)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: RULE_IDS.G2,
            line: 7,
          }),
        ]),
      )
    })

    it('passes when count is verified with typeof or Number.isSafeInteger before comparison', () => {
      const code = `
        async function assertDailyQuota(admin, workspaceId) {
          const { count, error } = await admin.from('missions').select('id', { count: 'exact', head: true })
          if (error || typeof count !== 'number') throw new Error('failed')
          if (count >= DAILY_LIMIT) throw new Error('limit reached')
        }
      `
      const result = analyzeSource('src/features/quota/safe.ts', code)
      const g2 = result.findings.filter(f => f.rule === RULE_IDS.G2)
      expect(g2).toHaveLength(0)
    })

    it('passes for general arithmetic addition (not quota limit comparison)', () => {
      const code = `
        function sum(a, b) {
          const total = (a ?? 0) + (b ?? 0)
          return total
        }
      `
      const result = analyzeSource('src/utils/math.ts', code)
      const g2 = result.findings.filter(f => f.rule === RULE_IDS.G2)
      expect(g2).toHaveLength(0)
    })
  })

  describe('G3: NO_INCOMPLETE_FACT_SNAPSHOT', () => {
    it('detects unpaginated bulk knowledge_facts passed directly to fact resolver without count coverage', () => {
      const code = `
        export async function loadApprovedFactSnapshot(client, workspaceId, at) {
          const { data, error } = await client.from('knowledge_facts')
            .select('id, workspace_id, content')
            .eq('workspace_id', workspaceId)
          if (error || !Array.isArray(data)) throw new Error('FACT_READ_FAILED')
          return resolveApprovedFacts({ workspaceId, at, rows: data })
        }
      `
      const result = analyzeSource('src/features/knowledge/sample.ts', code)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: RULE_IDS.G3,
          }),
        ]),
      )
    })

    it('passes when single fact row is looked up by id (not bulk)', () => {
      const code = `
        export async function getSingleFact(client, workspaceId, factId) {
          const { data, error } = await client.from('knowledge_facts')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('id', factId)
            .maybeSingle()
          if (error) throw new Error('failed')
          return data
        }
      `
      const result = analyzeSource('src/features/knowledge/safe.ts', code)
      const g3 = result.findings.filter(f => f.rule === RULE_IDS.G3)
      expect(g3).toHaveLength(0)
    })
  })

  describe('G4: NO_GENERIC_CATCH_CREDIT_RESERVE_CODE', () => {
    it('detects multi-step try block falling back to CREDIT_RESERVE_FAILED in generic catch', () => {
      const code = `
        export async function handleFirstValue(req) {
          try {
            const readiness = await readReadiness(admin, wid)
            const preferences = await loadPreferences(admin, wid)
            const draft = await createDraft(admin, wid)
            const profile = await fetchProfile(admin, wid)
            return NextResponse.json({ draft, profile })
          } catch (error) {
            console.error(error)
            return NextResponse.json({
              error: '일시적 지연',
              code: 'CREDIT_RESERVE_FAILED',
            }, { status: 503 })
          }
        }
      `
      const result = analyzeSource('src/features/first-value/sample.ts', code)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: RULE_IDS.G4,
            line: 13,
          }),
        ]),
      )
    })

    it('detects broad CreditFailure mapped to constant CREDIT_RESERVE_FAILED in multi-step flow without code verification', () => {
      const code = `
        export async function handleFirstValue(req) {
          try {
            const draft = await createDraft(admin, wid)
            const profile = await fetchProfile(admin, wid)
            return NextResponse.json({ draft, profile })
          } catch (error) {
            if (error instanceof QuickPostCreditFailure) {
              return NextResponse.json({ error: error.message, code: 'CREDIT_RESERVE_FAILED' }, { status: 503 })
            }
            return NextResponse.json({ error: '일반 오류', code: 'PREVIEW_FAILED' }, { status: 500 })
          }
        }
      `
      const result = analyzeSource('src/features/first-value/broad-catch.ts', code)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: RULE_IDS.G4,
          }),
        ]),
      )
    })

    it('passes when catch forwards original error.code', () => {
      const code = `
        export async function handleFirstValue(req) {
          try {
            const draft = await createDraft(admin, wid)
            const profile = await fetchProfile(admin, wid)
            return NextResponse.json({ draft, profile })
          } catch (error) {
            if (error instanceof QuickPostCreditFailure) {
              return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
            }
            return NextResponse.json({ error: '일반 오류', code: 'PREVIEW_FAILED' }, { status: 500 })
          }
        }
      `
      const result = analyzeSource('src/features/first-value/safe-forward.ts', code)
      const g4 = result.findings.filter(f => f.rule === RULE_IDS.G4)
      expect(g4).toHaveLength(0)
    })

    it('passes when catch explicitly verifies error.code === CREDIT_RESERVE_FAILED', () => {
      const code = `
        export async function handleFirstValue(req) {
          try {
            const draft = await createDraft(admin, wid)
            const profile = await fetchProfile(admin, wid)
            return NextResponse.json({ draft, profile })
          } catch (error) {
            if (error.code === 'CREDIT_RESERVE_FAILED') {
              return NextResponse.json({ error: error.message, code: 'CREDIT_RESERVE_FAILED' }, { status: 503 })
            }
            return NextResponse.json({ error: '일반 오류', code: 'PREVIEW_FAILED' }, { status: 500 })
          }
        }
      `
      const result = analyzeSource('src/features/first-value/safe-guard.ts', code)
      const g4 = result.findings.filter(f => f.rule === RULE_IDS.G4)
      expect(g4).toHaveLength(0)
    })

    it('passes when try block exclusively wraps credit reservation', () => {
      const code = `
        async function reserveCredits(admin, wid) {
          try {
            return await reserveQuickPostCredits({ admin, wid })
          } catch (error) {
            return { code: 'CREDIT_RESERVE_FAILED' }
          }
        }
      `
      const result = analyzeSource('src/features/quick-start/safe.ts', code)
      const g4 = result.findings.filter(f => f.rule === RULE_IDS.G4)
      expect(g4).toHaveLength(0)
    })
  })

  describe('G5: NO_RAW_AUDIT_EVIDENCE_REF_OUTPUT', () => {
    it('detects unredacted fact.sourceRef or cta.evidenceRef passed verbatim to report output', () => {
      const code = `
        export function auditLocalPresence(input) {
          const findings = FIELDS.map(field => {
            const fact = input.facts[field]
            return finding(field, 'MATCH', fact?.sourceRef ?? null, input.observedAt)
          })
          for (const cta of input.ctas) {
            findings.push(finding(cta.kind, 'MATCH', cta.evidenceRef, cta.observedAt))
          }
          return { findings }
        }
      `
      const result = analyzeSource('src/features/local-presence/sample.ts', code)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: RULE_IDS.G5,
          }),
        ]),
      )
    })

    it('passes when sourceRef is validated or redacted before passing to finding', () => {
      const code = `
        export function auditLocalPresence(input) {
          const findings = FIELDS.map(field => {
            const fact = input.facts[field]
            const safeRef = sanitizeOpaqueRef(fact?.sourceRef)
            return finding(field, 'MATCH', safeRef, input.observedAt)
          })
          return { findings }
        }
      `
      const result = analyzeSource('src/features/local-presence/safe.ts', code)
      const g5 = result.findings.filter(f => f.rule === RULE_IDS.G5)
      expect(g5).toHaveLength(0)
    })
  })

  describe('Safety & Target Code Non-Execution', () => {
    it('analyzes code containing process.exit and file write without executing them', () => {
      const maliciousCode = `
        process.exit(123)
        require('fs').writeFileSync('/tmp/malicious.txt', 'pwned')
        throw new Error('should not throw')
      `
      expect(() => analyzeSource('src/suspicious.ts', maliciousCode)).not.toThrow()
    })
  })

  describe('Merge Regression: NO_FABRICATED_REPORTING_KPI (CLI integration)', () => {
    it('detects fabricated reporting KPI in reporting surface and exits with code 1', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truth-test-reporting-'))
      try {
        const reportingDir = path.join(tmpDir, 'src/features/reporting')
        fs.mkdirSync(reportingDir, { recursive: true })
        fs.writeFileSync(path.join(reportingDir, 'x.ts'), "setCustomerState('demo')\n", 'utf8')

        const scriptPath = path.resolve(process.cwd(), 'scripts/verify-runtime-truth.mjs')
        const run = spawnSync(process.execPath, [scriptPath, '--root', tmpDir, '--json'], {
          encoding: 'utf8',
        })

        expect(run.status).toBe(1)
        const output = JSON.parse(run.stdout)
        expect(output.passed).toBe(false)
        expect(output.violations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              rule: 'NO_FABRICATED_REPORTING_KPI',
              file: 'src/features/reporting/x.ts',
            }),
          ]),
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('passes when identical code is outside reporting surface', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truth-test-other-'))
      try {
        const otherDir = path.join(tmpDir, 'src/features/other')
        fs.mkdirSync(otherDir, { recursive: true })
        fs.writeFileSync(path.join(otherDir, 'y.ts'), "setCustomerState('demo')\n", 'utf8')

        const scriptPath = path.resolve(process.cwd(), 'scripts/verify-runtime-truth.mjs')
        const run = spawnSync(process.execPath, [scriptPath, '--root', tmpDir, '--json'], {
          encoding: 'utf8',
        })

        expect(run.status).toBe(0)
        const output = JSON.parse(run.stdout)
        expect(output.passed).toBe(true)
        const kpiViolations = output.violations.filter(v => v.rule === 'NO_FABRICATED_REPORTING_KPI')
        expect(kpiViolations).toHaveLength(0)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('G6: NO_DISCARDED_DEMO_FLAG', () => {
    it('flags a demo flag discarded with void', () => {
      const code = `
        export function getReadModel(params) {
          const isDemo = params.isDemo ?? false
          void isDemo
          return { items: [] }
        }
      `
      const { findings } = analyzeSource('src/lib/read-models/x.ts', code)
      const hits = findings.filter(f => f.rule === RULE_IDS.G6)

      expect(hits).toHaveLength(1)
      expect(hits[0].symbol).toBe('isDemo')
    })

    it('does not flag a demo flag that actually branches', () => {
      const code = `
        export function getReadModel(params) {
          const isDemo = params.isDemo ?? false
          if (!isDemo) return { items: [] }
          return { items: SAMPLE }
        }
      `
      const { findings } = analyzeSource('src/lib/read-models/y.ts', code)

      expect(findings.filter(f => f.rule === RULE_IDS.G6)).toHaveLength(0)
    })
  })

  describe('G7: NO_HARDCODED_OUTCOME_METRIC_IN_JSX', () => {
    it('flags a hardcoded percentage rendered as JSX text', () => {
      const code = `
        export function Card() {
          return <div><span>신뢰도 92%</span></div>
        }
      `
      const { findings } = analyzeSource('src/components/x.tsx', code)
      const hits = findings.filter(f => f.rule === RULE_IDS.G7)

      expect(hits).toHaveLength(1)
      expect(hits[0].symbol).toContain('92%')
    })

    it('flags a hardcoded count claim', () => {
      const code = `
        export function Card() {
          return <div><strong>예약 15건 달성</strong></div>
        }
      `
      const { findings } = analyzeSource('src/components/y.tsx', code)

      expect(findings.filter(f => f.rule === RULE_IDS.G7)).toHaveLength(1)
    })

    it('does not flag interpolated measured values', () => {
      const code = `
        export function Card({ margin }) {
          return <div><span>{margin}%</span></div>
        }
      `
      const { findings } = analyzeSource('src/components/z.tsx', code)

      expect(findings.filter(f => f.rule === RULE_IDS.G7)).toHaveLength(0)
    })

    it('does not flag limits, sizes, and price constants', () => {
      const code = `
        export function Card() {
          return <div>
            <p>JPG·PNG, 최대 10MB</p>
            <p>비밀번호는 8자 이상이어야 합니다</p>
            <span>₩150,000</span>
            <span>980 SC</span>
            <span>3단계</span>
          </div>
        }
      `
      const { findings } = analyzeSource('src/components/w.tsx', code)

      expect(findings.filter(f => f.rule === RULE_IDS.G7)).toHaveLength(0)
    })
  })
})
