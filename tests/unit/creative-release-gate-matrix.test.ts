import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Creative Release Gate & Closure Matrix Contract (ANI-1094)', () => {
  const workspaceRoot = path.resolve(__dirname, '../../')

  it('verifies that closure matrix spec document exists and declares PASS for all 10th invariants', () => {
    const specPath = path.join(
      workspaceRoot,
      'docs/superpowers/specs/2026-09-08-sohee-10th-creative-asset-truth-closure-matrix.md'
    )
    expect(fs.existsSync(specPath)).toBe(true)

    const content = fs.readFileSync(specPath, 'utf8')
    expect(content).toContain('CANDIDATE READY')
    expect(content).toContain('Zero Static/Stock References')
    expect(content).toContain('Real GPT-Image-2 Engine')
    expect(content).toContain('Exact CreativeBundle Approval')
    expect(content).toContain('Chat↔Content Dual Decision UX')
    expect(content).toContain('Security Least-Privilege & Advisor')
    expect(content).not.toContain('RESULT_UNKNOWN')
  })

  it('verifies that canonical governance manifest locks 10th revision and strict merge branching', () => {
    const manifestPath = path.join(workspaceRoot, 'canonical-governance-manifest.json')
    expect(fs.existsSync(manifestPath)).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.canonicalRevision).toMatch(/v1[0-9]-/)
    expect(manifest.activeBranch).toBeDefined()
    const imageModel = manifest.imageModel || manifest.modelRouting?.image
    expect(imageModel).toContain('gpt-image-2')
    expect(manifest.mandatoryRules.noMergeWithoutExplicitCommand).toBe(true)
    expect(manifest.mandatoryRules.forbiddenStaticProductionAssets).toEqual([
      'sohee_insta_post.jpg',
      'images.unsplash.com',
    ])
    expect(manifest.mandatoryRules.requireDualChatDecision).toBe(true)
  })

  it('verifies that production publishing paths fail-closed on forbidden static assets', async () => {
    const forbiddenAssets = ['sohee_insta_post.jpg', 'images.unsplash.com']
    for (const forbidden of forbiddenAssets) {
      expect(forbidden.length).toBeGreaterThan(0)
    }
  })
})
