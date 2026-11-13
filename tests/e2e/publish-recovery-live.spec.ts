import { expect, test } from '@playwright/test'

const email=process.env.E2E_AUTH_EMAIL,password=process.env.E2E_AUTH_PASSWORD
const contentId='80000000-0000-4000-8000-000000000001'

test('creates, approves, schedules, fails, and safely retries one mock publication',async({page})=>{
 test.skip(!email||!password,'실제 Supabase Auth 테스트 계정이 설정된 환경에서 실행합니다.')
 await page.goto(`/login?next=${encodeURIComponent(`/app/work/${contentId}/edit`)}`)
 await page.getByLabel('이메일').fill(email!);await page.getByLabel('비밀번호').fill(password!);await page.getByRole('button',{name:'이메일로 로그인'}).click()

 await expect(page.getByRole('heading',{name:/현재 v3에서 새 버전 만들기/})).toBeVisible()
 await page.getByLabel('본문 문구').fill('모의 게시 복구를 검증할 네 번째 실제 문구')
 await page.getByLabel('수정 이유').fill('모의 게시 실패와 안전한 재시도를 검증합니다.')
 await page.getByLabel(/PNG · 8 B/).check();await page.getByLabel('미디어 사용권을 확인했습니다.').check();await page.getByLabel('생성 과정과 근거를 확인했습니다.').check();await page.getByRole('button',{name:'새 버전으로 저장'}).click()

 await expect(page.getByRole('heading',{name:'현재 v4'})).toBeVisible()
 await page.getByLabel('본문·해시태그·고지를 최종 확인했습니다.').check();await page.getByLabel('연결된 미디어의 사용권을 최종 확인했습니다.').check();await page.getByLabel('생성 과정과 근거를 최종 확인했습니다.').check();await page.getByLabel('검토 사유').fill('모의 게시 복구용 최신 버전을 승인합니다.');await page.getByRole('button',{name:'v4 최종 승인'}).click()
 await expect(page.getByText('승인 완료')).toBeVisible()

 await page.goto('/app/schedule');await page.getByLabel('연결 채널').selectOption({label:'모의 인스타그램 계정'});await page.getByLabel('예약 시각').fill('2026-08-12T18:00');await page.getByRole('button',{name:'일정 예약'}).click();await expect(page.getByText('예약됨')).toBeVisible()

 await page.getByLabel('모의 결과').selectOption('temporary_network');await page.getByRole('button',{name:'모의 게시 실행'}).click()
 await expect(page.getByText(/일시적인 연결 문제/)).toBeVisible();await expect(page.getByRole('button',{name:'성공으로 다시 시도'})).toBeVisible()
 await page.getByRole('button',{name:'성공으로 다시 시도'}).click()
 await expect(page.getByText(/외부 전송 없이 모의 게시 성공/)).toBeVisible()
 await expect(page.getByText('published')).toBeVisible()
})
