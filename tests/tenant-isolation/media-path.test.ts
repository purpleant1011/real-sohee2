import { describe, expect, it } from 'vitest'
import { resolveMediaSourcePath, resolvePublishRenditionPath } from '../../src/features/media/media-storage'

for (const build of [resolveMediaSourcePath, resolvePublishRenditionPath]) {
  describe(build.name, () => {
    it('preserves the existing canonical path and extension normalization', () => {
      expect(build('workspace-1', 'asset_1', '.PNG')).toContain('workspaces/workspace-1/media/')
      expect(build('workspace-1', 'asset_1', '.PNG')).toMatch(/\.png$/)
    })
    for (const input of ['', '..', '../other', 'a/b', 'a\\b', '%2e%2e', 'a?x', 'a#x', ' a', 'a\u0000']) {
      it(`rejects unsafe workspace/asset segment ${JSON.stringify(input)}`, () => {
        expect(() => build(input, 'asset', 'png')).toThrow('INVALID_MEDIA_PATH')
        expect(() => build('workspace', input, 'png')).toThrow('INVALID_MEDIA_PATH')
      })
    }
    for (const extension of ['', '../png', 'png/../../other', 'jpg?x', '%2fpng', 'png\\other', '..png']) {
      it(`rejects unsafe extension ${JSON.stringify(extension)}`, () => {
        expect(() => build('workspace', 'asset', extension)).toThrow('INVALID_MEDIA_PATH')
      })
    }
  })
}
