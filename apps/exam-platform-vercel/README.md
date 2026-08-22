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

## 초점 이탈 기능

- 다른 앱·탭 전환으로 시험 페이지가 숨겨지는 경우를 기록합니다.
- 시험 창 밖 클릭으로 브라우저 초점을 잃고 300ms 안에 복귀하지 않는 경우를 기록합니다.
- 페이지 종료와 새로고침 과정의 `pagehide` 이벤트를 기록합니다.
- 화면 숨김과 초점 이탈 등이 3초 안에 연달아 발생하면 한 번으로 계산합니다.
- 엄격 모드에서는 1회 이탈 시 학생에게 경고하고, 2회 이탈 시 자동 실격 처리합니다.
- 엄격 모드를 꺼도 이탈 횟수와 관리자 활동 로그는 계속 저장합니다.
- 관리자 화면에서 학생별 이탈 횟수 확인과 실격 취소가 가능합니다.

이 기능은 브라우저 이벤트 기반 감독 보조 장치입니다. 다른 기기 사용이나 모든 부정행위를 탐지하거나 운영체제 수준에서 다른 앱을 차단하지는 않습니다.

## 검사

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```
