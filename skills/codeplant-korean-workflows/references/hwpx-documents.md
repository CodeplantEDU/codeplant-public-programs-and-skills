# HWPX 문서 작업

## 지원 범위

이 스킬은 자체 포함된 `../scripts/hwpx_native.py`를 통해 실제 HWPX 파일을 다룬다.

| 작업 | 명령 | 결과 |
|---|---|---|
| 새 문서 생성 | `create` | 설치된 한글이 저장한 새 `.hwpx` |
| 내용 읽기 | `extract` | 모든 section XML의 문단 텍스트 |
| 기존 문서 편집 | `replace` | 원본을 보존하고 정확한 문구를 치환한 새 `.hwpx` |
| 구조 검사 | `validate` | ZIP·mimetype·필수 파일·XML 파싱 검사 |
| 실제 열기 | `open-test` | 한컴오피스 자동화로 열기 성공 여부 확인 |

필요 환경은 Windows, Python 3.10 이상, 한컴오피스 한글이다. 바이너리 `.hwp`를 직접 생성·수정하지 않고 기본 결과는 `.hwpx`로 만든다.

## 새 문서 생성

```powershell
python scripts/hwpx_native.py create `
  --output 결과.hwpx `
  --title "생성형 AI 교육계획" `
  --body-file examples/body.example.txt

python scripts/hwpx_native.py validate --input 결과.hwpx
python scripts/hwpx_native.py open-test --input 결과.hwpx
```

`create`는 제목과 여러 문단으로 구성된 기본 HWPX 생성에 적합하다. 복잡한 기관 양식이 필요하면 새 문서로 재구성하지 말고 사용자가 제공한 HWPX를 편집한다.

## 기존 HWPX 편집

정확하고 중복되지 않는 원문과 새 문구를 UTF-8 JSON으로 준비한다.

```powershell
python scripts/hwpx_native.py replace `
  --input 원본양식.hwpx `
  --output 수정본.hwpx `
  --replacements examples/replacements.example.json

python scripts/hwpx_native.py extract --input 수정본.hwpx
python scripts/hwpx_native.py validate --input 수정본.hwpx
python scripts/hwpx_native.py open-test --input 수정본.hwpx
```

문구 치환은 한컴오피스가 문서를 열고 새 HWPX로 저장하는 방식이다. 표 구조를 보존하는 짧은 필드 수정에 적합하지만 셀 병합, 쪽 구조 변경, 도형 배치 같은 구조 편집을 자동으로 보장하지 않는다. 그런 변경은 한컴 자동화 동작을 별도로 구현하고 원본과 페이지별로 비교해야 한다.

## 보존 기준

- 원본 파일을 직접 덮어쓰지 않는다.
- 표의 행·열, 셀 병합, 쪽 방향, 여백, 머리말·꼬리말, 서명란, 빈 사진 위치를 먼저 확인한다.
- 사용자가 제외하라고 한 영역은 채우지 않는다.
- 기존 값이 확정된 칸은 사용자의 새 지시가 없으면 유지한다.

## 작성 기준

- 입력 자료와 양식 칸을 대응시키는 매핑을 먼저 만든다.
- 값이 없으면 임의 문구로 채우지 말고 빈칸 또는 `[확인 필요]`를 사용한다.
- 반복 항목을 한 문단에 합치지 말고 양식의 반복 구조를 유지한다.
- 표 안의 긴 문장은 실제 셀 폭에 맞게 축약하거나 줄바꿈한다.

## 필수 검증

1. 결과 HWPX가 ZIP/OWPML 구조로 정상인지 검사한다.
2. 요청한 문자열이 들어갔고 금지 문자열이 없는지 검사한다.
3. 한컴오피스에서 실제 열기 검사를 수행한다.
4. PDF 또는 이미지로 렌더하여 잘림, 겹침, 빈 페이지, 표 넘침을 확인한다.
5. 검증된 결과 파일만 완성본으로 전달한다.

DOCX에서 HWPX로 옮길 때는 서식 손실 가능성을 알리고 표·쪽 구성을 별도로 재검사한다.

외부 코드나 템플릿을 추가할 때는 [attribution.md](attribution.md)를 먼저 읽는다.
