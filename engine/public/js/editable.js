// Rewriting a plan text in the page. The rewrite is stored in the answers (`edits`): Claude takes
// it word for word next round; the original stays available.
import { h } from "./dom.js";
import { badge, button } from "./ui.js";

// source() → { text: shown, original, edited: boolean }; save(text | null); render(text) → Node.
// decorate(node): called after each render (the glossary, for instance).
export function editableText({ t, source, save, render, multiline = true, readOnly = () => false, className = "", decorate }) {
  let editing = false;
  let rendered = null;
  let showOriginal = false;
  const display = h("div", { class: "editable-display" });
  const original = h("div", { class: "editable-original" });
  const field = multiline
    ? h("textarea", { class: "textarea", rows: 3, "aria-label": t("edit.aria") })
    : h("input", { class: "input", type: "text", "aria-label": t("edit.aria") });
  const editor = h("div", { class: "editable-editor", hidden: true },
    field,
    h("div", { class: "editable-buttons" },
      button({ label: t("edit.save"), size: "sm", onclick: commit }),
      button({ label: t("edit.cancel"), size: "sm", variant: "ghost", onclick: cancel }),
      button({ label: t("edit.restore"), size: "sm", variant: "ghost", icon: "undo-2", className: "restore", onclick: restore })));
  const editButton = button({ icon: "square-pen", variant: "ghost", size: "sm", title: t("edit.rewrite"), className: "editable-trigger", onclick: open });
  const editedBadge = badge(t("edit.rewritten"), { variant: "warning", icon: "pencil" });
  const toggleOriginal = button({ label: t("edit.showOriginal"), variant: "link", size: "sm", onclick: () => { showOriginal = !showOriginal; update(); } });
  const status = h("div", { class: "editable-status" }, editedBadge, toggleOriginal);
  const el = h("div", { class: `editable ${className}` }, display, editButton, status, original, editor);

  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cancel();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey || !multiline)) {
      event.preventDefault();
      commit();
    }
  });

  function open() {
    editing = true;
    field.value = source().text ?? "";
    update();
    field.focus();
  }
  function commit() {
    const value = field.value.trim();
    const { original: base } = source();
    save(value && value !== String(base ?? "").trim() ? value : null);
    editing = false;
    update();
    editButton.focus();
  }
  function cancel() {
    editing = false;
    update();
    editButton.focus();
  }
  function restore() {
    save(null);
    editing = false;
    update();
  }

  function update() {
    const { text, original: base, edited } = source();
    const locked = readOnly();
    editor.hidden = !editing;
    display.hidden = editing;
    editButton.hidden = editing || locked;
    // Rebuild the display only when the text changed: every answer refreshes the card.
    if (!editing && text !== rendered) {
      rendered = text;
      const node = render(text);
      display.replaceChildren(node);
      decorate?.(display);
    }
    editor.querySelector(".restore").hidden = !edited;
    status.hidden = !edited || editing;
    toggleOriginal.querySelector("span").textContent = showOriginal ? t("edit.hideOriginal") : t("edit.showOriginal");
    original.hidden = !edited || !showOriginal || editing;
    if (!original.hidden) original.replaceChildren(render(base));
  }
  update();
  return { el, update, isEditing: () => editing };
}
