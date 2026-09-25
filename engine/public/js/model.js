// The model of a plan and its answers. Pure module, no DOM and no Node: the page, the server and
// the CLI all use it, so the summary on screen and the files written never diverge.

// Reserved value of the “Another option” option that every choice adds.
export const OTHER = "__other";
// Summary page added by the engine: its id starts with “_”, which a plan may not use.
export const SUMMARY_PAGE = "_summary";
export const IMPORTANCE = ["critical", "important", "minor"];
export const STATUSES = ["ok", "ko", "modify", "explain"];
export const VERDICT_KEYS = ["ok", "modify", "mixed", "explain", "ko", "pending"];
export const FILE_OPS = ["create", "modify", "delete"];

const filled = (text) => String(text ?? "").trim() !== "";

export function allDecisions(plan) {
  const out = [];
  (plan.pages ?? []).forEach((page, pageIndex) => {
    for (const decision of page.decisions ?? []) out.push({ page, pageIndex, decision });
  });
  return out;
}

export function findDecision(plan, id) {
  return allDecisions(plan).find(({ decision }) => decision.id === id)?.decision ?? null;
}

export function importanceOf(decision) {
  return IMPORTANCE.includes(decision?.importance) ? decision.importance : "important";
}

// --- rewrites made in the page --------------------------------------------------------------------

export function hasEdits(answer, prefix = "") {
  return Object.entries(answer?.edits ?? {}).some(([key, value]) => key.startsWith(prefix) && filled(value));
}

// The text shown or exported: the person's rewrite if there is one, otherwise the original.
export function textOf(answer, key, original) {
  const edited = answer?.edits?.[key];
  return filled(edited) ? edited : original;
}

// --- verdicts --------------------------------------------------------------------------------------

// “Change” only counts with a text (remark or rewrite): you have to say what to change.
export function itemVerdict(answer, itemId) {
  const state = answer?.items?.[itemId];
  const status = state?.status;
  if (!status) return "pending";
  if (status === "modify" && !filled(state.comment) && !hasEdits(answer, `items/${itemId}/`)) return "pending";
  return status;
}

export function verdict(decision, answer) {
  const status = answer?.status;
  // A question asked comes first: you do not decide what you have not understood.
  if (status === "explain") return filled(answer.comment) ? "explain" : "pending";
  if (decision.items?.length) {
    const states = decision.items.map((item) => itemVerdict(answer, item.id));
    if (states.includes("pending")) return "pending";
    if (states.every((s) => s === "ok")) return "ok";
    if (states.every((s) => s === "ko")) return "ko";
    return "mixed";
  }
  if (!status) return "pending";
  if (status === "modify" && !filled(answer.comment) && !hasEdits(answer)) return "pending";
  return status;
}

// What Claude must rework next round.
export function needsRevision(decision, answer) {
  const v = verdict(decision, answer);
  if (v === "modify" || v === "explain") return true;
  if (decision.items?.length) return decision.items.some((item) => itemVerdict(answer, item.id) === "modify");
  return false;
}

export function counts(plan, answers) {
  const total = { ok: 0, modify: 0, mixed: 0, explain: 0, ko: 0, pending: 0, all: 0 };
  for (const { decision } of allDecisions(plan)) {
    total[verdict(decision, answers?.[decision.id])] += 1;
    total.all += 1;
  }
  return total;
}

// Ready to export: everything is decided and nothing is waiting for a revision.
export function readiness(plan, answers) {
  const pending = [];
  const revise = [];
  for (const { decision } of allDecisions(plan)) {
    const answer = answers?.[decision.id];
    if (verdict(decision, answer) === "pending") pending.push(decision.id);
    else if (needsRevision(decision, answer)) revise.push(decision.id);
  }
  return { ready: !pending.length && !revise.length, pending, revise };
}

// --- effective values: the answer, otherwise the proposal ------------------------------------------

export function recommendedOptions(decision) {
  return (decision.control?.options ?? []).filter((option) => option.recommended);
}

export function effectiveChoice(decision, answer) {
  return answer?.choice ?? recommendedOptions(decision)[0]?.id ?? null;
}

export function effectiveChoices(decision, answer) {
  return Array.isArray(answer?.choices) ? answer.choices : recommendedOptions(decision).map((o) => o.id);
}

export function effectiveValue(decision, answer) {
  const value = answer?.value;
  return Number.isFinite(value) ? value : decision.control?.default;
}

export function orderDecision(plan) {
  const found = allDecisions(plan).find(({ decision }) => decision.control?.kind === "order" && decision.control.source === "phases");
  return found ? found.decision : null;
}

export function orderedPhases(plan, answers) {
  const phases = plan.phases ?? [];
  const order = orderDecision(plan);
  const wanted = order ? answers?.[order.id]?.order ?? [] : [];
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  const out = wanted.map((id) => byId.get(id)).filter(Boolean);
  for (const phase of phases) if (!out.includes(phase)) out.push(phase);
  return out;
}

export function optionLabel(decision, answer, option) {
  return textOf(answer, `options/${option.id}/label`, option.label);
}

// What the control holds (option, selection, value, order), in plain words. `effective`: fall back
// on the proposal when the person accepted without touching the control.
export function controlSummary(decision, answer, plan, t, { effective = false } = {}) {
  const control = decision.control;
  if (!control) return "";
  switch (control.kind) {
    case "choice": {
      const id = effective ? effectiveChoice(decision, answer) : answer?.choice;
      if (!id) return "";
      if (id === OTHER) return t("summary.otherVariant");
      const option = control.options.find((o) => o.id === id);
      return option ? optionLabel(decision, answer, option) : id;
    }
    case "multi": {
      const ids = effective ? effectiveChoices(decision, answer) : answer?.choices;
      if (!Array.isArray(ids)) return "";
      const picked = control.options.filter((o) => ids.includes(o.id)).map((o) => optionLabel(decision, answer, o));
      return picked.length ? picked.join(", ") : t("summary.none");
    }
    case "number": {
      const value = effective ? effectiveValue(decision, answer) : answer?.value;
      if (!Number.isFinite(value)) return "";
      return `${value}${control.unit ? ` ${control.unit}` : ""}`;
    }
    case "order": {
      if (!effective && !Array.isArray(answer?.order)) return "";
      return orderedPhases(plan, { [decision.id]: answer }).map((phase, i) => `${i + 1}. ${phase.title}`).join(" · ");
    }
    default:
      return "";
  }
}

// --- tasks -------------------------------------------------------------------------------------------

// All the tasks declared by a decision, whatever the answer (validation, graph).
export function declaredTasks(decision) {
  const out = [];
  for (const task of decision.tasks ?? []) out.push({ task, origin: "decision" });
  for (const option of decision.control?.options ?? []) for (const task of option.tasks ?? []) out.push({ task, origin: `option:${option.id}` });
  for (const item of decision.items ?? []) for (const task of item.tasks ?? []) out.push({ task, origin: `item:${item.id}` });
  return out;
}

function templateVars(decision, answer) {
  const control = decision.control;
  const vars = {};
  if (control?.kind === "number") {
    vars.value = effectiveValue(decision, answer);
    vars.unit = control.unit ?? "";
  }
  if (control?.kind === "choice") {
    const option = control.options.find((o) => o.id === effectiveChoice(decision, answer));
    vars["choice.id"] = option?.id ?? "";
    vars["choice.label"] = option ? optionLabel(decision, answer, option) : "";
  }
  if (control?.kind === "multi") {
    const ids = effectiveChoices(decision, answer);
    vars.choices = control.options.filter((o) => ids.includes(o.id)).map((o) => optionLabel(decision, answer, o)).join(", ");
  }
  return vars;
}

function fill(text, vars) {
  if (typeof text !== "string") return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => (vars[name] !== undefined ? String(vars[name]) : match));
}

// The tasks the answer keeps: those of the decision, of the chosen option (or the checked options)
// and of the items kept; templates filled in, rewrites applied.
export function decisionTasks(decision, answer) {
  const control = decision.control;
  const picked = [...(decision.tasks ?? [])];
  if (control?.kind === "choice") {
    const option = control.options.find((o) => o.id === effectiveChoice(decision, answer));
    picked.push(...(option?.tasks ?? []));
  }
  if (control?.kind === "multi") {
    const ids = effectiveChoices(decision, answer);
    for (const option of control.options) if (ids.includes(option.id)) picked.push(...(option.tasks ?? []));
  }
  for (const item of decision.items ?? []) {
    if (itemVerdict(answer, item.id) !== "ko") picked.push(...(item.tasks ?? []));
  }
  const vars = templateVars(decision, answer);
  return picked.map((task) => {
    const acceptance = textOf(answer, `tasks/${task.id}/acceptance`, null);
    return {
      ...task,
      title: fill(textOf(answer, `tasks/${task.id}/title`, task.title), vars),
      do: fill(task.do, vars),
      acceptance: (acceptance !== null ? acceptance.split(/\r?\n/).map((s) => s.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean) : task.acceptance ?? []).map((a) => fill(a, vars)),
      verify: (task.verify ?? []).map((v) => fill(v, vars)),
    };
  });
}

function refOf(decisionId, ref) {
  return ref.includes("/") ? ref : `${decisionId}/${ref}`;
}

// The execution plan: kept tasks grouped by phase (in the chosen order), sorted by dependencies
// then in page order, and numbered “phase.rank”.
export function resolvePlanTasks(plan, answers) {
  const entries = [];
  for (const { page, pageIndex, decision } of allDecisions(plan)) {
    const answer = answers?.[decision.id] ?? {};
    const v = verdict(decision, answer);
    if (v === "ko") continue;
    for (const task of decisionTasks(decision, answer)) {
      entries.push({ ref: `${decision.id}/${task.id}`, decision, answer, page, pageIndex, task, verdict: v, phaseId: task.phase ?? decision.phase ?? null, seq: entries.length });
    }
  }
  const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
  const phases = orderedPhases(plan, answers);
  const known = new Set(phases.map((phase) => phase.id));
  const sortGroup = (group) => {
    const inGroup = new Set(group.map((e) => e.ref));
    const placed = new Set();
    const out = [];
    const rest = [...group];
    while (rest.length) {
      let index = rest.findIndex((e) => (e.task.after ?? []).map((r) => refOf(e.decision.id, r)).every((r) => !inGroup.has(r) || placed.has(r)));
      // A cycle does not block the export: fall back on page order; `check` reports it.
      if (index < 0) index = 0;
      const [entry] = rest.splice(index, 1);
      placed.add(entry.ref);
      out.push(entry);
    }
    return out;
  };
  const groups = phases.map((phase, index) => ({ phase, index, entries: sortGroup(entries.filter((e) => e.phaseId === phase.id)) }));
  const loose = sortGroup(entries.filter((e) => !e.phaseId || !known.has(e.phaseId)));
  const numbers = new Map();
  loose.forEach((entry, k) => numbers.set(entry.ref, `0.${k + 1}`));
  for (const group of groups) group.entries.forEach((entry, k) => numbers.set(entry.ref, `${group.index + 1}.${k + 1}`));
  const after = (entry) => (entry.task.after ?? []).map((r) => refOf(entry.decision.id, r)).filter((r) => byRef.has(r)).map((r) => numbers.get(r));
  return { groups, loose, numbers, byRef, after };
}

// Cycles in the `after` dependencies, across all declared tasks.
export function findTaskCycles(plan) {
  const edges = new Map();
  for (const { decision } of allDecisions(plan)) {
    for (const { task } of declaredTasks(decision)) {
      if (!task?.id) continue;
      edges.set(`${decision.id}/${task.id}`, (task.after ?? []).map((r) => refOf(decision.id, r)));
    }
  }
  const cycles = [];
  const state = new Map();
  const visit = (node, stack) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!edges.has(next)) continue;
      if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.get(next)) visit(next, stack);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of edges.keys()) if (!state.get(node)) visit(node, []);
  return cycles;
}

// Files touched by the kept tasks, for the `file_tree` visual.
export function touchedFiles(plan, answers) {
  const { groups, loose, numbers } = resolvePlanTasks(plan, answers);
  const files = new Map();
  for (const entry of [...loose, ...groups.flatMap((g) => g.entries)]) {
    for (const file of entry.task.files ?? []) {
      const current = files.get(file.path) ?? { path: file.path, op: file.op ?? "modify", tasks: [] };
      if (file.op === "create") current.op = "create";
      if (file.op === "delete" && current.op !== "create") current.op = "delete";
      current.tasks.push(numbers.get(entry.ref));
      files.set(file.path, current);
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function dependents(plan, decisionId) {
  return allDecisions(plan).filter(({ decision }) => (decision.depends_on ?? []).includes(decisionId)).map(({ decision }) => decision.id);
}
