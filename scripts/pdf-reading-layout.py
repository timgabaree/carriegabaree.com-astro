"""Read-only layout hints. Text content still comes from the preserved extraction."""
import io
import json
import sys
import pdfplumber

data = sys.stdin.buffer.read(25 * 1024 * 1024 + 1)
if len(data) > 25 * 1024 * 1024:
    raise ValueError("PDF exceeds review limit")
with pdfplumber.open(io.BytesIO(data)) as pdf:
    if len(pdf.pages) > 1000:
        raise ValueError("Too many PDF pages")
    pages = []
    for page in pdf.pages:
        pages.append([{
            "text": line["text"], "x": line["x0"], "top": line["top"],
            "height": line["bottom"] - line["top"],
        } for line in page.extract_text_lines()])
    json.dump(pages, sys.stdout, ensure_ascii=False)
