import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('ANI-1126: SAMPLE_THREADS/setTimeout Mock Conversation Total Purge & Real Agent Execution Wiring', () => {
  const repoRoot = resolve(__dirname, '../..')
  const conversationWorkspacePath = resolve(repoRoot, 'src/features/chat/v086-conversation-workspace.tsx')

  describe('1. Production Source Static Scan Gate', () => {
    it('ensures v086-conversation-workspace.tsx exists', () => {
      expect(existsSync(conversationWorkspacePath)).toBe(true)
    })

    it('ensures v086-conversation-workspace.tsx contains ZERO SAMPLE_THREADS', () => {
      const content = readFileSync(conversationWorkspacePath, 'utf-8')
      expect(content).not.toContain('SAMPLE_THREADS')
    })

    it('ensures v086-conversation-workspace.tsx contains ZERO setTimeout fake replies', () => {
      const content = readFileSync(conversationWorkspacePath, 'utf-8')
      expect(content).not.toContain('setTimeout')
    })

    it('ensures v086-conversation-workspace.tsx contains ZERO 바이름, ZERO studio_by.reum, and ZERO 자연눈썹', () => {
      const content = readFileSync(conversationWorkspacePath, 'utf-8')
      expect(content).not.toContain('바이름')
      expect(content).not.toContain('studio_by.reum')
      expect(content).not.toContain('자연눈썹')
    })

    it('ensures v086-conversation-workspace.tsx wires to real agent chat API', () => {
      const content = readFileSync(conversationWorkspacePath, 'utf-8')
      expect(content).toContain('/agent/chat')
      expect(content).toContain('fetch')
    })
  })
})
