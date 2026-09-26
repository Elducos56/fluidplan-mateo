// One decision = one card: importance and state at the top, Claude's revision if there is one,
// “why it matters”, the proposal (rewritable), the figures, the visual, the options, “learn
// more”, the tasks, and the verdict in the card footer.
import { h } from "./dom.js";
import { controlFor, itemsList, tasksPanel, verdictBar } from "./controls.js";
import { editableText } from "./editable.js";
import { illustrationFor } from "./illustration.js";
import { applyGlossary } from "./glossary.js";
import { icon } from "./icons.js";
import { md, plain } from "./md.js";
import { importanceOf, readingMinutes, textOf, verdict } from "./model.js";
import { revisionNotice } from "./revision.js";
import { accordion, alert, attachFloating, badge } from "./ui.js";
import { renderVisual } from "./visuals/index.js";

export const VERDICT_STYLE = {
  ok: { icon: "circle-check", variant: "success" },
  mixed: { icon: "circle-dot", variant: "success" },
  modify: { icon: "circle-alert", variant: "warning" },
  explain: { icon: "circle-help", variant: "info" },
  ko: { icon: "circle-x", variant: "danger" },
  pending: { icon: "circle-dashed", variant: "outline" },
};

const IMPORTANCE_STYLE = {
  critical: { icon: "octagon-alert", variant: "danger-outline" },
  important: { icon: "triangle-alert", variant: "secondary" },
  minor: { icon: "circle-small", variant: "outline" },
};

export function verdictBadge(v, t) {
  const style = VERDICT_STYLE[v];
  return badge(t(`verdict.${v}`), { variant: style.variant, icon: style.icon });
}

export function renderDecision(decision, ctx, { compact = false } = {}) {
  const { store, t, plan } = ctx;
  const get = () => store.answer(decision.id);
  const set = (patch) => store.patch(decision.id, patch);
  const importance = importanceOf(decision);
  const parts = [];
  // A glossary term is explained only once per card.
  const seen = new Set();

  const phase = (plan.phases ?? []).find((p) => p.id === decision.phase);
  const revised = decision.revision?.round && decision.revision.round === ctx.state.round && ctx.state.round > 1;
  const stateSlot = h("span", { class: "d-state" });
  const meta = h("div", { class: "d-meta" },
    badge(decision.id, { variant: "outline", className: "badge-mono" }),
    badge(t(`importance.${importance}`), IMPORTANCE_STYLE[importance]),
    phase ? badge(phase.short ?? phase.title, { variant: "outline", icon: "layers", title: t("decision.phase", { title: phase.title }) }) : null,
    badge(t("decision.minutes", { n: readingMinutes(decision) }), { variant: "outline", icon: "timer", title: t("decision.minutesTitle") }),
    decision.question ? badge(t("decision.question", { n: decision.question }), { variant: "outline", icon: "message-circle-question" }) : null,
    revised ? badge(t("decision.revised"), { variant: "info", icon: "history" }) : null,
    stateSlot);

  const title = h("h2", { class: "card-title d-title" }, decision.title);
  // Minor decision: “why” goes in a tooltip, to keep the row compact.
  if (compact && decision.why) {
    const why = h("button", { type: "button", class: "why-hint", "aria-label": t("why.title") }, icon("info"));
    attachFloating(why, () => h("div", {}, h("div", { class: "hc-title" }, icon("lightbulb"), t("why.title")), h("div", { class: "hc-text", html: md(decision.why) })), { variant: "hover-card" });
    title.append(why);
  }
  const header = h("header", { class: "card-header" }, meta, title);

  const body = h("div", { class: "card-content" });
  if (revised) body.append(revisionNotice(decision, ctx.previous?.[decision.id], t));

  if (decision.why && !compact) {
    body.append(importance === "critical"
      ? alert({ variant: "warning", icon: "lightbulb", title: t("why.title"), description: h("div", { html: md(decision.why) }) })
      : h("div", { class: "why" }, icon("lightbulb"), h("div", {}, h("span", { class: "why-label" }, t("why.title")), h("div", { html: md(decision.why) }))));
  }

  if (decision.proposal) {
    const proposal = editableText({
      t,
      readOnly: ctx.readOnly,
      source: () => {
        const answer = get();
        return { text: textOf(answer, "proposal", decision.proposal), original: decision.proposal, edited: Boolean(answer.edits?.proposal) };
      },
      save: (text) => store.setEdit(decision.id, "proposal", text),
      render: (text) => h("div", { class: "d-text", html: md(text) }),
      decorate: (node) => applyGlossary(node, ctx.glossary, seen),
    });
    parts.push(proposal);
    body.append(proposal.el);
  }

  if (decision.facts?.length) {
    body.append(h("dl", { class: "facts" }, decision.facts.map((fact) => h("div", { class: "fact" }, h("dt", {}, fact.label), h("dd", {}, fact.value)))));
  }

  if (decision.visual) {
    const visual = renderVisual(decision.visual, ctx);
    const illustration = illustrationFor(`decision:${decision.id}`, decision.visual, ctx);
    parts.push(visual);
    body.append(h("div", { class: "d-visual" }, illustration?.el, visual.el));
  }

  if (decision.items?.length) {
    const list = itemsList(decision, ctx);
    parts.push(list);
    body.append(list.el);
  } else if (decision.control) {
    const control = controlFor(decision, ctx);
    parts.push(control);
    body.append(h("div", { class: "d-control" }, control.el));
  }

  const extras = h("div", { class: "d-extras" });
  if (decision.learn_more) {
    extras.append(accordion({ label: t("learnMore.title"), icon: "book-open", content: () => h("div", { class: "d-text", html: md(decision.learn_more) }) }));
  }
  const tasks = tasksPanel(decision, ctx);
  const tasksCount = h("span", { class: "badge badge-secondary" });
  if (hasAnyTask(decision)) {
    parts.push(tasks);
    extras.append(accordion({ label: t("tasks.title"), icon: "list-checks", right: tasksCount, content: tasks.el }));
  }
  if (extras.childNodes.length) body.append(extras);

  const bar = verdictBar({
    get,
    set,
    t,
    compact,
    readOnly: ctx.readOnly,
    kinds: decision.items?.length ? ["explain"] : ["ok", "ko", "modify", "explain"],
    noteLabel: decision.items?.length ? t("comment.addGeneral") : undefined,
  });
  parts.push(bar);

  const el = h("section", {
    class: `card decision${compact ? " compact" : ""}`,
    id: `d-${decision.id}`,
    "aria-labelledby": `d-${decision.id}-title`,
    dataset: { importance },
  }, header, body, h("footer", { class: "card-footer bordered" }, bar.el));
  title.id = `d-${decision.id}-title`;
  applyGlossary(body, ctx.glossary, seen);

  function update() {
    const v = verdict(decision, get());
    el.dataset.status = v;
    stateSlot.replaceChildren(verdictBadge(v, t));
    tasksCount.textContent = String(tasks.count());
    for (const part of parts) part.update?.();
  }
  update();
  return { id: decision.id, decision, el, update, title: plain(decision.title) };
}

function hasAnyTask(decision) {
  return Boolean(decision.tasks?.length || decision.control?.options?.some((o) => o.tasks?.length) || decision.items?.some((i) => i.tasks?.length));
}
