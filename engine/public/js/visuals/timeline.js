// Phase timeline: the plan's phases in the chosen order, end to end, length = duration (`days`).
// Without durations, a sequence of steps. `items: [{ label, days, meta }]` replaces the phases if
// given. The visual follows the phase-order control.
import { formatValue, hoverTip, valuesTable } from "./common.js";

export default {
  kind: "timeline",
  render(v, ctx) {
    const { h, t } = ctx;
    const el = h("div", { class: "v-timeline" });
    const entries = () => (v.items
      ? v.items.map((item) => ({ title: item.label, days: Number(item.days), meta: item.meta }))
      : ctx.model.orderedPhases(ctx.plan, ctx.store.answers).map((phase) => ({ title: phase.title, days: Number(phase.days), meta: [phase.estimate, phase.cost].filter(Boolean).join(" · ") })));

    function update() {
      const list = entries();
      if (!list.length) {
        el.replaceChildren(h("p", { class: "muted" }, t("visual.noPhases")));
        return;
      }
      const timed = list.every((e) => Number.isFinite(e.days) && e.days > 0);
      if (!timed) {
        el.replaceChildren(h("ol", { class: "v-steps" }, list.map((entry, i) => h("li", {},
          h("span", { class: "v-step-rank" }, String(i + 1)),
          h("div", {}, h("div", { class: "v-step-title" }, entry.title), entry.meta ? h("div", { class: "muted" }, entry.meta) : null)))));
        return;
      }
      const total = list.reduce((sum, e) => sum + e.days, 0);
      const days = (n) => formatValue(n, t.lang, t("visual.dayUnit"));
      let start = 0;
      const rows = list.map((entry, i) => {
        const from = start;
        start += entry.days;
        const bar = h("span", { class: "v-tl-bar", style: { left: `${(from / total) * 100}%`, width: `${(entry.days / total) * 100}%` } });
        const row = h("div", { class: "v-tl-row", tabindex: "0" },
          h("div", { class: "v-tl-label" }, h("span", { class: "v-step-rank" }, String(i + 1)), h("span", { class: "v-tl-title" }, entry.title)),
          h("div", { class: "v-tl-track" }, bar),
          h("div", { class: "v-tl-meta muted" }, entry.meta || days(entry.days)));
        return hoverTip(row, ctx, () => h("div", {},
          h("span", { class: "tt-title" }, `${i + 1}. ${entry.title}`),
          t("visual.span", { duration: days(entry.days), from: formatValue(from, t.lang), to: formatValue(from + entry.days, t.lang) })));
      });
      // Ticks: start, end, and two rounded intermediate marks.
      const ticks = [...new Set([0, Math.round(total / 3), Math.round((2 * total) / 3), total])];
      el.replaceChildren(
        h("div", { class: "v-tl-rows" }, rows),
        h("div", { class: "v-tl-axis", "aria-hidden": "true" }, h("div"), h("div", { class: "v-tl-ticks" }, ticks.map((tick) =>
          h("span", { style: { left: `${(tick / total) * 100}%` } }, t("visual.dayTick", { n: formatValue(tick, t.lang) })))), h("div")),
        h("p", { class: "muted v-note" }, t("visual.totalDuration", { duration: days(total) })),
        valuesTable(t, [t("visual.phase"), t("visual.duration"), t("visual.window")], list.reduce((acc, entry, i) => {
          const from = acc.from;
          acc.rows.push([`${i + 1}. ${entry.title}`, days(entry.days), t("visual.window.range", { from: formatValue(from, t.lang), to: formatValue(from + entry.days, t.lang) })]);
          acc.from += entry.days;
          return acc;
        }, { from: 0, rows: [] }).rows));
    }
    update();
    return { el, update: v.items ? undefined : update };
  },
};
