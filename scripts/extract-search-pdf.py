"""Read PDF bytes from stdin; return page text for review, never modify a PDF."""
import io
import json
import logging
import sys
from pypdf import PdfReader

logging.getLogger("pypdf").setLevel(logging.ERROR)
try:
    data = sys.stdin.buffer.read(25 * 1024 * 1024 + 1)
    if len(data) > 25 * 1024 * 1024:
        raise ValueError("PDF is too large")
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted or len(reader.pages) > 1000:
        raise ValueError("Encrypted or oversized PDF requires manual review")
    pages = []
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        pages.append({"locator": f"PDF page {number}", "content": text})
    print(json.dumps({"pages": pages}, ensure_ascii=False))
except Exception:
    # Parser failures may contain source data; keep console output safe.
    print("PDF extraction failed; inspect the source manually.", file=sys.stderr)
    sys.exit(1)
