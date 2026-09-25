// Glossary: each term (and its aliases) is spotted in the displayed text on its first appearance per
// card, underlined with dots, and explained on hover as well as on keyboard focus.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { inline } from "./md.js";
import { attachFloating } from "./ui.js";

const SKIP = "code, pre, a, button, input, textarea, select, svg, .term, .no-glossary";

export function glossaryMatcher(glossary) {
  const words = [];
  const byWord = new Map();
  for (const entry of glossary ?? []) {
    if (!entry?.term || !entry.definition) continue;
    for (const word of [entry.term, ...(entry.aliases ?? [])]) {
      if (!word) continue;
      words.push(word);
      byWord.set(word.toLowerCase(), entry);
    }
  }
  if (!words.length) return null;
  words.sort((a, b) => b.length - a.length);
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Unicode word boundaries: “TTL” must not light up inside “TTLs” or “sub-TTL”.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  return { pattern, lookup: (word) => byWord.get(word.toLowerCase()) };
}

export function applyGlossary(root, matcher, seen = new Set()) {
  if (!matcher || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) || !node.nodeValue.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(matcher.pattern)) {
      const entry = matcher.lookup(match[1]);
      const key = entry?.term.toLowerCase();
      if (!entry || seen.has(key)) continue;
      seen.add(key);
      parts.push(text.slice(last, match.index), termSpan(match[1], entry));
      last = match.index + match[1].length;
    }
    if (!parts.length) continue;
    parts.push(text.slice(last));
    node.replaceWith(...parts.filter((p) => p !== ""));
  }
}

function termSpan(text, entry) {
  const span = h("span", { class: "term", tabindex: "0", "aria-label": `${text} — ${entry.definition}` }, text);
  return attachFloating(span, () => h("div", {},
    h("div", { class: "hc-title" }, icon("book-open"), entry.term),
    h("div", { class: "hc-text", html: inline(entry.definition) })), { variant: "hover-card" });
}

export function glossaryList(glossary, t) {
  const entries = [...(glossary ?? [])].filter((e) => e.term).sort((a, b) => a.term.localeCompare(b.term, t.lang));
  if (!entries.length) return h("p", { class: "muted" }, t("glossary.empty"));
  return h("dl", { class: "glossary-list" }, entries.map((entry) => [
    h("dt", {}, entry.term, entry.aliases?.length ? h("span", { class: "muted" }, ` (${entry.aliases.join(", ")})`) : null),
    h("dd", { html: inline(entry.definition) }),
  ]));
}
