#!/usr/bin/env python3
"""Normalize meeting media to 16 kHz mono WAV and optionally split it."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, capture_output=True)


def probe(path: Path, ffprobe: str) -> float:
    result = run([
        ffprobe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ])
    return float(result.stdout.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--chunk-minutes", type=float, default=0)
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("ERROR: ffmpeg and ffprobe must be available on PATH.", file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    normalized = args.output_dir / f"{args.input.stem}.16k-mono.wav"
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(args.input),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(normalized),
    ]
    try:
        run(command)
        duration = probe(normalized, ffprobe)
        chunks: list[dict[str, object]] = []
        if args.chunk_minutes > 0:
            chunk_seconds = max(60, int(args.chunk_minutes * 60))
            pattern = args.output_dir / f"{args.input.stem}.chunk-%03d.wav"
            run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(normalized),
                "-f", "segment", "-segment_time", str(chunk_seconds), "-reset_timestamps", "1",
                "-c", "copy", str(pattern),
            ])
            for index, chunk in enumerate(sorted(args.output_dir.glob(f"{args.input.stem}.chunk-*.wav"))):
                chunks.append({
                    "path": str(chunk),
                    "offset_seconds": index * chunk_seconds,
                    "duration_seconds": round(probe(chunk, ffprobe), 3),
                })
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or str(exc), file=sys.stderr)
        return 2

    manifest = {
        "source": str(args.input),
        "normalized": str(normalized),
        "duration_seconds": round(duration, 3),
        "chunks": chunks,
    }
    manifest_path = args.output_dir / f"{args.input.stem}.audio-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
