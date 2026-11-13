import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Ban OpenAI Luna & Text models across target files', () => {
  const targetFiles = [
    'src/lib/ai/conversation-brain.ts',
    'src/lib/conversation/conversation-repository.ts',
    'src/features/marketing-agent/engine/credit-economy.ts',
    'src/features/marketing-agent/engine/agent-studio-governance.ts',
    'src/features/chat/jobs/production-runner.ts',
    'src/app/api/admin/agents/eval/route.ts',
    'src/features/tool-runtime/action-worker.ts',
    'src/features/content/content-draft-service.ts',
    'src/features/automation/vision-browser-agent.ts',
    'src/features/harness/openai-harness-analyzer.ts',
  ]

  const forbiddenTextPatterns = [
    /gpt-5\.6-luna/i,
    /gpt-5\.6-luna-max/i,
    /sohee-luna/i,
    /OPENAI_TEXT_MODEL/,
    /OPENAI_API_MODEL_ID/,
    /OPENAI_FALLBACK_TEXT_MODEL/,
    /OPENAI_ACTION_MODEL/,
  ]

  targetFiles.forEach((fileRelPath) => {
    it(`guarantees no banned OpenAI text / Luna models in ${fileRelPath}`, () => {
      const fullPath = path.resolve(process.cwd(), fileRelPath)
      const content = fs.readFileSync(fullPath, 'utf8')

      for (const pattern of forbiddenTextPatterns) {
        const match = content.match(pattern)
        expect(match, `Forbidden pattern ${pattern} found in ${fileRelPath}: line containing "${match?.[0]}"`).toBeNull()
      }
    })
  })
})
