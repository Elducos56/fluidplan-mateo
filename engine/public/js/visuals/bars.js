// Horizontal bars, a single series: `bars: [{ label, value }]`, or `bars_from_phases: true` (phase
// durations, in the chosen order — the visual then follows the answer). `unit`, `total_label`,
// `note`. One series = one color, no legend; the value sits at the end of the bar.
import { formatValue, hoverTip, valuesTable } from "./common.js";

export default {
  kind: "bars",
  render(v, ctx) {
    const { h, t } = ctx;
    const el = h("div", { class: "v-bars" });
    const entries = () => {
      if (!v.bars_from_phases) return v.bars ?? [];
      return ctx.model.orderedPhases(ctx.plan, ctx.store.answers).map((phase, i) => ({ label: `${i + 1}. ${phase.title}`, value: Number(phase.days ?? 0) }));
    };
    function update() {
      const list = entries();
      const max = Math.max(1, ...list.map((e) => Number(e.value) || 0));
      const unit = v.unit ?? (v.bars_from_phases ? t("visual.dayUnit") : "");
      const format = (value) => formatValue(value, t.lang, unit);
      const rows = list.map((entry) => {
        const fill = h("span", { class: "v-bar-fill", style: { width: `${((Number(entry.value) || 0) / max) * 100}%` } });
        const row = h("div", { class: "v-bar-row", tabindex: "0" },
          h("span", { class: "v-bar-label" }, entry.label),
          h("span", { class: "v-bar-track" }, fill, h("span", { class: "v-bar-value" }, format(entry.value))));
        return hoverTip(row, ctx, () => h("div", {}, h("span", { class: "tt-title" }, entry.label), format(entry.value)));
      });
      const total = list.reduce((sum, e) => sum + (Number(e.value) || 0), 0);
      el.replaceChildren(
        h("div", { class: "v-bar-list" }, rows),
        v.total_label ? h("div", { class: "v-bar-total" }, h("span", {}, v.total_label), h("strong", {}, format(total))) : null,
        v.note ? h("p", { class: "muted v-note" }, v.note) : null,
        valuesTable(t, [t("visual.label"), t("visual.value")], list.map((e) => [e.label, format(e.value)])));
    }
    update();
    return { el, update: v.bars_from_phases ? update : undefined };
  },
};
