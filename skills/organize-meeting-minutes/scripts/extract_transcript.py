#!/usr/bin/env python3
"""Extract readable UTF-8 transcript text from common transcript containers."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


TIMED_HTML = re.compile(
    r"<p><span><span>(.*?)</span><span>(\d{2}:\d{2}(?::\d{2})?)</span>"
    r"<span><br\s*/?></span><span>(.*?)</span>",
    re.IGNORECASE | re.DOTALL,
)
TAG = re.compile(r"<[^>]+>")


def clean_html(value: str) -> str:
    value = TAG.sub("", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def extract_html_doc(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    matches = TIMED_HTML.findall(raw)
    if matches:
        return [
            f"{timestamp} {clean_html(speaker)}: {clean_html(text)}"
            for speaker, timestamp, text in matches
            if clean_html(text)
        ]
    normalized = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    normalized = re.sub(r"</p\s*>", "\n", normalized, flags=re.IGNORECASE)
    normalized = TAG.sub("", normalized)
    normalized = html.unescape(normalized)
    return [line.strip() for line in normalized.splitlines() if line.strip()]


def extract_docx(path: Path) -> list[str]:
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    lines: list[str] = []
    for paragraph in root.iter(ns + "p"):
        chunks: list[str] = []
        for node in paragraph.iter():
            if node.tag == ns + "t" and node.text:
                chunks.append(node.text)
            elif node.tag == ns + "tab":
                chunks.append("\t")
            elif node.tag in {ns + "br", ns + "cr"}:
                chunks.append("\n")
        text = "".join(chunks).strip()
        if text:
            lines.extend(part.strip() for part in text.splitlines() if part.strip())
    return lines


def timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def extract_json(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    segments = data.get("segments") if isinstance(data, dict) else None
    if isinstance(segments, list):
        lines = []
        for segment in segments:
            text = str(segment.get("text", "")).strip()
            if text:
                lines.append(f"{timestamp(float(segment.get('start', 0)))} {text}")
        return lines
    return [json.dumps(data, ensure_ascii=False, indent=2)]


def extract(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return extract_docx(path)
    if suffix == ".doc":
        header = path.read_bytes()[:64].lstrip(b"\xef\xbb\xbf\x00\t\r\n ").lower()
        if header.startswith(b"<html") or b"<html" in header:
            return extract_html_doc(path)
        raise ValueError("Binary .doc is not supported directly; open or export it as DOCX/TXT first.")
    if suffix == ".json":
        return extract_json(path)
    if suffix in {".txt", ".md", ".srt", ".vtt"}:
        return path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    raise ValueError(f"Unsupported transcript format: {suffix or '(none)'}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"Input file does not exist: {args.input}")
    try:
        lines = extract(args.input)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    output = args.output or args.input.with_suffix(args.input.suffix + ".txt")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    print(json.dumps({"input": str(args.input), "output": str(output), "lines": len(lines)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
