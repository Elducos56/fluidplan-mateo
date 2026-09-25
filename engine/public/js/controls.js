// What can be touched in a decision: the verdict (OK, Not OK, Change, Explain + remark), item
// lists reviewed one by one, option controls (choice, selection, number, order) and the task
// list. Each component returns { el, update }: `update()` re-reads the Store without rebuilding
// the DOM, so it never steals focus from a field being typed in.
import { h } from "./dom.js";
import { editableText } from "./editable.js";
import { icon } from "./icons.js";
import { inline, md } from "./md.js";
import { OTHER, decisionTasks, effectiveValue, itemVerdict, optionLabel, orderedPhases, textOf } from "./model.js";
import { badge, button, selectBox, toggleGroup } from "./ui.js";

export const VERDICT_ICONS = { ok: "check", ko: "x", modify: "pencil", explain: "circle-help" };

// Verdict bar. `kinds`: the possible answers (an item list only has “Explain”, its verdict is
// derived from the items). “Change” and “Explain” require a text.
export function verdictBar({ get, set, t, compact = false, kinds = ["ok", "ko", "modify", "explain"], readOnly = () => false, noteLabel }) {
  let noteOpen = false;
  const comment = compact
    ? h("input", { class: "input comment", type: "text" })
    : h("textarea", { class: "textarea comment", rows: 2 });
  comment.addEventListener("input", () => set({ comment: comment.value }));
  const group = toggleGroup({
    items: kinds.map((kind) => ({ value: kind, label: t(`action.${kind}`), title: t(`action.${kind}.hint`), icon: VERDICT_ICONS[kind], tone: kind })),
    get: () => get().status ?? null,
    onSelect: (value) => {
      set({ status: value });
      if (value === "modify" || value === "explain") {
        noteOpen = true;
        update();
        comment.focus();
      }
    },
    ariaLabel: t("verdict.aria"),
    compact,
    labels: !compact,
  });
  const hint = h("p", { class: "field-hint error" });
  const addNote = compact ? null : button({
    label: noteLabel ?? t("comment.add"),
    variant: "link",
    size: "sm",
    className: "add-note",
    onclick: () => {
      noteOpen = true;
      update();
      comment.focus();
    },
  });
  const el = h("div", { class: `verdict${compact ? " compact" : ""}` }, h("div", { class: "verdict-row" }, group.el, addNote), comment, hint);

  function update() {
    const current = get();
    const locked = readOnly();
    group.update();
    group.setDisabled(locked);
    comment.disabled = locked;
    const text = String(current.comment ?? "");
    const needsText = current.status === "modify" || current.status === "explain";
    const visible = noteOpen || text.trim() !== "" || needsText;
    comment.hidden = !visible;
    if (addNote) addNote.hidden = visible || locked;
    comment.placeholder = current.status === "explain" ? t("comment.question") : current.status === "modify" ? t("comment.modify") : t("comment.remark");
    if (document.activeElement !== comment && comment.value !== text) comment.value = text;
    const missing = needsText && !text.trim() && !Object.values(current.edits ?? {}).some((v) => String(v).trim());
    comment.setAttribute("aria-invalid", String(missing));
    hint.hidden = !missing || compact;
    hint.textContent = current.status === "explain" ? t("comment.needQuestion") : t("comment.needModify");
  }
  update();
  return { el, update, comment };
}

// --- item lists -------------------------------------------------------------------------------------

export function itemsList(decision, ctx) {
  const { store, t } = ctx;
  const rows = [];
  const list = h("div", { class: "items" });
  for (const item of decision.items) {
    const bar = verdictBar({
      compact: true,
      t,
      kinds: ["ok", "ko", "modify"],
      readOnly: ctx.readOnly,
      get: () => store.answer(decision.id).items?.[item.id] ?? {},
      set: (patch) => store.patchItem(decision.id, item.id, patch),
    });
    const kind = item.node?.kind ?? "plain";
    const media = item.icon?.startsWith("lucide:")
      ? h("span", { class: "item-lucide", "aria-hidden": "true" }, icon(item.icon.slice(7)))
      : item.icon
        ? h("img", { class: "item-icon", src: ctx.asset(item.icon), alt: "", loading: "lazy" })
        : h("span", { class: `item-medal medal-${kind}`, "aria-hidden": "true" }, initials(item.title));
    const detail = item.detail !== undefined
      ? editableText({
        t,
        readOnly: ctx.readOnly,
        source: () => {
          const answer = store.answer(decision.id);
          const key = `items/${item.id}/detail`;
          return { text: textOf(answer, key, item.detail), original: item.detail, edited: Boolean(answer.edits?.[key]) };
        },
        save: (text) => store.setEdit(decision.id, `items/${item.id}/detail`, text),
        render: (text) => h("div", { class: "item-detail", html: md(text) }),
        className: "compact",
      })
      : null;
    const title = h("div", { class: "item-title" }, h("span", { html: inline(item.title) }), item.tag ? badge(item.tag, { variant: kind === "key" ? "warning" : "secondary" }) : null);
    const row = h("div", { class: "item", id: `item-${decision.id}-${item.id}` },
      media,
      h("div", { class: "item-main" }, title, detail?.el),
      h("div", { class: "item-verdict" }, bar.el.querySelector(".toggle-group")),
      bar.comment);
    bar.comment.placeholder = t("comment.item");
    rows.push({ row, bar, item, detail });
    list.append(row);
  }
  const counter = h("span", { class: "muted" });
  const allOk = button({
    label: t("items.restOk"),
    icon: "check",
    variant: "ghost",
    size: "sm",
    onclick: () => {
      for (const item of decision.items) {
        if (!store.answer(decision.id).items?.[item.id]?.status) store.patchItem(decision.id, item.id, { status: "ok" });
      }
    },
  });
  const el = h("div", { class: "items-wrap" }, h("div", { class: "items-head" }, counter, allOk), list);

  function update() {
    const answer = store.answer(decision.id);
    let decided = 0;
    for (const { row, bar, item, detail } of rows) {
      bar.update();
      detail?.update();
      const v = itemVerdict(answer, item.id);
      row.dataset.status = v;
      if (v !== "pending") decided += 1;
    }
    counter.textContent = t("items.judged", { done: decided, total: rows.length });
    allOk.hidden = decided === rows.length || ctx.readOnly();
  }
  update();
  return { el, update };
}

function initials(title) {
  const clean = String(title).replace(/^[^:]{1,12}:\s*/, "").replace(/[`*]/g, "");
  return clean.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// --- option controls ------------------------------------------------------------------------------------

export function controlFor(decision, ctx) {
  switch (decision.control.kind) {
    case "choice":
      return optionsControl(decision, ctx, false);
    case "multi":
      return optionsControl(decision, ctx, true);
    case "number":
      return numberControl(decision, ctx);
    case "order":
      return orderControl(decision, ctx);
    default:
      return { el: h("p", { class: "muted" }, `${decision.control.kind}?`) };
  }
}

// Single choice (radio buttons as cards) or multiple selection (checkboxes). Picking an option
// accepts it; “Another option” asks to say which one.
function optionsControl(decision, ctx, multi) {
  const { store, t } = ctx;
  const control = decision.control;
  const options = multi ? control.options : [...control.options, { id: OTHER, label: t("choice.other"), detail: t("choice.otherDetail"), other: true }];
  const get = () => store.answer(decision.id);

  const pick = (id) => {
    if (multi) {
      const picked = cards.filter((c) => c.input.checked).map((c) => c.option.id);
      const status = get().status;
      store.patch(decision.id, { choices: picked, status: status && status !== "ko" ? status : "ok" });
    } else {
      store.patch(decision.id, { choice: id, status: id === OTHER ? "modify" : "ok" });
    }
  };

  // Beyond five options without explanations, a dropdown stays easier to read.
  const rich = control.options.some((o) => o.pros?.length || o.cons?.length || o.effort || o.cost || o.detail);
  if (!multi && options.length > 5 && !rich) {
    const box = selectBox({
      options: options.map((o) => ({ value: o.id, label: `${o.label}${o.recommended ? ` (${t("choice.recommended")})` : ""}` })),
      value: get().choice,
      placeholder: t("choice.placeholder"),
      ariaLabel: decision.title,
      onChange: (value) => value && pick(value),
    });
    return { el: box.el, update: () => { box.select.value = get().choice ?? ""; box.select.disabled = ctx.readOnly(); } };
  }

  const name = `choice-${decision.id}`;
  const cards = options.map((option) => {
    const input = h("input", { type: multi ? "checkbox" : "radio", name, value: option.id, onchange: () => pick(option.id) });
    const label = h("span", { class: "rc-label" });
    const detail = h("div", { class: "rc-detail" });
    const title = h("span", { class: "rc-title" }, label, option.recommended ? badge(t("choice.recommended"), { variant: "default", icon: "sparkles" }) : null);
    const body = h("div", { class: "rc-body" }, detail);
    if (option.pros?.length || option.cons?.length) {
      body.append(h("ul", { class: "pros-cons", "aria-label": t("choice.prosCons") },
        (option.pros ?? []).map((p) => h("li", { class: "pro" }, icon("plus", { label: t("choice.pro") }), h("span", { html: inline(p) }))),
        (option.cons ?? []).map((c) => h("li", { class: "con" }, icon("minus", { label: t("choice.con") }), h("span", { html: inline(c) })))));
    }
    const meta = [
      option.effort ? badge(t("choice.effort", { value: option.effort }), { variant: "outline", icon: "gauge" }) : null,
      option.cost ? badge(t("choice.cost", { value: option.cost }), { variant: "outline" }) : null,
    ].filter(Boolean);
    if (meta.length) body.append(h("div", { class: "rc-meta" }, meta));
    const card = h("label", { class: `radio-card${option.other ? " other" : ""}` }, input, title, body);
    return { card, input, option, label, detail };
  });

  const compare = h("div", { class: "compare-wrap", hidden: true });
  const compareButton = rich && control.options.length > 1
    ? button({
      label: t("choice.compare"),
      icon: "columns-2",
      variant: "outline",
      size: "sm",
      onclick: () => {
        compare.hidden = !compare.hidden;
        compareButton.querySelector("span").textContent = compare.hidden ? t("choice.compare") : t("choice.hideCompare");
        update();
      },
    })
    : null;
  // Rewriting an option: label and detail, in a small form under the cards.
  const rewrite = !multi ? optionRewriter(decision, ctx) : null;
  const el = h("div", { class: "options-control" },
    h("div", { class: "radio-cards", role: multi ? "group" : "radiogroup", "aria-label": decision.title }, cards.map((c) => c.card)),
    compareButton || rewrite ? h("div", { class: "options-tools" }, compareButton, rewrite?.trigger) : null,
    rewrite?.el,
    compare);

  function update() {
    const answer = get();
    const chosen = multi ? answer.choices ?? [] : [answer.choice];
    const locked = ctx.readOnly();
    for (const { input, option, label, detail } of cards) {
      input.checked = chosen.includes(option.id);
      input.disabled = locked;
      label.innerHTML = inline(option.other ? option.label : optionLabel(decision, answer, option));
      const text = option.other ? option.detail : textOf(answer, `options/${option.id}/detail`, option.detail);
      detail.innerHTML = text ? inline(text) : "";
      detail.hidden = !text;
    }
    if (!compare.hidden) compare.replaceChildren(compareTable(decision, answer, ctx, chosen));
    rewrite?.update();
  }
  update();
  return { el, update };
}

// Options × criteria table, with the chosen option highlighted.
export function compareTable(decision, answer, ctx, chosen = []) {
  const { t } = ctx;
  const options = decision.control.options;
  const rows = [
    [t("choice.detail"), (o) => h("span", { html: inline(textOf(answer, `options/${o.id}/detail`, o.detail) ?? "") })],
    [t("choice.pros"), (o) => list(o.pros, "pro")],
    [t("choice.cons"), (o) => list(o.cons, "con")],
    [t("choice.effortLabel"), (o) => o.effort ?? "—"],
    [t("choice.costLabel"), (o) => o.cost ?? "—"],
  ].filter(([, render]) => options.some((o) => {
    const value = render(o);
    return value instanceof Node ? value.textContent.trim() : value !== "—";
  }));
  function list(values, kind) {
    if (!values?.length) return h("span", { class: "muted" }, "—");
    return h("ul", { class: "pros-cons" }, values.map((v) => h("li", { class: kind }, icon(kind === "pro" ? "plus" : "minus"), h("span", { html: inline(v) }))));
  }
  return h("div", { class: "table-wrap" }, h("table", { class: "table compare" },
    h("thead", {}, h("tr", {}, h("th", {}), options.map((o) => h("th", { class: chosen.includes(o.id) ? "chosen" : "" },
      h("span", { html: inline(optionLabel(decision, answer, o)) }), o.recommended ? badge(t("choice.recommended"), { variant: "default" }) : null)))),
    h("tbody", {}, rows.map(([label, render]) => h("tr", {}, h("th", { scope: "row" }, label), options.map((o) => h("td", { class: chosen.includes(o.id) ? "chosen" : "" }, render(o))))))));
}

function optionRewriter(decision, ctx) {
  const { store, t } = ctx;
  const select = h("select", { class: "select", "aria-label": t("choice.rewriteWhich") }, decision.control.options.map((o) => h("option", { value: o.id }, o.label)));
  const labelField = h("input", { class: "input", type: "text", "aria-label": t("choice.rewriteLabel") });
  const detailField = h("textarea", { class: "textarea", rows: 2, "aria-label": t("choice.rewriteDetail") });
  const load = () => {
    const answer = store.answer(decision.id);
    const option = decision.control.options.find((o) => o.id === select.value);
    labelField.value = textOf(answer, `options/${option.id}/label`, option.label);
    detailField.value = textOf(answer, `options/${option.id}/detail`, option.detail) ?? "";
  };
  select.addEventListener("change", load);
  const form = h("div", { class: "option-rewrite", hidden: true },
    h("div", { class: "field" }, h("span", { class: "label" }, t("choice.rewriteWhich")), h("span", { class: "select-wrap" }, select, icon("chevrons-up-down"))),
    h("div", { class: "field" }, h("span", { class: "label" }, t("choice.rewriteLabel")), labelField),
    h("div", { class: "field" }, h("span", { class: "label" }, t("choice.rewriteDetail")), detailField),
    h("div", { class: "editable-buttons" },
      button({
        label: t("edit.save"),
        size: "sm",
        onclick: () => {
          const option = decision.control.options.find((o) => o.id === select.value);
          const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
          store.setEdit(decision.id, `options/${option.id}/label`, same(labelField.value, option.label) ? null : labelField.value);
          store.setEdit(decision.id, `options/${option.id}/detail`, same(detailField.value, option.detail) ? null : detailField.value);
          form.hidden = true;
        },
      }),
      button({ label: t("edit.cancel"), size: "sm", variant: "ghost", onclick: () => { form.hidden = true; } })));
  const trigger = button({
    label: t("choice.rewrite"),
    icon: "square-pen",
    variant: "ghost",
    size: "sm",
    onclick: () => {
      form.hidden = !form.hidden;
      if (!form.hidden) {
        load();
        labelField.focus();
      }
    },
  });
  return { el: form, trigger, update: () => { trigger.hidden = ctx.readOnly(); } };
}

function numberControl(decision, ctx) {
  const { store, t } = ctx;
  const c = decision.control;
  const range = h("input", { type: "range", class: "slider", min: c.min, max: c.max, step: c.step ?? 1, "aria-label": decision.title });
  const output = h("output", { class: "number-value" });
  const set = (value) => {
    const status = store.answer(decision.id).status;
    store.patch(decision.id, { value: Number(value), status: status && status !== "ko" ? status : "ok" });
  };
  range.addEventListener("input", () => set(range.value));
  const reset = button({ label: t("number.reset"), variant: "link", size: "sm", onclick: () => set(c.default) });
  const el = h("div", { class: "number" },
    h("div", { class: "number-row" }, range, h("div", { class: "number-readout" }, output, c.unit ? h("span", { class: "muted" }, c.unit) : null)),
    h("div", { class: "number-foot muted" }, h("span", {}, t("number.proposed", { value: `${c.default}${c.unit ? ` ${c.unit}` : ""}` })), reset));
  function update() {
    const shown = effectiveValue(decision, store.answer(decision.id));
    if (document.activeElement !== range) range.value = String(shown);
    range.style.setProperty("--fill", `${((shown - c.min) / (c.max - c.min)) * 100}%`);
    output.textContent = String(shown);
    range.disabled = ctx.readOnly();
    reset.hidden = shown === c.default || ctx.readOnly();
  }
  update();
  return { el, update };
}

// Phase order: arrows or drag and drop. Moving a phase accepts the order.
function orderControl(decision, ctx) {
  const { store, t } = ctx;
  const list = h("ol", { class: "order" });
  let dragged = null;
  const currentIds = () => orderedPhases(ctx.plan, { [decision.id]: store.answer(decision.id) }).map((phase) => phase.id);
  const commit = (ids) => {
    const status = store.answer(decision.id).status;
    store.patch(decision.id, { order: ids, status: status && status !== "ko" ? status : "ok" });
  };
  const move = (index, delta) => {
    const ids = currentIds();
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    commit(ids);
  };
  function update() {
    const phases = orderedPhases(ctx.plan, { [decision.id]: store.answer(decision.id) });
    const locked = ctx.readOnly();
    list.replaceChildren(...phases.map((phase, index) => {
      const li = h("li", { draggable: String(!locked), dataset: { id: phase.id } },
        icon("grip-vertical", { className: "grip" }),
        h("span", { class: "rank" }, String(index + 1)),
        h("div", { class: "order-main" }, h("div", { class: "order-title" }, phase.title), h("div", { class: "muted order-meta" }, [phase.estimate, phase.cost].filter(Boolean).join(" · "))),
        h("div", { class: "order-moves" },
          button({ icon: "arrow-up", variant: "ghost", size: "sm", title: t("order.up"), disabled: locked || index === 0, onclick: () => move(index, -1) }),
          button({ icon: "arrow-down", variant: "ghost", size: "sm", title: t("order.down"), disabled: locked || index === phases.length - 1, onclick: () => move(index, 1) })));
      li.addEventListener("dragstart", () => { dragged = phase.id; li.classList.add("dragging"); });
      li.addEventListener("dragend", () => { dragged = null; li.classList.remove("dragging"); });
      li.addEventListener("dragover", (event) => { event.preventDefault(); li.classList.add("over"); });
      li.addEventListener("dragleave", () => li.classList.remove("over"));
      li.addEventListener("drop", (event) => {
        event.preventDefault();
        li.classList.remove("over");
        if (!dragged || dragged === phase.id) return;
        const ids = currentIds().filter((id) => id !== dragged);
        ids.splice(ids.indexOf(phase.id), 0, dragged);
        commit(ids);
      });
      return li;
    }));
  }
  update();
  return { el: h("div", {}, list), update };
}

// --- tasks -----------------------------------------------------------------------------------------------

// What the decision involves: the tasks kept for the answer (the choice changes the list).
export function tasksPanel(decision, ctx) {
  const { store, t } = ctx;
  const listEl = h("div", { class: "tasks" });
  const editors = [];
  function render() {
    editors.length = 0;
    const answer = store.answer(decision.id);
    const tasks = decisionTasks(decision, answer);
    if (!tasks.length) {
      listEl.replaceChildren(h("p", { class: "muted" }, t("tasks.none")));
      return;
    }
    listEl.replaceChildren(...tasks.map((task) => {
      const title = editableText({
        t,
        multiline: false,
        readOnly: ctx.readOnly,
        source: () => {
          const a = store.answer(decision.id);
          const key = `tasks/${task.id}/title`;
          const resolved = decisionTasks(decision, a).find((x) => x.id === task.id);
          return { text: resolved?.title ?? task.title, original: findTask(decision, task.id)?.title, edited: Boolean(a.edits?.[key]) };
        },
        save: (text) => store.setEdit(decision.id, `tasks/${task.id}/title`, text),
        render: (text) => h("span", { class: "task-title" }, text),
        className: "inline",
      });
      const acceptance = editableText({
        t,
        readOnly: ctx.readOnly,
        source: () => {
          const a = store.answer(decision.id);
          const key = `tasks/${task.id}/acceptance`;
          const resolved = decisionTasks(decision, a).find((x) => x.id === task.id);
          return { text: (resolved?.acceptance ?? []).join("\n"), original: (findTask(decision, task.id)?.acceptance ?? []).join("\n"), edited: Boolean(a.edits?.[key]) };
        },
        save: (text) => store.setEdit(decision.id, `tasks/${task.id}/acceptance`, text),
        render: (text) => {
          const lines = String(text ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
          return lines.length
            ? h("ul", { class: "acceptance" }, lines.map((line) => h("li", {}, icon("circle-check", { className: "icon-sm" }), h("span", { html: inline(line) }))))
            : h("span", { class: "muted" }, t("tasks.noAcceptance"));
        },
        className: "compact",
      });
      editors.push(title, acceptance);
      const files = (task.files ?? []).map((file) => h("span", { class: `file-chip op-${file.op ?? "modify"}`, title: t(`op.${file.op ?? "modify"}`) },
        icon(file.op === "create" ? "file-plus" : file.op === "delete" ? "file-minus" : "file-diff", { className: "icon-sm" }), file.path));
      return h("div", { class: "task" },
        h("div", { class: "task-head" }, icon("list-checks", { className: "task-icon" }), title.el),
        task.do ? h("div", { class: "task-do", html: md(task.do) }) : null,
        files.length ? h("div", { class: "task-files" }, files) : null,
        h("div", { class: "task-section" }, h("span", { class: "task-label" }, t("tasks.acceptance")), acceptance.el),
        task.verify?.length ? h("div", { class: "task-section" }, h("span", { class: "task-label" }, t("tasks.verify")), h("div", { class: "task-verify" }, task.verify.map((command) => h("code", {}, command)))) : null);
    }));
  }
  render();
  let signature = JSON.stringify(decisionTasks(decision, store.answer(decision.id)).map((task) => task.id));
  return {
    el: listEl,
    count: () => decisionTasks(decision, store.answer(decision.id)).length,
    update() {
      const next = JSON.stringify(decisionTasks(decision, store.answer(decision.id)).map((task) => task.id));
      // The list changes with the choice; otherwise refresh in place, without losing text being typed.
      if (next !== signature && !editors.some((e) => e.isEditing())) {
        signature = next;
        render();
      } else {
        for (const editor of editors) editor.update();
      }
    },
  };
}

function findTask(decision, id) {
  const all = [...(decision.tasks ?? []), ...(decision.control?.options ?? []).flatMap((o) => o.tasks ?? []), ...(decision.items ?? []).flatMap((i) => i.tasks ?? [])];
  return all.find((task) => task.id === id);
}
