// Key figures: `stats: [{ label, value, sub }]`. When the information is a number, the number is
// the visual: no chart.
export default {
  kind: "stats",
  render(v, ctx) {
    const { h } = ctx;
    return h("div", { class: "stat-grid" }, (v.stats ?? []).map((stat) =>
      h("div", { class: "stat-tile" },
        h("div", { class: "stat-label" }, stat.label),
        h("div", { class: "stat-value v-stat-value" }, String(stat.value ?? "")),
        stat.sub ? h("div", { class: "muted v-stat-sub" }, stat.sub) : null)));
  },
};
