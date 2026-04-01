#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

try:
    from docling.document_converter import DocumentConverter
except ModuleNotFoundError:
    DocumentConverter = None


def build_origin(url):
    parsed = urllib.parse.urlparse(str(url or ""))
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def download_with_urllib(url, destination):
    origin = build_origin(url) or url
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": f"{origin}/",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response, open(destination, "wb") as output:
        shutil.copyfileobj(response, output)


def download_with_curl(url, destination):
    origin = build_origin(url) or url
    completed = subprocess.run(
        [
            "curl",
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--compressed",
            "-A",
            "Mozilla/5.0",
            "-H",
            "Accept: application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
            "-H",
            "Accept-Language: en-US,en;q=0.9",
            "-H",
            f"Referer: {origin}/",
            "-o",
            destination,
            url,
        ],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"curl_failed:{completed.returncode}")


def extract_text_from_pdf(pdf_path):
    converter = DocumentConverter()
    result = converter.convert(pdf_path)
    document = result.document
    return document.export_to_markdown() if document else ""


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    url = str(payload.get("url") or "").strip()
    if not url:
        print(json.dumps({"ok": False, "errorCode": "missing_url"}))
        return

    if DocumentConverter is None:
        print(json.dumps({"ok": False, "errorCode": "docling_not_installed"}))
        return

    temp_pdf_path = None
    download_mode = None
    download_errors = []

    try:
        with tempfile.TemporaryDirectory(prefix="nutri_pdf_") as temp_dir:
            temp_pdf_path = os.path.join(temp_dir, "document.pdf")

            for mode_name, downloader in (("urllib", download_with_urllib), ("curl", download_with_curl)):
                try:
                    downloader(url, temp_pdf_path)
                    download_mode = mode_name
                    break
                except Exception as exc:
                    download_errors.append(f"{mode_name}:{exc}")

            if not download_mode:
                raise RuntimeError("; ".join(download_errors) or "pdf_download_failed")

            text = extract_text_from_pdf(temp_pdf_path)

        print(
            json.dumps(
                {
                    "ok": True,
                    "url": url,
                    "downloadMode": download_mode,
                    "tempFileDeleted": bool(temp_pdf_path and not os.path.exists(temp_pdf_path)),
                    "text": text,
                }
            )
        )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "errorCode": "pdf_extract_failed",
                    "message": str(exc),
                    "url": url,
                    "downloadMode": download_mode,
                    "tempFileDeleted": bool(temp_pdf_path and not os.path.exists(temp_pdf_path)),
                }
            )
        )


if __name__ == "__main__":
    main()
