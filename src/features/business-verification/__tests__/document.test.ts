import { describe, expect, it } from 'vitest'
import {
  BUSINESS_DOCUMENT_BUCKET,
  buildBusinessDocumentPath,
  isOwnBusinessDocumentPath,
  validateBusinessDocument,
} from '../document'

const WS = '3f1c2b4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'
const OTHER_WS = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const FILE_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'

function createFile(bytes: number[], type: string): File {
  const data = new Uint8Array(bytes)
  return {
    name: 'license',
    type,
    size: data.byteLength,
    arrayBuffer: async () => data.slice().buffer,
    slice: (start = 0, end = data.byteLength) => ({
      arrayBuffer: async () => data.slice(start, end).buffer,
    }),
  } as unknown as File
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]

describe('validateBusinessDocument', () => {
  it('PDF를 허용하고 확장자 pdf로 돌려준다', async () => {
    expect(await validateBusinessDocument(createFile(PDF, 'application/pdf'))).toEqual({
      ok: true,
      ext: 'pdf',
      contentType: 'application/pdf',
    })
  })

  it('PNG, JPEG 사진을 허용한다', async () => {
    expect(await validateBusinessDocument(createFile(PNG, 'image/png'))).toMatchObject({ ok: true, ext: 'png' })
    expect(await validateBusinessDocument(createFile(JPEG, 'image/jpeg'))).toMatchObject({ ok: true, ext: 'jpg' })
  })

  it('텍스트 파일은 사업자등록증으로 받지 않는다', async () => {
    const text = [...new TextEncoder().encode('안녕하세요')]
    const result = await validateBusinessDocument(createFile(text, 'text/plain'))
    expect(result).toEqual({ ok: false, message: '사업자등록증은 PDF 또는 사진(JPG, PNG) 파일만 올릴 수 있어요.' })
  })

  it('선언한 형식과 파일 내용이 다르면 거절한다', async () => {
    const result = await validateBusinessDocument(createFile(PNG, 'application/pdf'))
    expect(result.ok).toBe(false)
  })
})

describe('business document path', () => {
  it('워크스페이스 폴더 아래 uuid 파일명으로 만든다', () => {
    expect(buildBusinessDocumentPath(WS, 'pdf', FILE_ID)).toBe(`${WS}/${FILE_ID}.pdf`)
  })

  it('버킷 이름이 고정되어 있다', () => {
    expect(BUSINESS_DOCUMENT_BUCKET).toBe('business-documents')
  })

  it('자기 워크스페이스 경로만 소유로 인정한다', () => {
    expect(isOwnBusinessDocumentPath(`${WS}/${FILE_ID}.png`, WS)).toBe(true)
    expect(isOwnBusinessDocumentPath(`${OTHER_WS}/${FILE_ID}.png`, WS)).toBe(false)
  })

  it('경로 조작과 이상한 입력을 거절한다', () => {
    expect(isOwnBusinessDocumentPath(`${WS}/../${OTHER_WS}/${FILE_ID}.png`, WS)).toBe(false)
    expect(isOwnBusinessDocumentPath(`${WS}/${FILE_ID}.exe`, WS)).toBe(false)
    expect(isOwnBusinessDocumentPath(undefined, WS)).toBe(false)
    expect(isOwnBusinessDocumentPath(`${WS}/${FILE_ID}.pdf`, 'not-a-uuid')).toBe(false)
  })
})
