// Before / after, side by side (stacked on mobile). Each pane: { title, text | code | image }.
export default {
  kind: "before_after",
  render(v, ctx) {
    const { h, md, t } = ctx;
    const pane = (side, data = {}, fallback) => h("div", { class: `v-ba-pane ${side}` },
      h("div", { class: "v-ba-title" }, ctx.icon(side === "before" ? "history" : "sparkles"), data.title ?? fallback),
      data.image ? h("img", { src: ctx.asset(data.image), alt: data.alt ?? "", loading: "lazy" }) : null,
      data.code ? h("pre", { class: "code-block" }, h("code", {}, data.code)) : null,
      data.text ? h("div", { class: "d-text", html: md(data.text) }) : null);
    return h("div", { class: "v-before-after" },
      pane("before", v.before, t("visual.before")),
      ctx.icon("arrow-right", { className: "v-ba-arrow" }),
      pane("after", v.after, t("visual.after")));
  },
};
