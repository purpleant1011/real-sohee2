import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('ANI-1128: Figma Creative Truth Production Parity + 375px Mobile/A11y', () => {
  const repoRoot = resolve(__dirname, '../..')
  const figmaMappingDocPath = resolve(repoRoot, 'docs/11th/FIGMA_PRODUCTION_MAPPING.md')
  const conversationWorkspacePath = resolve(repoRoot, 'src/features/chat/v086-conversation-workspace.tsx')
  const conversationCssPath = resolve(repoRoot, 'src/features/chat/v086-conversation-workspace.module.css')
  const studioCardPath = resolve(repoRoot, 'src/features/creative/creative-studio-card.tsx')
  const studioCardCssPath = resolve(repoRoot, 'src/features/creative/creative-studio-card.module.css')
  const contentDetailModalPath = resolve(repoRoot, 'src/components/v088/content/content-detail-modal.tsx')

  describe('1. Figma A-L Canonical Route & State Mapping Documentation Gate', () => {
    it('ensures docs/11th/FIGMA_PRODUCTION_MAPPING.md exists and covers nodes A through L', () => {
      expect(existsSync(figmaMappingDocPath)).toBe(true)
      const content = readFileSync(figmaMappingDocPath, 'utf-8')
      const requiredSections = [
        'A Visual Brief & MediaAsset',
        'B Exact Approval',
        'C Provider Readback',
        'D Same Entity',
        'E Admin Monitor',
        'F Golden Journey',
        'G Rendition/Lease',
        'H Async Race',
        'I Upload/Rights/Carousel',
        'J Failure/Recovery',
        'K Mobile Approval',
        'L Observability',
      ]
      for (const sec of requiredSections) {
        expect(content).toContain(sec)
      }
    })
  })

  describe('2. 375px Mobile Responsive Layout & Collapsible Sidebar Gate', () => {
    it('ensures conversation workspace provides mobile collapsible/drawer sidebar toggle', () => {
      expect(existsSync(conversationWorkspacePath)).toBe(true)
      const content = readFileSync(conversationWorkspacePath, 'utf-8')
      // Must contain mobile sidebar toggle to prevent stacked conversation clipping on 375px
      expect(content).toContain('mobileSidebar')
    })

    it('ensures conversation CSS defines responsive rules for mobile sidebar', () => {
      expect(existsSync(conversationCssPath)).toBe(true)
      const content = readFileSync(conversationCssPath, 'utf-8')
      expect(content).toContain('@media (max-width: 840px)')
    })

    it('ensures CreativeStudioCard buttons satisfy 44px touch target standard', () => {
      expect(existsSync(studioCardCssPath)).toBe(true)
      const content = readFileSync(studioCardCssPath, 'utf-8')
      expect(content).toContain('min-height: 44px')
    })

    it('ensures ContentDetailModal buttons provide 44px touch target on mobile', () => {
      expect(existsSync(contentDetailModalPath)).toBe(true)
      const content = readFileSync(contentDetailModalPath, 'utf-8')
      expect(content).toContain('min-h-[44px]')
    })
  })

  describe('3. Accessibility (A11y) & Semantic Contracts Gate', () => {
    it('ensures CreativeStudioCard contains proper ARIA labels and roles', () => {
      expect(existsSync(studioCardPath)).toBe(true)
      const content = readFileSync(studioCardPath, 'utf-8')
      expect(content).toContain('aria-label="Creative Asset Truth Studio"')
      expect(content).toContain('role="status"')
      expect(content).toContain('role="alert"')
    })

    it('ensures image element has accessible alt text and valid dimensional attributes', () => {
      const content = readFileSync(studioCardPath, 'utf-8')
      expect(content).toContain('alt={brief.creativeDirection.heroSubject}')
      expect(content).toContain('width=')
      expect(content).toContain('height=')
    })
  })
})
