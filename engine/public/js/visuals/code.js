// Code excerpt with line numbers: `code`, `lang`, `highlight: [lines]`, `caption`, `start`.
export default {
  kind: "code",
  render(v, ctx) {
    const { h } = ctx;
    const start = Number.isFinite(v.start) ? v.start : 1;
    const marked = new Set(v.highlight ?? []);
    const lines = String(v.code ?? "").replace(/\n$/, "").split("\n");
    return h("figure", { class: "v-code" },
      v.lang || v.caption ? h("figcaption", {}, v.caption ? h("span", {}, v.caption) : null, v.lang ? h("span", { class: "badge badge-outline badge-mono" }, v.lang) : null) : null,
      h("pre", {}, h("code", {}, lines.map((line, i) => h("span", { class: `v-code-line${marked.has(start + i) ? " marked" : ""}` },
        h("span", { class: "v-code-num", "aria-hidden": "true" }, String(start + i)), `${line}\n`)))));
  },
};
