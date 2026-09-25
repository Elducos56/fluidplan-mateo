// Example extension: database load as a function of the session TTL chosen in `value_from`.
// Everything comes through `ctx`; nothing touches the DOM at import time.
const css = `
.x-load { display: grid; gap: 0.5rem; }
.x-load svg { width: 100%; height: auto; }
.x-load .grid-line { stroke: var(--border); stroke-width: 1; }
.x-load .axis { fill: var(--muted-foreground); font-size: 11px; }
.x-load .curve { fill: none; stroke: var(--chart-1); stroke-width: 2; }
.x-load .marker { fill: var(--chart-1); stroke: var(--card); stroke-width: 2; }
`;

// Share of requests that miss the cache and hit the database, for a TTL in minutes.
const missRate = (ttl) => Math.round(100 * (5 / (5 + ttl)));

export default {
  kind: "load_curve",
  css,
  validate(v, plan) {
    const ids = plan.pages.flatMap((p) => p.decisions ?? []).map((d) => d.id);
    return ids.includes(v.value_from) ? [] : [`load_curve: unknown decision "${v.value_from}"`];
  },
  render(v, ctx) {
    const { h, svg, model } = ctx;
    const decision = ctx.store.decision(v.value_from);
    const readout = h("div", { class: "stat-tile" });
    const chart = h("div");
    const el = h("div", { class: "x-load" }, readout, chart);
    const W = 480;
    const H = 160;
    const x = (ttl) => 32 + ((ttl - 5) / 115) * (W - 48);
    const y = (rate) => 12 + (1 - rate / 100) * (H - 36);

    function update() {
      const ttl = model.effectiveValue(decision, ctx.store.answer(v.value_from));
      readout.replaceChildren(
        h("div", { class: "stat-label" }, "Requests reaching the database"),
        h("div", { class: "stat-value" }, `${missRate(ttl)} %`));
      const points = [];
      for (let t = 5; t <= 120; t += 5) points.push(`${points.length ? "L" : "M"}${x(t).toFixed(1)} ${y(missRate(t)).toFixed(1)}`);
      chart.replaceChildren(svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Database load by TTL" },
        svg("line", { class: "grid-line", x1: 32, x2: W - 16, y1: y(0), y2: y(0) }),
        svg("line", { class: "grid-line", x1: 32, x2: W - 16, y1: y(50), y2: y(50) }),
        svg("text", { class: "axis", x: 4, y: y(50) + 4 }, "50 %"),
        svg("text", { class: "axis", x: x(5), y: H - 4 }, "5 min"),
        svg("text", { class: "axis", x: x(120) - 36, y: H - 4 }, "120 min"),
        svg("path", { class: "curve", d: points.join(" ") }),
        svg("circle", { class: "marker", r: 5, cx: x(ttl), cy: y(missRate(ttl)) })));
    }
    update();
    return { el, update };
  },
};
