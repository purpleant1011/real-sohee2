export const dynamic = 'force-dynamic';
import { z } from 'zod'
import { uploadContentMediaAction } from '@/features/content/actions/upload-content-media'
import type { ConversationMediaUpload } from '@/features/chat/conversation-composer'

type RouteContext = Readonly<{
  params: Promise<{ workspaceId: string }>
}>

type Dependencies = Readonly<{
  upload: ConversationMediaUpload
}>

const workspaceIdSchema = z.string().uuid()

export function createWorkspaceMediaPostHandler(dependencies: Dependencies) {
  return async function post(request: Request, context: RouteContext): Promise<Response> {
    const { workspaceId: rawWorkspaceId } = await context.params
    const workspaceId = workspaceIdSchema.safeParse(rawWorkspaceId)
    if (!workspaceId.success) {
      return Response.json({ error: { message: '작업공간을 확인해 주세요.', requestId: 'conversation-media-upload' } }, { status: 400 })
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return Response.json({ error: { message: '이미지 요청을 확인해 주세요.', requestId: 'conversation-media-upload' } }, { status: 400 })
    }
    formData.set('workspaceId', workspaceId.data)
    const result = await dependencies.upload(formData)
    if (result.error) return Response.json({ error: result.error }, { status: 400 })
    return Response.json({ data: result.data })
  }
}

export const POST = createWorkspaceMediaPostHandler({ upload: uploadContentMediaAction })
