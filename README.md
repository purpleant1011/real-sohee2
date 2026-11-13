# real-sohee2

소상공인을 위한 AI 마케팅 에이전트 "소희"의 공개용 소스코드입니다. (Next.js + Supabase + Cloudflare Workers)

> 이 저장소는 비공개 운영 저장소의 Git 이력을 가져오지 않고, 검증을 거친 소스만 새로 정리해 공개한 것입니다.
> 운영 계정·고객 정보·인증정보·내부 QA 증거물은 포함하지 않으며, 모든 식별자는 예시 값입니다.

## 시작하기

```bash
cp .env.example .env.local   # 본인의 Supabase/외부 서비스 값을 채우세요
npm install
npm run dev
```

## 설정 안내
- `.env.example`, `wrangler.jsonc`의 `your-project-ref`, `YOUR_CLOUDFLARE_ACCOUNT_ID`, `example.com` 등은 반드시 본인 값으로 교체하세요.
- 비밀값(서비스 키, 토큰, 비밀번호)은 절대 저장소에 커밋하지 마세요.

## 라이선스
별도 라이선스를 지정하기 전까지 모든 권리는 저작권자에게 있습니다.
