#!/usr/bin/env python3
"""Create and edit HWPX files through the locally installed Hancom Office.

This tool uses only Python's standard library and Hancom's local Windows COM
automation interface. It intentionally does not bundle templates or code from
third-party HWPX projects.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from textwrap import dedent
from xml.etree import ElementTree as ET


REQUIRED_ENTRIES = {
    "mimetype",
    "Contents/content.hpf",
    "Contents/header.xml",
    "Contents/section0.xml",
}


def die(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def read_text(body: str | None, body_file: Path | None) -> str:
    if body is not None and body_file is not None:
        die("Use either --body or --body-file, not both.")
    if body_file is not None:
        return body_file.read_text(encoding="utf-8-sig")
    return body or ""


def run_hancom(ps_source: str, *args: str) -> None:
    with tempfile.TemporaryDirectory(prefix="hancom_hwpx_") as temp_dir:
        script = Path(temp_dir) / "hancom_action.ps1"
        script.write_text(ps_source, encoding="utf-8")
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
                *args,
            ],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
        )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        die(f"Hancom automation failed: {detail or 'unknown error'}")
    if result.stdout.strip():
        print(result.stdout.strip())


def ensure_new_output(path: Path, overwrite: bool) -> Path:
    path = path.expanduser().resolve()
    if path.suffix.lower() != ".hwpx":
        die("Output must use the .hwpx extension.")
    if path.exists() and not overwrite:
        die(f"Output already exists: {path}. Use --overwrite to replace it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


CREATE_PS = dedent(
    r"""
    param([string]$Output, [string]$TextFile)
    $ErrorActionPreference = 'Stop'
    $hwp = $null
    try {
        $hwp = New-Object -ComObject HWPFrame.HwpObject
        $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
        $text = Get-Content -LiteralPath $TextFile -Raw -Encoding utf8
        $set = $hwp.HParameterSet.HInsertText
        $set.Text = $text
        if (-not $hwp.HAction.Execute('InsertText', $set.HSet)) { throw 'InsertText action failed.' }
        if (-not $hwp.SaveAs($Output, 'HWPX', '')) { throw 'SaveAs HWPX failed.' }
        Write-Output 'HWPX_CREATE_OK'
    }
    finally {
        if ($null -ne $hwp) { $hwp.Quit() }
    }
    """
)


REPLACE_PS = dedent(
    r"""
    param([string]$SourcePath, [string]$Output, [string]$MapFile)
    $ErrorActionPreference = 'Stop'
    $hwp = $null
    try {
        $hwp = New-Object -ComObject HWPFrame.HwpObject
        $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
        if (-not $hwp.Open($SourcePath, 'HWPX', '')) { throw 'Open HWPX failed.' }
        $map = Get-Content -LiteralPath $MapFile -Raw -Encoding utf8 | ConvertFrom-Json
        foreach ($item in $map.PSObject.Properties) {
            $set = $hwp.HParameterSet.HFindReplace
            $null = $hwp.HAction.GetDefault('AllReplace', $set.HSet)
            $set.Direction = $hwp.FindDir('AllDoc')
            $set.FindString = [string]$item.Name
            $set.ReplaceString = [string]$item.Value
            $set.ReplaceMode = 1
            $set.IgnoreMessage = 1
            $set.FindType = 1
            $null = $hwp.HAction.Execute('AllReplace', $set.HSet)
        }
        if (-not $hwp.SaveAs($Output, 'HWPX', '')) { throw 'SaveAs HWPX failed.' }
        Write-Output 'HWPX_REPLACE_OK'
    }
    finally {
        if ($null -ne $hwp) { $hwp.Quit() }
    }
    """
)


OPEN_TEST_PS = dedent(
    r"""
    param([string]$SourcePath)
    $ErrorActionPreference = 'Stop'
    $hwp = $null
    try {
        $hwp = New-Object -ComObject HWPFrame.HwpObject
        $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
        if (-not $hwp.Open($SourcePath, 'HWPX', '')) { throw 'Open HWPX failed.' }
        Write-Output 'HANCOM_OPEN_OK'
    }
    finally {
        if ($null -ne $hwp) { $hwp.Quit() }
    }
    """
)


def create(args: argparse.Namespace) -> None:
    output = ensure_new_output(Path(args.output), args.overwrite)
    body = read_text(args.body, Path(args.body_file) if args.body_file else None)
    text = f"{args.title}\n\n{body}" if args.title else body
    with tempfile.TemporaryDirectory(prefix="hancom_hwpx_text_") as temp_dir:
        text_file = Path(temp_dir) / "body.txt"
        text_file.write_text(text, encoding="utf-8")
        run_hancom(CREATE_PS, str(output), str(text_file))
    validate_path(output)


def replace(args: argparse.Namespace) -> None:
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        die(f"Input not found: {source}")
    output = ensure_new_output(Path(args.output), args.overwrite)
    mapping = json.loads(Path(args.replacements).read_text(encoding="utf-8-sig"))
    if not isinstance(mapping, dict) or not mapping:
        die("--replacements must be a non-empty JSON object of old text to new text.")
    with tempfile.TemporaryDirectory(prefix="hancom_hwpx_map_") as temp_dir:
        map_file = Path(temp_dir) / "replacements.json"
        map_file.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
        run_hancom(REPLACE_PS, str(source), str(output), str(map_file))
    validate_path(output)


def extract(args: argparse.Namespace) -> None:
    path = Path(args.input).expanduser().resolve()
    if not path.is_file():
        die(f"Input not found: {path}")
    with zipfile.ZipFile(path) as archive:
        section_names = sorted(
            name for name in archive.namelist()
            if name.startswith("Contents/section") and name.endswith(".xml")
        )
        if not section_names:
            die("No HWPX section XML was found.")
        paragraphs: list[str] = []
        for section_name in section_names:
            root = ET.fromstring(archive.read(section_name))
            paragraphs.extend(
                "".join(node.itertext()).strip()
                for node in root.iter()
                if node.tag.endswith("}p") and "".join(node.itertext()).strip()
            )
    print("\n".join(paragraphs))


def validate_path(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        missing = REQUIRED_ENTRIES - set(names)
        if missing:
            die(f"Missing required HWPX entries: {', '.join(sorted(missing))}")
        info = archive.infolist()[0]
        if info.filename != "mimetype" or info.compress_type != zipfile.ZIP_STORED:
            die("mimetype must be the first uncompressed ZIP entry.")
        if archive.read("mimetype").decode("ascii", "replace").strip() != "application/hwp+zip":
            die("Invalid HWPX mimetype.")
        for name in names:
            if name.lower().endswith((".xml", ".hpf")):
                ET.fromstring(archive.read(name))
    print(f"VALID: {path}")


def validate(args: argparse.Namespace) -> None:
    path = Path(args.input).expanduser().resolve()
    if not path.is_file():
        die(f"Input not found: {path}")
    validate_path(path)


def open_test(args: argparse.Namespace) -> None:
    path = Path(args.input).expanduser().resolve()
    if not path.is_file():
        die(f"Input not found: {path}")
    run_hancom(OPEN_TEST_PS, str(path))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create_parser = commands.add_parser("create", help="Create a new native HWPX through Hancom Office.")
    create_parser.add_argument("--output", required=True)
    create_parser.add_argument("--title")
    create_parser.add_argument("--body")
    create_parser.add_argument("--body-file")
    create_parser.add_argument("--overwrite", action="store_true")
    create_parser.set_defaults(func=create)

    replace_parser = commands.add_parser("replace", help="Copy an HWPX and replace exact text through Hancom Office.")
    replace_parser.add_argument("--input", required=True)
    replace_parser.add_argument("--output", required=True)
    replace_parser.add_argument("--replacements", required=True, help='UTF-8 JSON object: {"old": "new"}.')
    replace_parser.add_argument("--overwrite", action="store_true")
    replace_parser.set_defaults(func=replace)

    extract_parser = commands.add_parser("extract", help="Extract paragraph text from every HWPX section.")
    extract_parser.add_argument("--input", required=True)
    extract_parser.set_defaults(func=extract)

    validate_parser = commands.add_parser("validate", help="Validate basic HWPX ZIP and XML structure.")
    validate_parser.add_argument("--input", required=True)
    validate_parser.set_defaults(func=validate)

    open_parser = commands.add_parser("open-test", help="Open an HWPX in Hancom Office and close it.")
    open_parser.add_argument("--input", required=True)
    open_parser.set_defaults(func=open_test)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
