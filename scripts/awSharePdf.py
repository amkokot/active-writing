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
args = parser.parse_args()
source, output = Path(args.input).resolve(), Path(args.output).resolve()
if source == output or output.exists():
    raise ValueError("Choose a new absent output PDF; the typeset original is preserved.")
writer = PdfWriter()
writer.clone_document_from_reader(PdfReader(source))
writer.metadata = {"/Title": "Adaptive permanent estimation - research note", "/Creator": "Active Writing sharing export"}
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
for page in check.pages:
    for ref in page.get("/Annots", []):
        action = ref.get_object().get("/A", {})
        if hasattr(action, "get_object"):
            action = action.get_object()
        uri = str(action.get("/URI", ""))
        if "127.0.0.1" in uri or "awProject=" in uri or uri.startswith("file:"):
            raise ValueError("Private URL survived PDF export.")
print({"pages": len(check.pages), "private_links_removed": removed, "original_preserved": True})
