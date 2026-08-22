# 로컬 우선 음성 전사 절차

## 우선순위

1. 문서형 녹취록이 있으면 `extract_transcript.py`로 UTF-8 텍스트를 먼저 저장한다.
2. 실제 음성은 `transcribe_audio.py`로 로컬에서 끝까지 전사하고 TXT·JSON·SRT 묶음을 저장한다.
3. 회의록 작성은 저장된 TXT에서 만든 `review.md`로 시작하고, 필요한 시간 구간만 좁게 추출한다.
4. 직접 전사가 실패할 때만 `prepare_audio.py`로 16kHz 모노 WAV를 만든 뒤 다시 전사한다.
5. 로컬 Whisper가 없으면 앱의 음성 이해 기능을 확인한다. 클라우드 STT는 비용·자격 증명이 필요하므로 사용자가 명시적으로 승인한 경우에만 사용한다.

## 지원 미디어

- 음성: MP3, M4A, WAV, AAC, FLAC, OGG, WMA
- 영상: MP4, MOV, MKV, WEBM
- FFmpeg가 읽을 수 있는 다른 형식도 대부분 처리 가능

## 권장 모델

- 한국어 기본: `small`
- 짧고 빠른 초안: `base`
- 정확도 우선이며 장시간 처리가 가능한 경우: `medium`

모델 변경은 원문 길이와 PC 성능을 고려한다. 기본값 `small`을 먼저 사용한다.

## 결과물

`transcribe_audio.py`는 다음 파일을 만든다.

- `<이름>.transcript.txt`: 타임스탬프 포함 읽기용 녹취
- `<이름>.transcript.json`: 구간별 시작·종료 시각과 원본 결과
- `<이름>.transcript.srt`: 자막 형식

원본 경로·크기·수정시각·모델·언어가 동일하면 이 묶음을 자동 재사용한다. `--force`는 입력이 바뀌었거나 전사 품질을 다른 모델로 다시 비교할 때만 쓴다.

## 긴 녹음

기본값은 20분 내부 분할이다. 스크립트가 모델을 한 번만 불러온 뒤 모든 조각을 순서대로 전사하고 전체 시간 기준으로 병합한다. 사용자는 조각별 명령을 반복하거나 수동으로 타임스탬프를 합치지 않는다.

```powershell
python -X utf8 scripts/transcribe_audio.py "회의녹음.m4a" --output-dir "transcript" --chunk-minutes 20
```

내부 분할을 원하지 않으면 `--chunk-minutes 0`을 쓴다.

## 토큰 절약형 검토

전사 완료 전에는 회의록 작성을 시작하지 않는다. 완료 후에도 전체 TXT 또는 JSON을 채팅에 붙여 넣지 않는다.

```powershell
python -X utf8 scripts/prepare_review_packet.py "transcript/회의녹음.transcript.txt"
python -X utf8 scripts/extract_transcript_window.py "transcript/회의녹음.transcript.txt" --start 00:30:00 --duration 180
```

- `review.md`: 5분 단위 핵심 발화 후보와 결정·일정·후속 조치 후보만 포함한다.
- `extract_transcript_window.py`: 최종 사실 검증에 필요한 좁은 구간만 출력한다.
- 회의록 초안·검토 메모도 파일로 저장하고 같은 전사 원문을 여러 도구 출력으로 반복하지 않는다.
- 이 방식은 로컬 STT 토큰을 0으로 유지하고 Codex에 투입되는 텍스트를 줄인다. 회의록 작성 자체의 모델 토큰은 여전히 발생한다.

## 화자 분리

기본 Whisper는 화자 분리를 제공하지 않는다. 별도 diarization 결과가 없으면 화자 이름을 생성하지 않는다. 문서형 녹취록에 화자 라벨이 이미 있으면 그대로 보존한다.

## 품질 점검

- `ffprobe`로 확인한 길이와 마지막 전사 시각 비교
- JSON `_meta.duration_seconds`와 마지막 구간의 종료 시각 비교
- 시작·중간·끝의 대표 구간 청취
- 고유명사 목록을 `--prompt-file`로 전달
- 무음, 겹침 발화, 전화 음질, 배경음이 심한 구간은 `[청취 불명확]`로 처리
