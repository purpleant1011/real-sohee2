import { describe, expect, it } from 'vitest'
import { buildChannelCopyText } from './channel-copy'

describe('buildChannelCopyText', () => {
  describe('instagram', () => {
    it('캡션과 해시태그를 빈 줄로 연결한다', () => {
      const text = buildChannelCopyText('instagram', {
        caption: '안녕하세요! 우리 가게입니다.',
        hashtags: ['카페', '#디저트', '  맛집  '],
      })
      expect(text).toBe('안녕하세요! 우리 가게입니다.\n\n#카페 #디저트 #맛집')
    })

    it('해시태그가 없으면 캡션만 반환한다', () => {
      const text = buildChannelCopyText('instagram', {
        caption: '캡션만 있는 글',
      })
      expect(text).toBe('캡션만 있는 글')
    })

    it('caption 대신 text가 제공되어도 동작한다', () => {
      const text = buildChannelCopyText('instagram', {
        text: '대체 본문',
        hashtags: ['소통'],
      })
      expect(text).toBe('대체 본문\n\n#소통')
    })

    it('빈 payload일 때 빈 문자열을 반환한다', () => {
      expect(buildChannelCopyText('instagram', null)).toBe('')
    })
  })

  describe('threads', () => {
    it('text를 반환한다 (해시태그는 포함하지 않음)', () => {
      const text = buildChannelCopyText('threads', {
        text: '스레드에 올릴 짧은 이야기입니다.',
        hashtags: ['일상'],
      })
      expect(text).toBe('스레드에 올릴 짧은 이야기입니다.')
    })

    it('text가 없으면 caption을 폴백으로 사용한다', () => {
      const text = buildChannelCopyText('threads', {
        caption: '대체 본문 이야기',
      })
      expect(text).toBe('대체 본문 이야기')
    })
  })

  describe('naver_blog', () => {
    it('제목, 본문, 해시태그를 빈 줄로 결합한다', () => {
      const text = buildChannelCopyText('naver_blog', {
        title: '신메뉴 출시 안내',
        text: '이번 주부터 딸기 케이크를 판매합니다.',
        hashtags: ['케이크', '딸기'],
      })
      expect(text).toBe('신메뉴 출시 안내\n\n이번 주부터 딸기 케이크를 판매합니다.\n\n#케이크 #딸기')
    })

    it('blocks가 있으면 blocks 순서대로 본문을 구성한다', () => {
      const text = buildChannelCopyText('naver_blog', {
        title: '블로그 포스팅',
        blocks: [
          { type: 'paragraph', text: '첫 번째 문단입니다.' },
          { type: 'paragraph', text: '두 번째 문단입니다.' },
        ],
        hashtags: ['블로그'],
      })
      expect(text).toBe('블로그 포스팅\n\n첫 번째 문단입니다.\n\n두 번째 문단입니다.\n\n#블로그')
    })
  })

  describe('daangn_business', () => {
    it('첫 줄 강조와 본문을 빈 줄로 연결한다', () => {
      const text = buildChannelCopyText('daangn_business', {
        firstLineHighlight: '🍓 딸기 케이크 출시!',
        text: '이웃 주민 여러분 안녕하세요.',
      })
      expect(text).toBe('🍓 딸기 케이크 출시!\n\n이웃 주민 여러분 안녕하세요.')
    })

    it('firstLineHighlight 대신 title이 있으면 title을 사용한다', () => {
      const text = buildChannelCopyText('daangn_business', {
        title: '동네 소식 알림',
        text: '본문 내용입니다.',
      })
      expect(text).toBe('동네 소식 알림\n\n본문 내용입니다.')
    })

    it('강조가 없으면 본문만 반환한다', () => {
      const text = buildChannelCopyText('daangn_business', {
        text: '본문 내용만 있습니다.',
      })
      expect(text).toBe('본문 내용만 있습니다.')
    })
  })
})
