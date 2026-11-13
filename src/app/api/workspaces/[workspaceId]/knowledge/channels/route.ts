import { createLearningRoute } from '@/features/channel-learning/server'

export const dynamic = 'force-dynamic'
export const GET = createLearningRoute('list')
export const POST = createLearningRoute('register')
