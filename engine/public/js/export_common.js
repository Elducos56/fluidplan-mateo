// Pieces shared by the two Markdown exports (pure module).
import { formatDate } from "./i18n.js";
import { readiness } from "./model.js";

export function oneLine(text) {
  return String(text ?? "").replace(/\s*\n\s*/g, " ").trim();
}

export function cell(text) {
  return oneLine(text).replace(/\|/g, "\\|") || " ";
}

export function quote(text, t) {
  const clean = oneLine(text);
  return clean ? t("export.quote", { text: clean }) : "";
}

// French typography puts a space before “:” and “;”, English does not. The page gets this from
// md.js; the exports are raw Markdown, so the separators are chosen here.
export function punctuation(t) {
  return t.lang === "fr" ? { colon: " :", semicolon: " ; " } : { colon: ":", semicolon: "; " };
}

// Multi-line text under a bullet: the following lines are indented so they stay inside the
// bullet (lists included).
export function indentBlock(text, indent = "  ") {
  const lines = String(text ?? "").trim().split(/\r?\n/);
  return lines.map((line, i) => (i === 0 || !line.trim() ? line : `${indent}${line}`)).join("\n");
}

export function sourceLabel(plan) {
  const source = plan.source;
  if (!source) return "";
  if (typeof source === "string") return source;
  // A plan designed from a request has no source document to cite.
  return source.path ?? "";
}

// Shared header: the DRAFT notice when not everything is decided, date, rounds, source.
export function headerLines(plan, answers, { t, now, state }) {
  const ready = readiness(plan, answers);
  const lines = [];
  if (!ready.ready) {
    lines.push(`> **${t("export.draft")}** — ${t("export.draftDetail", { pending: ready.pending.length, revise: ready.revise.length })}`, ">");
  }
  const source = sourceLabel(plan);
  lines.push(`> ${t(ready.ready ? "export.metaReady" : "export.metaDraft", { date: formatDate(now, t), rounds: state?.round ?? 1 })}${source ? ` · ${t("export.source", { source })}` : ""} · ${t("export.generated")}`);
  return { lines, draft: !ready.ready };
}
