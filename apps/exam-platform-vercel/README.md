# CODEPLANT Exam Platform for Vercel

공개 예시문제로 구성된 Next.js 시험 운영 웹앱입니다. 자세한 설치, 배포, 관리자·학생 사용법은 저장소 루트의 [README](../../README.md)를 참고하세요.

## 빠른 실행

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

로컬 파일 데이터베이스를 사용할 때는 `.env.local`에 다음 값을 설정합니다.

```dotenv
TURSO_DATABASE_URL=file:local.db
ADMIN_PIN=YOUR_4_TO_12_DIGIT_PIN
```

## 검사

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```
