export const PRIVATE_SIGNED_URL_SECONDS = 60

export type PrivateStorageBucket = 'content-media' | 'knowledge-files' | 'profile-images'

type PrivatePathInput = {
  workspaceId: string
  userId: string
  resourceId: string
  filename: string
}

type SignedUrlClient = {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{
        data: { signedUrl: string } | null
        error: unknown
      }>
    }
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const filenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const nativeReflectApply = Reflect.apply
const nativeRegExpTest = RegExp.prototype.test
const nativeStringSplit = String.prototype.split

export function buildPrivateObjectPath(input: PrivatePathInput): string {
  let workspaceId: unknown
  let userId: unknown
  let resourceId: unknown
  let filename: unknown

  try {
    workspaceId = input.workspaceId
    userId = input.userId
    resourceId = input.resourceId
    filename = input.filename
  } catch {
    throw new Error('업로드 경로 식별자가 올바르지 않습니다.')
  }

  if (
    typeof workspaceId !== 'string' ||
    typeof userId !== 'string' ||
    typeof resourceId !== 'string' ||
    !safePatternTest(uuidPattern, workspaceId) ||
    !safePatternTest(uuidPattern, userId) ||
    !safePatternTest(uuidPattern, resourceId)
  ) {
    throw new Error('업로드 경로 식별자가 올바르지 않습니다.')
  }

  if (typeof filename !== 'string' || !safePatternTest(filenamePattern, filename)) {
    throw new Error('안전한 파일 이름을 사용해 주세요.')
  }

  return `${workspaceId}/${userId}/${resourceId}/${filename}`
}

export async function createPrivateSignedUrl(
  client: SignedUrlClient,
  bucket: PrivateStorageBucket,
  objectPath: string,
  expiresInSeconds = PRIVATE_SIGNED_URL_SECONDS,
): Promise<string> {
  const safeBucket: unknown = bucket
  const safeObjectPath: unknown = objectPath

  if (safeBucket !== 'content-media' && safeBucket !== 'knowledge-files' && safeBucket !== 'profile-images') {
    throw new Error('허용되지 않은 저장소입니다.')
  }

  if (
    typeof safeObjectPath !== 'string'
    || (safeBucket === 'profile-images'
      ? !isProfileImagePath(safeObjectPath)
      : safeBucket === 'content-media'
        ? !isContentMediaPath(safeObjectPath)
        : !isPrivateObjectPath(safeObjectPath))
  ) {
    throw new Error('파일 경로가 올바르지 않습니다.')
  }

  try {
    const storage = client.storage
    const from = storage.from
    const bucketClient = nativeReflectApply(from, storage, [safeBucket])
    const createSignedUrl = bucketClient.createSignedUrl
    const result = await nativeReflectApply(createSignedUrl, bucketClient, [
      safeObjectPath,
      expiresInSeconds,
    ])
    const data = result.data
    const error = result.error
    const signedUrl = data?.signedUrl

    if (error || typeof signedUrl !== 'string' || signedUrl.length === 0) {
      throw new Error('파일 열기 링크를 만들 수 없습니다.')
    }

    return signedUrl
  } catch {
    throw new Error('파일 열기 링크를 만들 수 없습니다.')
  }
}

function isContentMediaPath(value: string): boolean {
  const segments = nativeReflectApply(nativeStringSplit, value, ['/'])
  // 1) Legacy 4-segment: {workspaceId}/{userId}/{resourceId}/{filename}
  if (
    segments.length === 4 &&
    safePatternTest(uuidPattern, segments[0] ?? '') &&
    safePatternTest(uuidPattern, segments[1] ?? '') &&
    safePatternTest(uuidPattern, segments[2] ?? '') &&
    safePatternTest(filenamePattern, segments[3] ?? '')
  ) {
    return true
  }
  // 2) 4-segment direct: workspaces/{workspaceId}/media/{filename}
  if (
    segments.length === 4 &&
    segments[0] === 'workspaces' &&
    safePatternTest(uuidPattern, segments[1] ?? '') &&
    segments[2] === 'media' &&
    safePatternTest(filenamePattern, segments[3] ?? '')
  ) {
    return true
  }
  // 3) 6-segment canonical (ANI-1072): workspaces/{workspaceId}/media/{source|renditions}/{resourceId}/{filename}
  if (
    segments.length === 6 &&
    segments[0] === 'workspaces' &&
    safePatternTest(uuidPattern, segments[1] ?? '') &&
    segments[2] === 'media' &&
    (segments[3] === 'source' || segments[3] === 'renditions') &&
    safePatternTest(uuidPattern, segments[4] ?? '') &&
    safePatternTest(filenamePattern, segments[5] ?? '')
  ) {
    return true
  }
  return false
}

function isPrivateObjectPath(value: string): boolean {
  const segments = nativeReflectApply(nativeStringSplit, value, ['/'])
  return (
    segments.length === 4 &&
    safePatternTest(uuidPattern, segments[0] ?? '') &&
    safePatternTest(uuidPattern, segments[1] ?? '') &&
    safePatternTest(uuidPattern, segments[2] ?? '') &&
    safePatternTest(filenamePattern, segments[3] ?? '')
  )
}

function isProfileImagePath(value: string): boolean {
  const segments = nativeReflectApply(nativeStringSplit, value, ['/'])
  return (
    segments.length === 3
    && safePatternTest(uuidPattern, segments[0] ?? '')
    && safePatternTest(uuidPattern, segments[1] ?? '')
    && /^(?:avatar\.(?:jpg|png|webp))$/u.test(segments[2] ?? '')
  )
}

function safePatternTest(pattern: RegExp, value: string): boolean {
  return nativeReflectApply(nativeRegExpTest, pattern, [value])
}
