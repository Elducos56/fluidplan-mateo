// Building blocks shared by the visuals.
import { h } from "../dom.js";

// The “table” view of a chart: the values stay readable without color or hover.
export function valuesTable(t, headers, rows) {
  return h("details", { class: "accordion accordion-flush chart-table" },
    h("summary", {}, h("span", { class: "accordion-label" }, t("visual.values"))),
    h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, headers.map((head) => h("th", {}, head)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, row.map((value) => h("td", {}, value))))))));
}

export function formatValue(value, lang, unit) {
  const text = Number.isFinite(value) ? new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(value) : String(value ?? "");
  return unit ? `${text} ${unit}` : text;
}

// Tooltip on hover and focus of a chart element.
export function hoverTip(target, ctx, content) {
  const show = () => {
    const rect = target.getBoundingClientRect();
    ctx.tooltip.show(content(), rect.left + rect.width / 2, rect.top);
  };
  target.addEventListener("pointerenter", show);
  target.addEventListener("focus", show);
  target.addEventListener("pointerleave", () => ctx.tooltip.hide());
  target.addEventListener("blur", () => ctx.tooltip.hide());
  return target;
}

export function assetOrIcon(ctx, value, className = "") {
  if (!value) return null;
  if (String(value).startsWith("lucide:")) return ctx.icon(String(value).slice(7), { className });
  return h("img", { src: ctx.asset(value), alt: "", class: className, loading: "lazy" });
}
