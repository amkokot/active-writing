import assert from "node:assert/strict";
import { test } from "node:test";
import { replyOutline } from "../src/replyOutline.ts";
import { mathParts } from "../src/mathText.ts";

test("reply outlines preserve every character while exposing author-supplied headings", () => {
  const text = "Intro $x$.\r\n\r\n## Outcome\r\nA bound $x<1$.\r\n\r\n### Checks and uncertainty ###\r\nNot formally verified.\r\n## Next step\r\nTry another case.";
  const outline = replyOutline(text);
  assert.deepEqual(outline.sections.map((s) => s.title), ["Outcome", "Checks and uncertainty", "Next step"]);
  assert.equal(outline.sections[1].reviewCue, true);
  assert.equal(outline.sections[0].reviewCue, false);
  assert.equal(outline.intro + outline.sections.map((s) => s.source).join(""), text);
  assert.match(outline.sections[0].text, /\$x<1\$/);
});

test("code fences and display mathematics cannot become reply outline headings", () => {
  const text = "## Actual\n```tex\n## Code $x$\n```\n~~~~\n## Also code\n```\n~~~~\n\\[\n## Inside math\nx=1\n\\]\n$$\n## Inside dollar math\nx=2\n$$\n## Missing assumption\nKeep this visible.";
  const outline = replyOutline(text);
  assert.deepEqual(outline.sections.map((s) => s.title), ["Actual", "Missing assumption"]);
  assert.equal(outline.sections[1].reviewCue, true);
  assert.equal(outline.intro + outline.sections.map((s) => s.source).join(""), text);
  assert.equal(mathParts(text).filter((p) => p.math).length, 2, "code mathematics remains literal");
});

test("unclosed and variable-length code fences and inline code remain intact", () => {
  for (const marker of ["```", "````", "~~~", "~~~~"]) {
    const text = `Before\n${marker}tex\n## Not a heading\n$x$`;
    assert.deepEqual(replyOutline(text), { intro: text, sections: [] });
    assert.equal(mathParts(text).filter((p) => p.math).length, 0);
    const closed = `${text}\n${marker}\n## Outside\n$x$`;
    assert.deepEqual(replyOutline(closed).sections.map((s) => s.title), ["Outside"]);
    assert.equal(mathParts(closed).filter((p) => p.math).length, 1);
  }
  const inline = '``literal ` $x$`` and $y$';
  assert.deepEqual(mathParts(inline).filter((p) => p.math).map((p) => p.text), ["y"]);
});

test("plain text and oversized/heading-heavy replies are never silently shortened", () => {
  const plain = "No heading. <script>not executable</script> [not a navigable link](javascript:alert(1))";
  assert.deepEqual(replyOutline(plain), { intro: plain, sections: [] });
  const large = `## Outcome\n${"a".repeat(100_001)}`;
  assert.deepEqual(replyOutline(large), { intro: large, sections: [] });
  const many = Array.from({ length: 100 }, (_, i) => `## Step ${i}\nExact text ${i}.\n`).join("");
  const outline = replyOutline(many);
  assert.equal(outline.sections.length, 64);
  assert.equal(outline.intro + outline.sections.map((s) => s.source).join(""), many);
  assert.match(outline.sections.at(-1)!.text, /Step 99/);
});

test("delimited math/code offsets cover exact source including original delimiters", () => {
  const text = "Prose \\(x\\) then $y$ and `literal $z$`.\n```tex\n$a$\n```\n$$b$$";
  const parts = mathParts(text);
  assert.equal(parts.map((p) => text.slice(p.start, p.end)).join(""), text);
  assert.deepEqual(parts.filter((p) => p.math).map((p) => p.text), ["x", "y", "b"]);
});

test("ordinary research replies expose remaining obligations and provenance without changing the answer", () => {
  const text = "## What was recovered\nTwo residual reductions, not the main theorem.\n\n## The actual remaining obligation\nEstablish the adaptive conditional law.\n\n## A manageable next task\nIsolate one conditioning step.\n\n## Quality and provenance\nThe main reduction was exposed before the attempt; not an independent proof.\n";
  const outline = replyOutline(text);
  assert.deepEqual(outline.sections.map((s) => s.reviewCue), [false, true, false, true]);
  assert.equal(outline.intro + outline.sections.map((s) => s.source).join(""), text);
  for (const title of ["Not proved", "Not proven", "Not recovered", "Not verified"])
    assert.equal(replyOutline(`## ${title}\nExact author wording.`).sections[0].reviewCue, true);
});
