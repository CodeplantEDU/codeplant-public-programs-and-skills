# 코드플랜트 한글 업무 통합 스킬

한국어 교육·학교·공공 문서를 사실에 근거해 작성하고, 실제 한글 HWPX 파일까지 생성·읽기·편집·검증하는 Codex 스킬입니다.

## 지원 기능

- 새 `.hwpx` 문서 생성
- 기존 `.hwpx`를 원본과 분리해 문구 치환 편집
- HWPX 모든 구역의 본문 텍스트 추출
- ZIP·OWPML XML 구조 검증
- 설치된 한컴오피스에서 실제 열기 검사
- 학교 보고서, 교육과정, 제안서, 제품 사양서 작성
- 생기부·세특·학생 활동 기록 작성
- 학생 연구보고서·논문 피드백과 평가
- 기존 양식, 표, 빈 사진 위치, 서명란 보존 원칙 적용

## 설치

저장소를 받은 뒤 스킬 폴더를 Codex 스킬 위치에 복사합니다.

```powershell
git clone https://github.com/CodeplantEDU/codeplant-public-programs-and-skills.git
Copy-Item `
  -LiteralPath .\codeplant-public-programs-and-skills\skills\codeplant-korean-workflows `
  -Destination "$HOME\.codex\skills\codeplant-korean-workflows" `
  -Recurse
```

Codex를 새로 시작하면 `$codeplant-korean-workflows`로 호출할 수 있습니다.

## HWPX 작업 환경

- Windows 10 또는 11
- Python 3.10 이상
- 한컴오피스 한글 설치본
- `HWPFrame.HwpObject` 자동화 인터페이스

외부 Python 패키지는 필요하지 않습니다. HWPX 도구는 Python 표준 라이브러리와 사용자의 로컬 한컴오피스를 사용합니다.

```powershell
cd "$HOME\.codex\skills\codeplant-korean-workflows"
python .\scripts\hwpx_native.py --help
```

## Codex 사용 예시

새 문서를 만들 때:

```text
$codeplant-korean-workflows 중학생 대상 생성형 AI 4차시 교육계획안을 작성하고
실제 한글에서 열리는 HWPX 파일로 만들어줘.
```

기존 양식을 편집할 때:

```text
$codeplant-korean-workflows 첨부한 HWPX 양식의 표와 서명란은 유지하고
교육 내용을 입력해 새 파일로 저장해줘. 구조 검사와 한글 열기 검사도 해줘.
```

학생 기록이나 연구 피드백을 작성할 때:

```text
$codeplant-korean-workflows 학생이 실제로 수행한 내용만 사용해 세특을 작성해줘.
확인되지 않은 역할이나 성과는 만들지 마.
```

## 명령줄에서 HWPX 생성

```powershell
python .\scripts\hwpx_native.py create `
  --output .\교육계획안.hwpx `
  --title "생성형 AI 교육계획안" `
  --body-file .\examples\body.example.txt

python .\scripts\hwpx_native.py validate --input .\교육계획안.hwpx
python .\scripts\hwpx_native.py open-test --input .\교육계획안.hwpx
```

## 명령줄에서 기존 HWPX 편집

`examples/replacements.example.json`처럼 원문과 새 문구를 작성합니다.

```powershell
python .\scripts\hwpx_native.py replace `
  --input .\원본양식.hwpx `
  --output .\수정본.hwpx `
  --replacements .\examples\replacements.example.json

python .\scripts\hwpx_native.py extract --input .\수정본.hwpx
python .\scripts\hwpx_native.py validate --input .\수정본.hwpx
python .\scripts\hwpx_native.py open-test --input .\수정본.hwpx
```

## 편집 범위와 주의사항

- `create`는 제목과 본문 중심의 기본 HWPX를 실제 한글에서 생성합니다.
- `replace`는 한글 프로그램의 전체 찾아 바꾸기를 사용해 원본 서식을 유지하면서 정확한 문구를 바꿉니다.
- 원본은 덮어쓰지 않고 새 출력 경로를 사용합니다.
- 셀 병합, 표 구조 변경, 도형·이미지 재배치 같은 복잡한 구조 편집은 별도 자동화와 페이지별 검수가 필요합니다.
- `validate` 성공만으로 화면 배치를 보장할 수 없습니다. `open-test`와 PDF·이미지 육안 검사를 함께 수행해야 합니다.
- 바이너리 `.hwp` 직접 편집은 지원 범위가 아니며 기본 산출물은 `.hwpx`입니다.

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `SKILL.md` | Codex가 읽는 작업 지침과 유형별 라우팅 |
| `scripts/hwpx_native.py` | HWPX 생성·추출·치환·검증·열기 도구 |
| `scripts/hancom_open_test.ps1` | 한컴오피스 실제 열기 단독 검사 |
| `references/` | HWPX, 생기부, 연구 피드백, 교육·공공 문서 세부 기준 |
| `examples/` | 새 문서 본문과 문구 치환 JSON 예시 |

## 완료 기준

한글 문서는 다음 조건을 모두 만족해야 완성본입니다.

1. 요청된 내용이 실제 `.hwpx` 파일에 저장됨
2. 원본 파일이 보존됨
3. `validate`가 `VALID`를 출력함
4. `open-test`가 `HANCOM_OPEN_OK`를 출력함
5. 복잡한 양식은 PDF 또는 이미지로 페이지별 검수함

## 라이선스와 출처

저장소의 자체 작성 파일은 루트의 MIT License를 따릅니다. 외부 프로젝트의 코드나 템플릿은 포함하지 않았으며 자세한 내용은 `references/attribution.md`에 기록했습니다.
