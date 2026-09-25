import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, md, setMdLang } from "../../engine/public/js/md.js";

// diffWords lives in revision.js, which only touches the DOM when used: it can be loaded in Node.
const { diffWords } = await import("../../engine/public/js/revision.js");

test("word-by-word diff", () => {
  const parts = diffWords("A shared Redis cache.", "A shared in memory cache.");
  assert.deepEqual(parts.filter((p) => p.type === "del").map((p) => p.text.trim()), ["Redis"]);
  assert.deepEqual(parts.filter((p) => p.type === "add").map((p) => p.text.trim()), ["in memory"]);
  assert.equal(parts.filter((p) => p.type !== "del").map((p) => p.text).join(""), "A shared in memory cache.");
});

test("safe Markdown: escaping, http links only, typography by language", () => {
  setMdLang("fr");
  assert.equal(inline("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
  assert.match(inline("[doc](https://ex.com/a)"), /<a href="https:\/\/ex\.com\/a" target="_blank" rel="noopener noreferrer">doc<\/a>/);
  assert.doesNotMatch(inline("[x](javascript:alert(1))"), /<a /);
  assert.equal(inline("Yes : no"), "Yes&nbsp;: no");
  assert.equal(inline("Really ?"), "Really&nbsp;?");
  setMdLang("en");
  assert.equal(inline("Yes : no"), "Yes : no");
  setMdLang("fr");
  assert.match(md("1. one\n2. two"), /^<ol><li>one<\/li><li>two<\/li><\/ol>$/);
  assert.match(md("```\n<x>\n```"), /<pre class="code-block"><code>&lt;x&gt;<\/code><\/pre>/);
});
