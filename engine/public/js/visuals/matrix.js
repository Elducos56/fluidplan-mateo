// Rows × columns matrix (options side by side, slot by slot):
// `rows: ["…"]`, `columns: [{ title, icon, cells: [{ title, text, icon }] }]`.
import { assetOrIcon } from "./common.js";

export default {
  kind: "matrix",
  render(v, ctx) {
    const { h, inline } = ctx;
    const columns = v.columns ?? [];
    return h("div", { class: "table-wrap" }, h("table", { class: "table v-matrix" },
      h("thead", {}, h("tr", {}, h("th", {}), columns.map((column) => h("th", {}, h("span", { class: "v-matrix-head" }, assetOrIcon(ctx, column.icon), column.title))))),
      h("tbody", {}, (v.rows ?? []).map((label, r) => h("tr", {},
        h("th", { scope: "row" }, label),
        columns.map((column) => {
          const cell = column.cells?.[r] ?? {};
          return h("td", {}, h("div", { class: "v-matrix-cell" },
            assetOrIcon(ctx, cell.icon),
            h("div", {}, h("strong", {}, cell.title ?? ""), cell.text ? h("div", { class: "muted", html: inline(cell.text) }) : null)));
        }))))));
  },
};
