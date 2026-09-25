// Declarative diagram: boxes placed on a grid, and arrows.
//   nodes: [{ id, label, sub, col, row, tone }]   tone: default | primary | muted | success | warning | danger
//   edges: [{ from, to, label, dashed }]
// No layout engine: `col` / `row` are enough for a plan's diagrams, and stay readable.
// Anchor points are spread along each side of a box, so that two arrows never leave from the same
// point; an edge label is truncated to the room available (full text on hover).
const COL_W = 244;
const ROW_H = 112;
const NODE_W = 164;
const NODE_H = 56;
const PAD = 12;
const CHARS = 22;
const CHAR_PX = 6.2;
const MIN_READABLE_PX = 560;

function wrap(text, max = CHARS) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line ? `${line} ${word}` : word).length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 2) lines.splice(1, lines.length - 1, `${lines.slice(1).join(" ").slice(0, max - 1)}…`);
  return lines;
}

function fit(text, px) {
  const max = Math.max(3, Math.floor(px / CHAR_PX));
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export default {
  kind: "diagram",
  validate(v) {
    const ids = new Set((v.nodes ?? []).map((n) => n.id));
    const problems = [];
    for (const node of v.nodes ?? []) {
      if (!Number.isInteger(node.col) || !Number.isInteger(node.row)) problems.push(`node "${node.id}": "col" and "row" must be integers (0, 1, 2…)`);
    }
    for (const edge of v.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push(`arrow ${edge.from} → ${edge.to}: unknown node`);
    }
    return problems;
  },
  render(v, ctx) {
    const { h, svg } = ctx;
    const nodes = v.nodes ?? [];
    const cols = Math.max(1, ...nodes.map((n) => n.col + 1));
    const rows = Math.max(1, ...nodes.map((n) => n.row + 1));
    const W = (cols - 1) * COL_W + NODE_W + PAD * 2;
    const H = (rows - 1) * ROW_H + NODE_H + PAD * 2;
    const pos = new Map(nodes.map((n) => [n.id, { x: PAD + n.col * COL_W, y: PAD + n.row * ROW_H, node: n }]));

    // Sides used by each edge: horizontal between columns, vertical within the same column.
    const edges = (v.edges ?? []).filter((e) => pos.has(e.from) && pos.has(e.to)).map((edge) => {
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      if (a.node.col !== b.node.col) {
        const forward = b.x > a.x;
        return { edge, a, b, horizontal: true, sideA: forward ? "right" : "left", sideB: forward ? "left" : "right" };
      }
      const down = b.y > a.y;
      return { edge, a, b, horizontal: false, sideA: down ? "bottom" : "top", sideB: down ? "top" : "bottom" };
    });
    const slots = new Map();
    const claim = (p, side, other) => {
      const key = `${p.node.id}:${side}`;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(other);
    };
    for (const e of edges) {
      claim(e.a, e.sideA, e.b);
      claim(e.b, e.sideB, e.a);
    }
    // The anchors on a side are sorted by the position of the other end: no needless crossing.
    for (const list of slots.values()) list.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    const anchor = (p, side, other) => {
      const list = slots.get(`${p.node.id}:${side}`);
      const k = list.indexOf(other);
      const f = (k + 1) / (list.length + 1);
      if (side === "right") return { x: p.x + NODE_W, y: p.y + NODE_H * f };
      if (side === "left") return { x: p.x, y: p.y + NODE_H * f };
      if (side === "bottom") return { x: p.x + NODE_W * f, y: p.y + NODE_H };
      return { x: p.x + NODE_W * f, y: p.y };
    };

    const markerId = `arrow-${Math.random().toString(36).slice(2, 8)}`;
    const root = svg("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "v-diagram",
      role: "img",
      "aria-label": v.caption ?? ctx.t("visual.diagram"),
      style: { "max-width": `${W}px`, "min-width": `${Math.min(W, MIN_READABLE_PX)}px` },
    }, svg("defs", {}, svg("marker", { id: markerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      svg("path", { d: "M0 0 L10 5 L0 10 z", class: "v-dg-arrow" }))));

    const labels = [];
    for (const e of edges) {
      const p1 = anchor(e.a, e.sideA, e.b);
      const p2 = anchor(e.b, e.sideB, e.a);
      let d;
      if (e.horizontal) {
        const bend = (p2.x - p1.x) / 2;
        d = `M${p1.x} ${p1.y} C${p1.x + bend} ${p1.y} ${p2.x - bend} ${p2.y} ${p2.x} ${p2.y}`;
      } else {
        const bend = (p2.y - p1.y) / 2;
        d = `M${p1.x} ${p1.y} C${p1.x} ${p1.y + bend} ${p2.x} ${p2.y - bend} ${p2.x} ${p2.y}`;
      }
      root.append(svg("path", { d, class: `v-dg-edge${e.edge.dashed ? " dashed" : ""}`, "marker-end": `url(#${markerId})` }));
      if (e.edge.label) {
        // Above the line (to the right for a vertical arrow), in the free space between the boxes.
        const room = e.horizontal ? Math.abs(p2.x - p1.x) - 12 : COL_W - NODE_W / 2 - 16;
        const text = fit(e.edge.label, room);
        const width = text.length * CHAR_PX + 10;
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const x = e.horizontal ? mx - width / 2 : mx + 6;
        const y = e.horizontal ? Math.min(p1.y, p2.y) - 20 : my - 10;
        labels.push(svg("g", {},
          svg("rect", { x, y, width, height: 18, rx: 4, class: "v-dg-edge-bg" }),
          svg("text", { x: x + width / 2, y: y + 13, "text-anchor": "middle", class: "v-dg-edge-label" }, text),
          text !== e.edge.label ? svg("title", {}, e.edge.label) : null));
      }
    }

    for (const { x, y, node } of pos.values()) {
      const lines = wrap(node.label);
      const group = svg("g", { class: `v-dg-node tone-${node.tone ?? "default"}` },
        svg("rect", { x, y, width: NODE_W, height: NODE_H, rx: 8 }));
      const sub = node.sub ? 1 : 0;
      const total = lines.length + sub;
      const top = y + NODE_H / 2 - (total * 15) / 2 + 11;
      lines.forEach((line, i) => group.append(svg("text", { x: x + NODE_W / 2, y: top + i * 15, "text-anchor": "middle", class: "v-dg-label" }, line)));
      if (sub) group.append(svg("text", { x: x + NODE_W / 2, y: top + lines.length * 15, "text-anchor": "middle", class: "v-dg-sub" }, wrap(node.sub, 26)[0]));
      if (node.label.length > CHARS * 2 || String(node.sub ?? "").length > 26) group.append(svg("title", {}, `${node.label}${node.sub ? ` — ${node.sub}` : ""}`));
      root.append(group);
    }
    // Labels are drawn over the boxes and the lines.
    root.append(...labels);
    return h("div", { class: "v-diagram-wrap" }, root);
  },
};
