import 'server-only'

const MAX_BYTES = 6 * 1024 * 1024
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp']

export type LoadedReferenceImage = Readonly<{ bytes: Uint8Array; mimeType: string }>

type Row = {
  id: string
  bucket_id: string
  object_path: string
  mime_type: string
  size_bytes: number
  workspace_id?: string
  rights_status?: string
}

type QueryFilter = {
  eq(column: string, value: string): QueryFilter
  in(column: string, values: string[]): PromiseLike<{ data: Row[] | null; error: unknown }>
}

type AdminLike = Readonly<{
  from(table: string): { select(columns: string): QueryFilter }
  storage: { from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: unknown }> } }
}>

/** 확인된 작업공간 소유 참고 사진만 읽는다. 못 읽은 사진은 제외하며, 호출자는 요청 수와 결과 수를 비교해 누락 시 생성을 중단한다. */
export async function loadReferenceImages(
  admin: unknown,
  workspaceId: string,
  assetIds: readonly string[],
): Promise<LoadedReferenceImage[]> {
  if (assetIds.length === 0) return []
  try {
    const client = admin as AdminLike
    const rows = await client.from('media_assets')
      .select('id, bucket_id, object_path, mime_type, size_bytes, workspace_id, rights_status')
      .eq('workspace_id', workspaceId)
      .eq('rights_status', 'confirmed')
      .in('id', [...assetIds])
    if (rows.error || !rows.data) return []
    const byId = new Map(rows.data.map((row) => [row.id, row]))
    const loaded: LoadedReferenceImage[] = []
    for (const id of assetIds) {
      const row = byId.get(id)
      if (!row || !ALLOWED.includes(row.mime_type) || row.size_bytes > MAX_BYTES) continue
      if (row.workspace_id && row.workspace_id !== workspaceId) continue
      if (row.rights_status && row.rights_status !== 'confirmed') continue
      const file = await client.storage.from(row.bucket_id).download(row.object_path)
      if (file.error || !file.data) continue
      loaded.push({ bytes: new Uint8Array(await file.data.arrayBuffer()), mimeType: row.mime_type })
    }
    return loaded
  } catch {
    return []
  }
}
