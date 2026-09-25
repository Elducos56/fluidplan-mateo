// Risk matrix, likelihood × impact (1 to 3). `risks: [{ id, label, likelihood, impact,
// mitigation }]`. Severity (the product) tints the cell and is also spelled out, with its icon:
// color never carries the meaning alone.
const LEVELS = [
  { key: "low", icon: "circle-check", max: 2 },
  { key: "medium", icon: "triangle-alert", max: 4 },
  { key: "high", icon: "octagon-alert", max: 9 },
];
const severity = (risk) => LEVELS.find((level) => risk.likelihood * risk.impact <= level.max) ?? LEVELS[2];

export default {
  kind: "risk_matrix",
  validate(v) {
    const problems = [];
    for (const risk of v.risks ?? []) {
      for (const key of ["likelihood", "impact"]) {
        if (![1, 2, 3].includes(risk[key])) problems.push(`risk "${risk.label ?? risk.id}": "${key}" must be 1, 2 or 3`);
      }
    }
    return problems;
  },
  render(v, ctx) {
    const { h, t, inline } = ctx;
    const risks = (v.risks ?? []).map((risk, i) => ({ ...risk, n: i + 1, level: severity(risk) }));
    const cells = [];
    for (let impact = 3; impact >= 1; impact -= 1) {
      cells.push(h("div", { class: "v-rm-axis-y" }, t(`visual.risk.level${impact}`)));
      for (let likelihood = 1; likelihood <= 3; likelihood += 1) {
        const level = severity({ likelihood, impact });
        const inside = risks.filter((r) => r.likelihood === likelihood && r.impact === impact);
        cells.push(h("div", { class: `v-rm-cell sev-${level.key}` }, inside.map((risk) => {
          const marker = h("button", { type: "button", class: "v-rm-marker", "aria-label": `${risk.n}. ${risk.label}` }, String(risk.n));
          const show = () => {
            const rect = marker.getBoundingClientRect();
            ctx.tooltip.show(h("div", {}, h("span", { class: "tt-title" }, `${risk.n}. ${risk.label}`), risk.mitigation ? h("span", {}, risk.mitigation) : null), rect.left + rect.width / 2, rect.top);
          };
          marker.addEventListener("pointerenter", show);
          marker.addEventListener("focus", show);
          marker.addEventListener("pointerleave", () => ctx.tooltip.hide());
          marker.addEventListener("blur", () => ctx.tooltip.hide());
          return marker;
        })));
      }
    }
    cells.push(h("div"), ...[1, 2, 3].map((n) => h("div", { class: "v-rm-axis-x" }, t(`visual.risk.level${n}`))));
    return h("div", { class: "v-risk" },
      h("div", { class: "v-rm-wrap" },
        h("div", { class: "v-rm-ylabel" }, t("visual.risk.impact")),
        h("div", { class: "v-rm-grid", role: "img", "aria-label": t("visual.risk.aria") }, cells),
        h("div", { class: "v-rm-xlabel" }, t("visual.risk.likelihood"))),
      h("div", { class: "v-rm-legend" }, LEVELS.map((level) => h("span", { class: `v-rm-key sev-${level.key}` }, ctx.icon(level.icon), t(`visual.risk.${level.key}`)))),
      h("ol", { class: "v-rm-list" }, risks.map((risk) => h("li", {},
        h("span", { class: "v-rm-marker static" }, String(risk.n)),
        h("div", {},
          h("div", { class: "v-rm-title" }, h("span", { html: inline(risk.label) }), h("span", { class: `badge badge-${risk.level.key === "high" ? "danger" : risk.level.key === "medium" ? "warning" : "secondary"}` }, ctx.icon(risk.level.icon), t(`visual.risk.${risk.level.key}`))),
          risk.mitigation ? h("div", { class: "muted", html: inline(risk.mitigation) }) : null)))));
  },
};
