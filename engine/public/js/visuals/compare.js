// Comparison. `options_from: "<decision>"`: the options of a choice (pros, cons, effort, cost), with
// the chosen option highlighted. Otherwise a free table: `columns: ["…"]`, `rows: [{ label, values }]`.
import { compareTable } from "../controls.js";

export default {
  kind: "compare",
  render(v, ctx) {
    const { h, inline } = ctx;
    if (v.options_from) {
      const decision = ctx.store.decision(v.options_from);
      const el = h("div");
      const update = () => {
        const answer = ctx.store.answer(v.options_from);
        const chosen = decision.control.kind === "multi" ? ctx.model.effectiveChoices(decision, answer) : [ctx.model.effectiveChoice(decision, answer)];
        el.replaceChildren(compareTable(decision, answer, ctx, chosen));
      };
      update();
      return { el, update };
    }
    return h("div", { class: "table-wrap" }, h("table", { class: "table compare" },
      h("thead", {}, h("tr", {}, h("th", {}), (v.columns ?? []).map((c) => h("th", { html: inline(c) })))),
      h("tbody", {}, (v.rows ?? []).map((row) => h("tr", {},
        h("th", { scope: "row" }, row.label),
        (row.values ?? []).map((value) => h("td", { html: inline(String(value ?? "")) })))))));
  },
};
