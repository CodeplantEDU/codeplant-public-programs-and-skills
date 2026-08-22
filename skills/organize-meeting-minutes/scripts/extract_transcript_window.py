#!/usr/bin/env python3
"""Extract one narrow timestamp range from a persisted Whisper transcript JSON."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TIMESTAMP_RE = re.compile(r"^\[(\d+):(\d+):(\d+)\]\s*(.*)$")


def parse_time(value: str) -> float:
    value = value.strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return float(value)
    parts = value.split(":")
    if len(parts) not in {2, 3}:
        raise argparse.ArgumentTypeError("use seconds, MM:SS, or HH:MM:SS")
    try:
        numbers = [float(part) for part in parts]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]


def clock(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def load_segments(path: Path) -> list[dict[str, object]]:
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        return list(data.get("segments", []))

    segments: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = TIMESTAMP_RE.match(line.strip())
        if not match:
            continue
        hours, minutes, seconds, text = match.groups()
        start = int(hours) * 3600 + int(minutes) * 60 + int(seconds)
        segments.append({"start": float(start), "end": float(start + 2), "text": text})
    for index in range(len(segments) - 1):
        segments[index]["end"] = max(
            float(segments[index]["end"]),
            float(segments[index + 1]["start"]),
        )
    return segments


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--start", type=parse_time, required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--end", type=parse_time)
    group.add_argument("--duration", type=float, default=120.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")
    end = args.end if args.end is not None else args.start + args.duration
    if end <= args.start:
        parser.error("end must be greater than start")

    lines = [
        f"# 전사 구간 {clock(args.start)}~{clock(end)}",
        "",
    ]
    for segment in load_segments(args.input):
        start = float(segment.get("start", 0.0))
        segment_end = float(segment.get("end", start))
        if segment_end < args.start or start >= end:
            continue
        text = re.sub(r"\s+", " ", str(segment.get("text", ""))).strip()
        if text:
            lines.append(f"[{clock(start)}] {text}")
    if len(lines) == 2:
        lines.append("[해당 구간에 전사된 발화 없음]")
    content = "\n".join(lines).rstrip() + "\n"

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
        print(json.dumps({"output": str(args.output), "lines": len(lines) - 2}, ensure_ascii=False))
    else:
        print(content, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
