#!/usr/bin/env python3
"""Transcribe a complete meeting locally and persist one merged transcript bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any


def clock(seconds: float, srt: bool = False) -> str:
    millis = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(millis, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    separator = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{ms:03d}"


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, capture_output=True)


def probe_duration(path: Path, ffprobe: str) -> float:
    result = run([
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    return float(result.stdout.strip())


def load_prompt(args: argparse.Namespace) -> str | None:
    if args.prompt and args.prompt_file:
        raise ValueError("Use either --prompt or --prompt-file, not both.")
    if args.prompt_file:
        return args.prompt_file.read_text(encoding="utf-8-sig").strip() or None
    return args.prompt.strip() if args.prompt else None


def source_signature(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "source": str(path.resolve()),
        "source_size": stat.st_size,
        "source_mtime_ns": stat.st_mtime_ns,
    }


def can_reuse(
    json_path: Path,
    txt_path: Path,
    srt_path: Path,
    signature: dict[str, Any],
    model: str,
    language: str,
    prompt_sha256: str,
) -> bool:
    if not (json_path.is_file() and txt_path.is_file() and srt_path.is_file()):
        return False
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    meta = data.get("_meta", {})
    return all([
        meta.get("source") == signature["source"],
        meta.get("source_size") == signature["source_size"],
        meta.get("source_mtime_ns") == signature["source_mtime_ns"],
        meta.get("model") == model,
        meta.get("requested_language") == language,
        meta.get("prompt_sha256") == prompt_sha256,
        bool(data.get("segments")),
    ])


def write_bundle(
    result: dict[str, Any],
    json_path: Path,
    txt_path: Path,
    srt_path: Path,
) -> None:
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    text_lines: list[str] = []
    srt_lines: list[str] = []
    output_index = 0
    for segment in result.get("segments", []):
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        output_index += 1
        start = float(segment["start"])
        end = float(segment["end"])
        text_lines.append(f"[{clock(start)[:8]}] {text}")
        srt_lines.extend([
            str(output_index),
            f"{clock(start, True)} --> {clock(end, True)}",
            text,
            "",
        ])
    txt_path.write_text("\n".join(text_lines).strip() + "\n", encoding="utf-8")
    srt_path.write_text("\n".join(srt_lines).strip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="ko")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument(
        "--chunk-minutes",
        type=float,
        default=20.0,
        help="Split long media internally while loading Whisper only once; 0 disables splitting.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore a matching persisted transcript bundle and transcribe again.",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")
    if args.chunk_minutes < 0:
        parser.error("--chunk-minutes must be 0 or greater")
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("ERROR: ffmpeg and ffprobe must be available on PATH.", file=sys.stderr)
        return 2
    try:
        prompt = load_prompt(args)
        import torch
        import whisper
    except Exception as exc:
        print(f"ERROR: Whisper runtime is unavailable: {exc}", file=sys.stderr)
        return 2

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        print("ERROR: CUDA was requested but is not available.", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = args.input.stem
    json_path = args.output_dir / f"{stem}.transcript.json"
    txt_path = args.output_dir / f"{stem}.transcript.txt"
    srt_path = args.output_dir / f"{stem}.transcript.srt"
    signature = source_signature(args.input)
    prompt_sha256 = hashlib.sha256((prompt or "").encode("utf-8")).hexdigest()

    if not args.force and can_reuse(
        json_path,
        txt_path,
        srt_path,
        signature,
        args.model,
        args.language,
        prompt_sha256,
    ):
        existing = json.loads(json_path.read_text(encoding="utf-8"))
        print(json.dumps({
            "input": str(args.input),
            "model": args.model,
            "language": existing.get("language", args.language),
            "device": existing.get("_meta", {}).get("device", device),
            "segments": len(existing.get("segments", [])),
            "duration_seconds": existing.get("_meta", {}).get("duration_seconds"),
            "reused": True,
            "text": str(txt_path),
            "json": str(json_path),
            "srt": str(srt_path),
        }, ensure_ascii=False))
        return 0

    try:
        duration = probe_duration(args.input, ffprobe)
    except (subprocess.CalledProcessError, ValueError) as exc:
        print(f"ERROR: could not probe input duration: {exc}", file=sys.stderr)
        return 2

    print(f"Loading Whisper model={args.model} device={device}", file=sys.stderr)
    try:
        model = whisper.load_model(args.model, device=device)
    except Exception as exc:
        print(f"ERROR: could not load Whisper model: {exc}", file=sys.stderr)
        return 2

    chunk_seconds = int(args.chunk_minutes * 60) if args.chunk_minutes > 0 else 0
    merged_segments: list[dict[str, Any]] = []
    chunk_meta: list[dict[str, Any]] = []
    detected_language = args.language

    temp_dir = args.output_dir / f"{stem}.stt-work-{uuid.uuid4().hex[:8]}"
    temp_dir.mkdir(parents=False, exist_ok=False)
    try:
        if chunk_seconds and duration > chunk_seconds:
            pattern = temp_dir / "chunk-%03d.wav"
            run([
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(args.input),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-f",
                "segment",
                "-segment_time",
                str(chunk_seconds),
                "-reset_timestamps",
                "1",
                str(pattern),
            ])
            media_parts = sorted(temp_dir.glob("chunk-*.wav"))
        else:
            media_parts = [args.input]

        for chunk_index, media_path in enumerate(media_parts):
            offset = float(chunk_index * chunk_seconds) if len(media_parts) > 1 else 0.0
            part_duration = probe_duration(media_path, ffprobe)
            print(
                f"Transcribing chunk {chunk_index + 1}/{len(media_parts)} "
                f"offset={clock(offset)[:8]}",
                file=sys.stderr,
            )
            result = model.transcribe(
                str(media_path),
                language=args.language,
                task="transcribe",
                fp16=device == "cuda",
                temperature=0,
                initial_prompt=prompt,
                verbose=None,
            )
            detected_language = str(result.get("language", detected_language))
            accepted = 0
            for segment in result.get("segments", []):
                local_start = float(segment.get("start", 0.0))
                if local_start >= part_duration + 1.0:
                    continue
                merged = dict(segment)
                merged["id"] = len(merged_segments)
                merged["start"] = round(offset + local_start, 3)
                merged["end"] = round(
                    min(duration, offset + float(segment.get("end", local_start))),
                    3,
                )
                merged["chunk_index"] = chunk_index
                merged_segments.append(merged)
                accepted += 1
            chunk_meta.append({
                "index": chunk_index,
                "offset_seconds": round(offset, 3),
                "duration_seconds": round(part_duration, 3),
                "segments": accepted,
            })
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: ffmpeg failed: {exc.stderr or exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"ERROR: transcription failed: {exc}", file=sys.stderr)
        return 2
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    combined_text = " ".join(
        str(segment.get("text", "")).strip()
        for segment in merged_segments
        if str(segment.get("text", "")).strip()
    )
    bundle: dict[str, Any] = {
        "text": combined_text,
        "segments": merged_segments,
        "language": detected_language,
        "_meta": {
            **signature,
            "duration_seconds": round(duration, 3),
            "model": args.model,
            "requested_language": args.language,
            "prompt_sha256": prompt_sha256,
            "device": device,
            "chunk_minutes": args.chunk_minutes,
            "chunks": chunk_meta,
        },
    }
    write_bundle(bundle, json_path, txt_path, srt_path)

    print(json.dumps({
        "input": str(args.input),
        "model": args.model,
        "language": detected_language,
        "device": device,
        "segments": len(merged_segments),
        "duration_seconds": round(duration, 3),
        "chunks": len(chunk_meta),
        "reused": False,
        "text": str(txt_path),
        "json": str(json_path),
        "srt": str(srt_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
