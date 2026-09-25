// Decisions revised by Claude: the note that says what changed, and the word-by-word diff against
// the previous round's version.
import { h } from "./dom.js";
import { plain } from "./md.js";
import { alert, button } from "./ui.js";

const MAX_TOKENS = 2500;

// Longest common subsequence over words (spaces included): enough for paragraphs.
export function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > MAX_TOKENS * MAX_TOKENS / 4) {
    return [{ type: "del", text: String(before ?? "") }, { type: "add", text: String(after ?? "") }];
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last?.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      push("del", a[i]);
      i += 1;
    } else {
      push("add", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return out;
}

// A word keeps the space that follows it: “in memory” comes out in one piece, not as two additions.
function tokenize(text) {
  return String(text ?? "").match(/^\s+|\S+\s*/g) ?? [];
}

function diffBlock(label, before, after) {
  if (String(before ?? "") === String(after ?? "")) return null;
  const parts = diffWords(before, after).map((part) => {
    if (part.type === "add") return h("ins", {}, part.text);
    if (part.type === "del") return h("del", {}, part.text);
    return part.text;
  });
  return h("div", { class: "diff-block" }, h("div", { class: "diff-label" }, label), h("div", { class: "diff" }, parts));
}

// What changed between the old and the new version of a decision, field by field.
export function decisionDiff(before, after, t) {
  const blocks = [
    // Compared as plain text: Markdown marks would show up as changes of their own.
    diffBlock(t("diff.title"), before.title, after.title),
    diffBlock(t("diff.proposal"), plain(before.proposal), plain(after.proposal)),
    diffBlock(t("diff.why"), plain(before.why), plain(after.why)),
  ];
  const oldOptions = new Map((before.control?.options ?? []).map((o) => [o.id, o]));
  for (const option of after.control?.options ?? []) {
    const old = oldOptions.get(option.id);
    if (!old) blocks.push(diffBlock(t("diff.newOption"), "", option.label));
    else blocks.push(diffBlock(t("diff.option", { label: option.label }), `${old.label} ${old.detail ?? ""}`.trim(), `${option.label} ${option.detail ?? ""}`.trim()));
  }
  const oldItems = new Map((before.items ?? []).map((i) => [i.id, i]));
  for (const item of after.items ?? []) {
    const old = oldItems.get(item.id);
    blocks.push(diffBlock(t("diff.item", { title: item.title }), old ? `${old.title} — ${old.detail ?? ""}` : "", `${item.title} — ${item.detail ?? ""}`));
  }
  const oldTasks = (before.tasks ?? []).map((task) => task.title).join(" · ");
  const newTasks = (after.tasks ?? []).map((task) => task.title).join(" · ");
  blocks.push(diffBlock(t("diff.tasks"), oldTasks, newTasks));
  const present = blocks.filter(Boolean);
  return present.length ? h("div", { class: "diff-list" }, present) : h("p", { class: "muted" }, t("diff.none"));
}

export function revisionNotice(decision, previous, t) {
  const panel = h("div", { class: "diff-panel", hidden: true });
  let open = false;
  const toggle = previous
    ? button({
      label: t("diff.show"),
      icon: "git-compare",
      variant: "outline",
      size: "sm",
      onclick: () => {
        open = !open;
        if (open && !panel.childNodes.length) panel.append(decisionDiff(previous, decision, t));
        panel.hidden = !open;
        toggle.querySelector("span").textContent = open ? t("diff.hide") : t("diff.show");
      },
    })
    : null;
  return h("div", { class: "revision" },
    alert({
      variant: "info",
      icon: "history",
      title: t("revision.title", { n: decision.revision.round }),
      description: decision.revision.note ? h("p", {}, decision.revision.note) : null,
      actions: toggle ? [toggle] : [],
    }),
    panel);
}
