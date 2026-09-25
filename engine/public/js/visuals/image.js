// An image from the plan (screenshot, mockup): `src`, `alt`, `caption`. Without `src`, with a
// `prompt`: the image to generate, which the illustration slot shows instead.
export default {
  kind: "image",
  render(v, ctx) {
    const { h } = ctx;
    if (!v.src) return h("div", { hidden: true });
    return h("figure", { class: "v-image" },
      h("img", { src: ctx.asset(v.src), alt: v.alt ?? "", loading: "lazy" }),
      v.caption ? h("figcaption", { class: "muted" }, v.caption) : null);
  },
};
