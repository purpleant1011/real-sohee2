import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
const source=readFileSync('public/sw.js','utf8')
describe('actual SW handler payload privacy',()=>{
 it('알 수 없는 kind와 query 원문을 notification tag/data로 보존하지 않는다',async()=>{
  const handlers:Record<string,(event:any)=>void>={};const showNotification=vi.fn().mockResolvedValue(undefined)
  runInNewContext(source,{self:{location:{origin:'https://example.com'},addEventListener:(kind:string,fn:any)=>{handlers[kind]=fn},registration:{showNotification}},URL})
  let work:Promise<unknown>=Promise.resolve();handlers.push({data:{json:()=>({kind:'private-customer-name',path:'/app/inbox?raw_dm=private-message',customer:'private-customer-name'})},waitUntil:(promise:Promise<unknown>)=>{work=promise}});await work
  expect(showNotification).toHaveBeenCalledOnce();const args=showNotification.mock.calls[0];expect(args[1]).toMatchObject({tag:'sohee-default',data:{path:'/app/inbox'}});expect(JSON.stringify(args)).not.toMatch(/private-customer|private-message/)
 })
})
