import { describe, expect, it, vi } from 'vitest'
import { reviewLearningAction } from './review-learning'
const id='10000000-0000-4000-8000-000000000001'
describe('learning review action',()=>{it('does not activate a harness when approving a candidate',async()=>{const repo={review:vi.fn().mockResolvedValue('approved')}; await expect(reviewLearningAction({workspaceId:id,candidateId:id,decision:'approve',expectedVersion:1},repo)).resolves.toEqual({data:{status:'approved'}}); expect(repo.review).toHaveBeenCalledWith(expect.objectContaining({decision:'approved'}))})})
