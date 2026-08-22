#!/usr/bin/env python3
"""Create a compact, time-indexed review packet from a Whisper transcript JSON."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any


FILLERS = {
    "아", "어", "네", "예", "응", "음", "그치", "그렇지", "맞아", "맞아요",
    "뭐", "자", "오케이", "그래", "그래요", "그러니까",
}
DECISION_RE = re.compile(r"확정|결정|하기로|진행하자|이걸로\s*하|그렇게\s*하|알겠습니다|정했")
ACTION_RE = re.compile(r"해야|해줘|준비|가져|구매|주문|설치|확인|보내|작성|검토|담당|기한|까지")
SCHEDULE_RE = re.compile(r"\d{1,2}\s*월|\d{1,2}\s*일|오늘|내일|다음\s*(주|달|회의)|오전|오후|시까지")
NUMBER_RE = re.compile(r"\d")
ISSUE_RE = re.compile(r"문제|오류|실패|안\s*돼|안되|필요|불명확|어렵|고장|누락")
TIMESTAMP_RE = re.compile(r"^\[(\d+):(\d+):(\d+)\]\s*(.*)$")


def clock(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def looks_repetitive(text: str) -> bool:
    compact = re.sub(r"[\s,!.?~]+", "", text)
    if len(compact) < 24:
        return False
    if len(set(compact)) <= 5:
        return True
    return bool(re.fullmatch(r"(.{1,12})\1{3,}", compact))


def score(text: str) -> int:
    value = min(len(text), 80) // 12
    if DECISION_RE.search(text):
        value += 12
    if ACTION_RE.search(text):
        value += 8
    if SCHEDULE_RE.search(text):
        value += 7
    if NUMBER_RE.search(text):
        value += 5
    if ISSUE_RE.search(text):
        value += 5
    return value


def load_transcript(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".json":
        return json.loads(path.read_text(encoding="utf-8"))

    segments: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = TIMESTAMP_RE.match(line.strip())
        if not match:
            continue
        hours, minutes, seconds, text = match.groups()
        start = int(hours) * 3600 + int(minutes) * 60 + int(seconds)
        segments.append({"start": float(start), "end": float(start + 2), "text": text})
    for index in range(len(segments) - 1):
        segments[index]["end"] = max(
            segments[index]["end"],
            segments[index + 1]["start"],
        )
    duration = max((item["end"] for item in segments), default=0.0)
    sidecar = path.with_suffix(".json")
    sidecar_meta: dict[str, Any] = {}
    if sidecar.is_file():
        try:
            sidecar_meta = json.loads(sidecar.read_text(encoding="utf-8")).get("_meta", {})
        except (OSError, ValueError):
            sidecar_meta = {}
    return {
        "segments": segments,
        "_meta": {
            "source": sidecar_meta.get("source", str(path.resolve())),
            "duration_seconds": sidecar_meta.get("duration_seconds", duration),
            "model": sidecar_meta.get("model", "텍스트 전사본"),
        },
    }


def usable_segments(data: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    previous = ""
    for raw in data.get("segments", []):
        text = clean_text(raw.get("text"))
        if not text or text in FILLERS or looks_repetitive(text):
            continue
        if text == previous:
            continue
        previous = text
        output.append({
            "start": float(raw.get("start", 0.0)),
            "end": float(raw.get("end", raw.get("start", 0.0))),
            "text": text[:300] + ("…" if len(text) > 300 else ""),
        })
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--window-minutes", type=float, default=5.0)
    parser.add_argument("--anchors-per-window", type=int, default=5)
    parser.add_argument("--max-candidates", type=int, default=80)
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")
    if args.window_minutes <= 0 or args.anchors_per_window <= 0 or args.max_candidates <= 0:
        parser.error("window, anchor, and candidate limits must be positive")

    data = load_transcript(args.input)
    segments = usable_segments(data)
    if not segments:
        raise SystemExit("no usable transcript segments")

    meta = data.get("_meta", {})
    duration = float(meta.get("duration_seconds") or max(item["end"] for item in segments))
    window_seconds = args.window_minutes * 60
    window_count = max(1, math.ceil(duration / window_seconds))
    lines = [
        "# 전사 검토 패킷",
        "",
        "> 전체 전사본을 반복해서 읽지 않기 위한 축약 색인입니다. 최종 결정·숫자·담당·기한은 반드시 해당 시간 구간을 원문에서 다시 확인하세요.",
        "",
        "## 전사 정보",
        "",
        f"- 원본: `{meta.get('source', args.input)}`",
        f"- 길이: {clock(duration)}",
        f"- 모델: {meta.get('model', '확인되지 않음')}",
        f"- 전체 구간 수: {len(data.get('segments', []))}",
        f"- 검토용 유효 구간 수: {len(segments)}",
        "",
        "## 시간대별 핵심 발화 후보",
        "",
    ]

    for window_index in range(window_count):
        begin = window_index * window_seconds
        end = min(duration, begin + window_seconds)
        candidates = [item for item in segments if begin <= item["start"] < end]
        frequencies = Counter(item["text"] for item in candidates)
        ranked = sorted(
            candidates,
            key=lambda item: (
                -(score(item["text"]) - max(0, frequencies[item["text"]] - 1) * 8),
                item["start"],
            ),
        )[: args.anchors_per_window]
        ranked.sort(key=lambda item: item["start"])
        lines.append(f"### {clock(begin)}~{clock(end)}")
        lines.append("")
        if ranked:
            lines.extend(f"- [{clock(item['start'])}] {item['text']}" for item in ranked)
        else:
            lines.append("- 유효한 발화 후보 없음")
        lines.append("")

    priority = [
        item for item in segments
        if DECISION_RE.search(item["text"])
        or ACTION_RE.search(item["text"])
        or SCHEDULE_RE.search(item["text"])
        or (NUMBER_RE.search(item["text"]) and ISSUE_RE.search(item["text"]))
    ]
    priority.sort(key=lambda item: (-score(item["text"]), item["start"]))
    priority = priority[: args.max_candidates]
    priority.sort(key=lambda item: item["start"])

    lines.extend(["## 결정·일정·후속 조치 후보", ""])
    lines.extend(f"- [{clock(item['start'])}] {item['text']}" for item in priority)
    lines.extend([
        "",
        "## 검토 방법",
        "",
        "1. 위 후보로 회의 주제와 중요 시간대를 먼저 파악합니다.",
        "2. 확정 문장에 사용할 구간만 `extract_transcript_window.py`로 좁게 추출합니다.",
        "3. 전체 TXT/JSON은 증거 보관용으로 두고 채팅이나 도구 출력에 통째로 싣지 않습니다.",
        "",
    ])

    output = args.output or args.input.with_name(f"{args.input.stem}.review.md")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "input": str(args.input),
        "output": str(output),
        "duration_seconds": round(duration, 3),
        "source_segments": len(data.get("segments", [])),
        "review_segments": len(segments),
        "windows": window_count,
        "priority_candidates": len(priority),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
