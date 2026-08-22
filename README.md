# CODEPLANT 공개 프로그램 및 스킬

학교·교육기관에서 수정하여 사용할 수 있는 공개 프로그램과 Codex 스킬 모음입니다. 웹 시험 운영 예시, RDP 디스플레이 실행기, 한국어 문서 업무 스킬을 담았습니다.

> 공개판에는 특정 학교의 실제 시험문제, 학생 답안, 관리자 암호가 포함되어 있지 않습니다. 화면과 기능을 이해할 수 있도록 새로 만든 예시문제만 제공합니다.

## 바로 체험하기

- 학생 예시 화면: <https://codeplant-exam-platform.vercel.app/>
- 관리자 화면: <https://codeplant-exam-platform.vercel.app/admin>

관리자 암호는 공개 저장소에 적지 않습니다. 직접 배포할 때 Vercel의 `ADMIN_PIN` 환경변수로 설정하십시오.

## 들어 있는 항목

| 경로 | 내용 |
|---|---|
| `apps/exam-platform-vercel` | Vercel + Turso 기반 시험 운영 웹앱 |
| [`apps/rdp-display-launcher`](apps/rdp-display-launcher/README.md) | Tailscale 기반 Windows RDP 모니터 선택 실행기와 호스트 설정·원복 도구 |
| [`skills/codeplant-korean-workflows`](skills/codeplant-korean-workflows/README.md) | 실제 HWPX 생성·편집을 포함한 한국어 교육·학교·공공 문서 업무 통합 스킬 |
| [`skills/organize-meeting-minutes`](skills/organize-meeting-minutes/README.md) | 로컬 전사 우선 회의록 정리 스킬 |
| `docs/images` | 학생·관리자 실제 실행 화면 |

## 화면 미리보기

### 학생 입장

![학생 입장 화면](docs/images/student-login.png)

### 관리자 운영 화면

![관리자 운영 화면](docs/images/admin-dashboard.png)

### PART A·B·C 가이드 편집

![PART별 가이드 편집 화면](docs/images/admin-guide-editor.png)

### 문항 편집과 최종본 저장

![문항 편집 화면](docs/images/admin-question-editor.png)

## 주요 기능

- 실제 시험과 접속 테스트를 별도 프로젝트로 관리
- 시험 표지, 시간, 코드, 문항, 배점, 답안 칸을 관리자 화면에서 수정
- PART A·B·C별 가이드 추가·삭제와 모든 표시 이름 수정
- 공통자료 본문 구역과 자유 형식 표의 행·열 추가·삭제
- 학생 답안 자동 저장, 문항 이동, 제출, 초점 이탈 1회 경고·2회 실격
- 관리자 대기자 확인, 시험 시작·종료, 학생 상태 확인
- 학생별 답안 PDF와 전체 JSON 백업
- 모바일·아이패드 화면 대응

## RDP 디스플레이 실행기

[`apps/rdp-display-launcher`](apps/rdp-display-launcher/README.md)는 같은 Tailnet의 Windows PC에 기존 사용자 프로필로 접속하면서 단일·듀얼·3개 이상 모니터를 선택할 수 있게 해주는 공개 도구입니다.

- 실행할 때 `mstsc.exe /l`로 실제 RDP 모니터 ID 확인
- 모니터 번호를 직접 입력해 네이티브 RDP 다중 모니터 세션 실행
- 개인 Tailscale IPv4 또는 MagicDNS가 들어간 CODEPLANT EXE 생성
- RDP·NLA·방화벽·그래픽 정책 적용 전 상태 백업과 원복
- 공인 인터넷에 3389 포트를 열지 않고 Tailscale 내부 연결 사용

개인 주소와 계정이 들어간 완성 EXE는 공개하지 않습니다. README 절차에 따라 각 사용자가 자신의 실행기를 생성합니다.

## 방법 1: Codex로 실행하기

Codex에 아래처럼 요청하면 저장소 확인부터 로컬 실행 또는 Vercel 배포까지 진행할 수 있습니다.

```text
이 저장소의 README와 apps/exam-platform-vercel/.env.example을 읽고,
공개 예시 시험 웹앱을 로컬에서 실행해 검수해 줘.
실제 운영 배포가 필요하면 Vercel 프로젝트와 Turso 데이터베이스를 연결하되,
환경변수나 관리자 암호는 저장소에 커밋하지 말고 배포 후 학생/관리자 화면을 확인해 줘.
```

Vercel 배포까지 요청할 때는 Codex가 외부 서비스 약관 승인이나 로그인을 요구할 수 있습니다. 그 단계만 사용자가 직접 승인하면 나머지 검수와 배포를 이어갈 수 있습니다.

## 방법 2: GitHub에서 받아 직접 실행하기

### 준비물

- Node.js 20.9 이상
- Git
- 로컬 실행만 할 경우 별도 데이터베이스 계정은 필요하지 않음
- 인터넷에 배포할 경우 Vercel 계정과 Turso 데이터베이스

### 로컬 실행

```powershell
git clone https://github.com/CodeplantEDU/codeplant-public-programs-and-skills.git
cd codeplant-public-programs-and-skills/apps/exam-platform-vercel
npm install
Copy-Item .env.example .env.local
```

`.env.local`을 다음처럼 수정합니다.

```dotenv
TURSO_DATABASE_URL=file:local.db
ADMIN_PIN=YOUR_4_TO_12_DIGIT_PIN
```

관리자 암호는 숫자 4~12자리로 바꾸십시오. 그다음 실행합니다.

```powershell
npm run dev
```

- 학생 화면: `http://localhost:3000`
- 관리자 화면: `http://localhost:3000/admin`
- 기본 시험코드: `AI2026`

### Vercel 배포

1. `apps/exam-platform-vercel` 폴더를 Vercel 프로젝트로 연결합니다.
2. Vercel Marketplace에서 Turso 데이터베이스를 연결합니다.
3. Vercel 프로젝트 환경변수에 `ADMIN_PIN`을 숫자 4~12자리로 추가합니다.
4. Production으로 배포합니다.

CLI를 사용할 때의 예시는 다음과 같습니다.

```powershell
cd apps/exam-platform-vercel
npx vercel link
npx vercel integration add tursocloud/database --plan starter -e production -e preview -e development
npx vercel env add ADMIN_PIN production --sensitive
npx vercel --prod
```

Turso 연동 시 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`은 연동이 완료된 Vercel 프로젝트에 자동으로 제공됩니다. 비밀값은 `.env.local`이나 Vercel 환경변수에만 두고 GitHub에 커밋하지 마십시오.

## 관리자 사용 순서

1. 관리자 화면에서 접속 테스트 프로젝트를 선택합니다.
2. 학생들이 접속 테스트 대기자 목록에 모두 보이는지 확인합니다.
3. 접속 테스트를 시작하고 입력·문항 이동·제출을 확인한 뒤 테스트를 종료합니다.
4. 실제 시험 프로젝트를 선택하고 표지, 시간, 문항, 가이드, 공통자료를 저장합니다.
5. 실제 시험 대기자를 모두 확인한 후 `실제 시험 시작`을 누릅니다.
6. 시험이 끝나면 `시험 종료`를 누릅니다.
7. `전체 답안 PDF`를 내려받고 `JSON 백업`도 함께 보관합니다.

## 학생 유의사항

- 문항 번호를 누르면 해당 문항으로 이동합니다.
- 답안은 입력 중 자동 저장됩니다.
- 시험 페이지 밖의 화면이나 다른 앱을 누르면 초점 이탈로 기록될 수 있습니다.
- F5, 브라우저 새로고침, 모바일 화면을 아래로 당겨 새로고침하는 동작을 하지 않습니다.
- 마지막 문항까지 확인한 뒤 `최종 제출`을 누릅니다.

## 초점 이탈 감지와 실격 규칙

관리자 화면의 `이탈 1회 경고·2회 실격` 설정을 켜면 다음과 같이 작동합니다.

1. 학생이 다른 앱·탭으로 전환해 시험 페이지가 숨겨지거나, 시험 창 밖을 클릭해 브라우저 초점을 잃거나, 페이지를 종료·새로고침하면 이탈 이벤트를 서버에 기록합니다.
2. 첫 번째 유효한 이탈은 학생 화면에 `초점 이탈 경고 1회입니다.`라는 안내를 표시하고 계속 응시하게 합니다.
3. 두 번째 유효한 이탈은 학생 상태를 `실격`으로 바꾸고 답안 입력과 제출을 중지합니다.
4. 관리자 화면에는 학생별 이탈 횟수와 최근 이탈·복귀 기록이 표시됩니다. 감독자는 필요한 경우 `실격 취소`로 응시를 복구할 수 있습니다.
5. 화면 숨김과 창 초점 이탈이 거의 동시에 발생하면 같은 동작을 여러 번 세지 않도록 3초 이내 중복 이벤트를 한 번으로 처리합니다.

엄격 모드를 끄면 이탈 횟수와 관리자 로그는 남지만 두 번째 이탈을 자동 실격으로 바꾸지 않습니다. 규칙은 시험 대기 상태에서만 변경할 수 있습니다.

> 브라우저의 초점·가시성 이벤트를 이용하는 감독 보조 기능입니다. 다른 기기 사용을 탐지하거나 운영체제 수준에서 앱 실행을 차단하는 기능은 아닙니다. iPad의 안내 접근, MDM, 현장 감독을 함께 사용해야 강한 통제가 가능합니다.

## Codex 스킬 설치

필요한 스킬 폴더를 사용자의 Codex 스킬 폴더로 복사합니다.

```powershell
Copy-Item skills/codeplant-korean-workflows "$HOME/.codex/skills/codeplant-korean-workflows" -Recurse
Copy-Item skills/organize-meeting-minutes "$HOME/.codex/skills/organize-meeting-minutes" -Recurse
```

사용 예시:

```text
$codeplant-korean-workflows 를 사용해서 이 HWPX 교육결과보고서를 원본 양식을 보존해 작성하고 검증해 줘.
```

```text
$organize-meeting-minutes 를 사용해서 첨부 녹음을 로컬에서 전사한 뒤 회의별 결정사항과 액션 아이템을 정리해 줘.
```

## 보안과 운영상 한계

웹의 초점 이탈 감지는 감독을 돕는 기록 기능입니다. 브라우저만으로 다른 기기 사용이나 모든 부정행위를 완전히 차단할 수는 없습니다. 중요한 시험은 현장 감독, 아이패드 사용법 사전 안내, 네트워크 점검, 접속 테스트를 함께 운영하십시오.

실제 시험문제를 공개 저장소에 넣지 마십시오. 운영 기관은 비공개 저장소 또는 관리자 화면에서 별도로 입력하고, 시험 전 PDF·JSON 백업과 복구 절차를 확인해야 합니다.

## 검증

```powershell
cd apps/exam-platform-vercel
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## 라이선스

코드는 [MIT License](LICENSE)로 공개합니다. 로고와 브랜드 자산의 상표권은 각 권리자에게 있습니다.
