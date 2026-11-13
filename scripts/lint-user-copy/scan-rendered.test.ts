import { describe, expect, it } from 'vitest'
import { parseDriverOutput } from './scan-rendered.mjs'

const marker = '__LINT_USER_COPY_RENDERED__'

describe('Ego Lite rendered-copy output', () => {
  it('parses page results when the CLI writes logs to stderr', () => {
    const page = { route: '/dev/vault-board', entries: [{ kind: 'text', text: '보관함' }] }
    expect(parseDriverOutput('', `[error] taskSpaceId=17\n${marker} ${JSON.stringify(page)}\n`)).toEqual([page])
  })
})
