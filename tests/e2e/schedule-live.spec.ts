import { expect,test } from '@playwright/test'
const email=process.env.E2E_AUTH_EMAIL,password=process.env.E2E_AUTH_PASSWORD
test.describe.configure({ mode: 'serial' })

async function login(page: import('@playwright/test').Page) {
  test.skip(!email||!password,'실제 Supabase Auth 테스트 계정이 설정된 환경에서 실행합니다.')
  await page.goto('/login?next=%2Fapp%2Fschedule')
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button',{name:'이메일로 로그인'}).click()
  await expect(page.getByRole('heading',{name:'일정',exact:true})).toBeVisible()
}

test('schedules the approved exact version with a clear local timezone',async({page})=>{
  await login(page)
  await expect(page.getByText(/이번 주 · 다가오는 30일 · Asia\/Seoul/)).toBeVisible()
  await page.getByLabel('연결 채널').selectOption({label:'모의 인스타그램 계정'})
  await page.getByLabel('예약 시각').fill('2026-08-10T18:00')
  await page.getByRole('button',{name:'일정 예약'}).click()
  await expect(page.getByText('예약됨')).toBeVisible()
  await expect(page.getByText(/2026년 8월 10일/)).toBeVisible()
  await expect(page.getByText(/Asia\/Seoul/).last()).toBeVisible()
})

test('changes and cancels the same scheduled record without losing the approved version',async({page})=>{
  await login(page)
  await page.getByLabel('변경할 시각').fill('2026-08-11T19:30')
  await page.getByRole('button',{name:'시각 변경'}).click()
  await expect(page.getByText('예약 시각을 변경했습니다.')).toBeVisible()
  await expect(page.getByText(/2026년 8월 11일/)).toBeVisible()
  await page.getByRole('button',{name:'예약 취소'}).click()
  await expect(page.getByText(/예약을 취소했습니다/)).toBeVisible()
  await expect(page.getByText('취소됨')).toBeVisible()
  await expect(page.getByRole('button',{name:'일정 예약'})).toBeVisible()
})
