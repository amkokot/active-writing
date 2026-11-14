"""Export an exact typeset reading copy with private/local URI annotations removed.
Never alters the input PDF; output must be absent. Preserves internal GoTo targets.
"""
import argparse
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, NameObject

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
titles = parser.add_mutually_exclusive_group()
titles.add_argument("--title", help="Project/document title for this shared PDF")
titles.add_argument("--preparation", help="Use projectName from the selected awShare preparation.json")
args = parser.parse_args()
source, output = Path(args.input).resolve(), Path(args.output).resolve()
if source == output or output.exists():
    raise ValueError("Choose a new absent output PDF; the typeset original is preserved.")
reader = PdfReader(source)
title = args.title
if args.preparation:
    import json
    preparation = json.loads(Path(args.preparation).read_text(encoding="utf-8"))
    title = preparation.get("projectName")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Preparation has no projectName. Supply the confirmed project/document --title instead.")
if title is None:
    title = (reader.metadata or {}).get("/Title") or source.stem.replace("_", " ").replace("-", " ")
if not isinstance(title, str) or not title.strip() or len(title) > 1000 or any(ord(c) < 32 for c in title):
    raise ValueError("Use a nonempty, single-line title of at most 1,000 characters.")
title = title.strip()
writer = PdfWriter()
writer.clone_document_from_reader(reader)
writer.metadata = {"/Title": title, "/Creator": "Active Writing sharing export"}
# Cloning retains XMP too; discard stale title/author metadata rather than let
# PDF viewers prefer a different project's embedded title over /Title.
writer.root_object.pop(NameObject("/Metadata"), None)
removed = 0
for page in writer.pages:
    kept = ArrayObject()
    for ref in page.get("/Annots", []):
        annotation = ref.get_object()
        action = annotation.get("/A", {})
        if hasattr(action, "get_object"):
            action = action.get_object()
        uri = str(action.get("/URI", ""))
        parsed = urlsplit(uri)
        if uri and (parsed.scheme not in ("https", "mailto") or parsed.hostname in ("localhost", "127.0.0.1", "::1") or "awProject" in parse_qs(parsed.query)):
            removed += 1
        else:
            kept.append(ref)
    if "/Annots" in page:
        page[NameObject("/Annots")] = kept
with output.open("xb") as stream:
    writer.write(stream)
check = PdfReader(output)
if check.metadata.title != title or check.xmp_metadata is not None:
    raise ValueError("Shared PDF metadata did not match the selected title.")
for page in check.pages:
    for ref in page.get("/Annots", []):
        action = ref.get_object().get("/A", {})
        if hasattr(action, "get_object"):
            action = action.get_object()
        uri = str(action.get("/URI", ""))
        if "127.0.0.1" in uri or "awProject=" in uri or uri.startswith("file:"):
            raise ValueError("Private URL survived PDF export.")
print({"title": title, "pages": len(check.pages), "private_links_removed": removed, "original_preserved": True})
