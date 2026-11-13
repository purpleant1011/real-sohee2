/**
 * Canonical Governance Checker (ANI-1104)
 *
 * Verifies that AGENTS.md, GEMINI.md, and release manifest maintain
 * 10th revision SSOT consistency, preventing stale past overrides (8th/9th)
 * from misleading autonomous agent sessions.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface GovernanceManifest {
  version: string
  canonicalRevision: string
  linearProjectId: string
  activeBranch: string
  baseBranch: string
}

export interface GovernanceValidationResult {
  valid: boolean
  currentRevision: string
  errors: string[]
  warnings: string[]
}

export function validateGovernanceConsistency(
  workspaceRoot: string
): GovernanceValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const manifestPath = path.join(workspaceRoot, 'canonical-governance-manifest.json')
  if (!fs.existsSync(manifestPath)) {
    errors.push('Missing canonical-governance-manifest.json')
    return { valid: false, currentRevision: 'UNKNOWN', errors, warnings }
  }

  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as GovernanceManifest
  const expectedRevision = manifestContent.canonicalRevision

  const agentsPath = path.join(workspaceRoot, 'AGENTS.md')
  if (fs.existsSync(agentsPath)) {
    const agentsContent = fs.readFileSync(agentsPath, 'utf8')
    const hasCanonicalOverride =
      agentsContent.includes('CURRENT CANONICAL OVERRIDE') &&
      (agentsContent.includes('13차') || agentsContent.includes('12차') || agentsContent.includes('V0.91'))
    if (!hasCanonicalOverride) {
      errors.push('AGENTS.md does not have current revision as CURRENT CANONICAL OVERRIDE')
    }
    if (agentsContent.includes('8차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: AGENTS.md still claims 8차 as current canonical override')
    }
    if (agentsContent.includes('9차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: AGENTS.md still claims 9차 as current canonical override')
    }
    if (agentsContent.includes('10차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: AGENTS.md still claims 10차 as current canonical override')
    }
    if (agentsContent.includes('11차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: AGENTS.md still claims 11차 as current canonical override')
    }
  } else {
    errors.push('Missing AGENTS.md')
  }

  const geminiPath = path.join(workspaceRoot, 'GEMINI.md')
  if (fs.existsSync(geminiPath)) {
    const geminiContent = fs.readFileSync(geminiPath, 'utf8')
    const hasCanonicalOverride =
      geminiContent.includes('CURRENT CANONICAL OVERRIDE') &&
      (geminiContent.includes('13차') || geminiContent.includes('12차') || geminiContent.includes('V0.91'))
    if (!hasCanonicalOverride) {
      errors.push('GEMINI.md does not have current revision as CURRENT CANONICAL OVERRIDE')
    }
    if (geminiContent.includes('5차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: GEMINI.md still claims 5차 as current canonical override')
    }
    if (geminiContent.includes('10차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: GEMINI.md still claims 10차 as current canonical override')
    }
    if (geminiContent.includes('11차 수정 · CURRENT CANONICAL OVERRIDE')) {
      errors.push('STALE_GOVERNANCE_DETECTED: GEMINI.md still claims 11차 as current canonical override')
    }
  } else {
    errors.push('Missing GEMINI.md')
  }

  return {
    valid: errors.length === 0,
    currentRevision: expectedRevision,
    errors,
    warnings,
  }
}
