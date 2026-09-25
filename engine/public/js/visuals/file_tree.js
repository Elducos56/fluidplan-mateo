// Tree of the files touched. `files: [{ path, op, note }]`, or `from_tasks: true` to derive it from
// the kept tasks (it then follows the answers).
const OP_ICONS = { create: "file-plus", modify: "file-diff", delete: "file-minus" };
const OP_BADGES = { create: "success", modify: "info", delete: "danger" };

export default {
  kind: "file_tree",
  render(v, ctx) {
    const { h, t } = ctx;
    const el = h("div", { class: "v-file-tree" });

    function build(files) {
      const root = { dirs: new Map(), files: [] };
      for (const file of files) {
        const parts = String(file.path).split("/").filter(Boolean);
        let node = root;
        for (const dir of parts.slice(0, -1)) {
          if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
          node = node.dirs.get(dir);
        }
        node.files.push({ ...file, name: parts.at(-1) });
      }
      return root;
    }

    function list(node) {
      return h("ul", {},
        [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) =>
          h("li", {}, h("span", { class: "v-ft-dir" }, ctx.icon("folder-open"), `${name}/`), list(child))),
        [...node.files].sort((a, b) => a.name.localeCompare(b.name)).map((file) => {
          const op = OP_ICONS[file.op] ? file.op : "modify";
          return h("li", {}, h("span", { class: `v-ft-file op-${op}` },
            ctx.icon(OP_ICONS[op]),
            h("span", { class: "mono" }, file.name),
            h("span", { class: `badge badge-${OP_BADGES[op]}` }, t(`op.${op}`)),
            file.tasks?.length ? h("span", { class: "muted v-ft-tasks" }, file.tasks.join(", ")) : null,
            file.note ? h("span", { class: "muted" }, file.note) : null));
        }));
    }

    function update() {
      const files = v.from_tasks ? ctx.model.touchedFiles(ctx.plan, ctx.store.answers) : v.files ?? [];
      el.replaceChildren(files.length ? list(build(files)) : h("p", { class: "muted" }, t("visual.noFiles")));
    }
    update();
    return { el, update: v.from_tasks ? update : undefined };
  },
};
