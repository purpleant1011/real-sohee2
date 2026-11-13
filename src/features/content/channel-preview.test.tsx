import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChannelPreview } from './channel-preview'
const id='10000000-0000-4000-8000-000000000001'
describe('ChannelPreview',()=>{
 it('renders channel-native structures',()=>{
  const {rerender}=render(<ChannelPreview content={{channel:'naver_blog',title:'블로그 제목',introduction:'도입',sections:[{heading:'첫 구역',body:'본문'}],keywords:['키워드'],imagePlacements:[{mediaId:id,placement:'cover',altText:'표지'}],cta:'문의'}} />)
  expect(screen.getByRole('heading',{name:'블로그 제목'})).toBeVisible(); expect(screen.getByRole('heading',{name:'첫 구역'})).toBeVisible(); expect(screen.getByRole('listitem',{name:'이미지 1: 표지'})).toBeVisible()
  rerender(<ChannelPreview content={{channel:'daangn_business',title:'동네 소식',body:'본문',mediaIds:[id],localCta:'채팅 문의',targetNeighborhood:'청라동'}} />)
  expect(screen.getByText('청라동')).toBeVisible(); expect(screen.getByText('채팅 문의')).toBeVisible()
 })
 it('renders rich Naver blocks in the exact approved order',()=>{
  const second='10000000-0000-4000-8000-000000000002'
  const {container}=render(<ChannelPreview content={{
   channel:'naver_blog',title:'상세 후기',introduction:'도입',sections:[{heading:'구역',body:'본문'}],keywords:['키워드'],
   imagePlacements:[{mediaId:id,placement:'cover',altText:'표지'},{mediaId:second,placement:'detail',altText:'상세'}],
   editorBlocks:[
    {kind:'paragraph',text:'첫 문단'},{kind:'image',mediaId:id,altText:'표지'},
    {kind:'quote',text:'중요한 기준'},{kind:'link',url:'https://example.com/guide',title:'안내 보기'},
    {kind:'image',mediaId:second,altText:'상세'},{kind:'cta',text:'문의'},
   ],cta:'문의',
  }} />)
  expect([...container.querySelectorAll('[data-naver-block]')].map((node)=>node.getAttribute('data-naver-block')))
   .toEqual(['paragraph','image','quote','link','image','cta'])
  expect(screen.getByRole('link',{name:'안내 보기'})).toHaveAttribute('href','https://example.com/guide')
 })
})
