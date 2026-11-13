import { expect, it } from 'vitest'
import * as quickPost from '../quick-post-service'

it('advertises original source-asset binding only through the versioned server contract', () => {
  expect(Reflect.get(quickPost, 'sourceAssetContract')).toBe('v093-original-1')
})
