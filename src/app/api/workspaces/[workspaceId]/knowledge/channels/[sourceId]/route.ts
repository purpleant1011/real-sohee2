import { createLearningRoute } from '@/features/channel-learning/server'

export const dynamic = 'force-dynamic'
export const GET = createLearningRoute('detail')
export const PATCH = createLearningRoute('update')
export const DELETE = createLearningRoute('delete')
