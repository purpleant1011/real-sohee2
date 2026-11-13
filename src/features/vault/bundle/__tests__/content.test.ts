import { describe, expect, it } from 'vitest'
import { composeCopyText, formatCopyTags, readVaultCopyContent, readVaultCopyFields } from '../content'

describe('보관 글 본문·제목·태그 읽기 (미리보기와 복사 번들이 함께 쓰는 단일 함수)', () => {
  it('제목은 앞뒤 공백만 정리하고, 본문은 한 글자도 바꾸지 않는다', () => {
    const body = '  첫 줄 앞 공백도 그대로\n\n\n빈 줄 세 개도 그대로  '
    expect(readVaultCopyFields({ title: '  제목  ', text: body })).toEqual({ title: '제목', body, tags: [] })
  })

  it('본문이 없으면 caption을 쓰고, 둘 다 없거나 payload가 없으면 빈 값으로 안전하게 읽는다', () => {
    expect(readVaultCopyFields({ caption: '캡션' }).body).toBe('캡션')
    expect(readVaultCopyFields({ text: '본문', caption: '캡션' }).body).toBe('본문')
    expect(readVaultCopyFields({})).toEqual({ title: null, body: '', tags: [] })
    expect(readVaultCopyFields(null)).toEqual({ title: null, body: '', tags: [] })
    expect(readVaultCopyFields(undefined)).toEqual({ title: null, body: '', tags: [] })
    expect(readVaultCopyFields({ title: '   ' }).title).toBeNull()
  })

  it('태그는 "#"와 공백을 정리하고 빈 태그와 문자열이 아닌 값은 버린다', () => {
    expect(readVaultCopyFields({ hashtags: ['#카페', '##가을', ' 신메뉴 ', '#', '##', '', '   ', 3, null, '# 띄어쓴태그'] }).tags).toEqual(['카페', '가을', '신메뉴', '띄어쓴태그'])
    expect(readVaultCopyFields({ hashtags: '카페' }).tags).toEqual([])
    expect(formatCopyTags(['카페', '가을'])).toBe('#카페 #가을')
    expect(formatCopyTags([])).toBe('')
  })

  it('채널별 복사 문구 형식: 네이버는 구역 표시, 당근은 제목으로 시작, 메타 채널은 제목 없이 본문과 태그', () => {
    const fields = { title: '제목', body: '본문', tags: ['태그'] }
    expect(composeCopyText('naver_blog', fields)).toBe('[제목]\n제목\n\n[본문]\n본문\n\n[태그]\n#태그')
    expect(composeCopyText('daangn_business', fields)).toBe('제목\n\n본문\n\n#태그')
    expect(composeCopyText('instagram', fields)).toBe('본문\n\n#태그')
    expect(composeCopyText('threads', fields)).toBe('본문\n\n#태그')
    expect(composeCopyText('instagram', { title: null, body: '본문', tags: [] })).toBe('본문')
    expect(composeCopyText('naver_blog', { title: null, body: '', tags: [] })).toBe('')
  })

  it('읽은 값과 만든 문구가 같은 입력에서 함께 나온다', () => {
    const content = readVaultCopyContent('naver_blog', { title: '제목', text: '본문', hashtags: ['#태그'] })
    expect(content).toEqual({ title: '제목', body: '본문', tags: ['태그'], formattedTags: '#태그', fullText: '[제목]\n제목\n\n[본문]\n본문\n\n[태그]\n#태그' })
  })
})
