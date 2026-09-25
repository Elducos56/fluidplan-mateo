// The plan's answers: read, changed, saved as you go (half a second after the last keystroke).
// Listeners receive the id of the decision touched. When read-only (round sent, plan finalized),
// no change goes through.
import { allDecisions, itemVerdict, verdict } from "./model.js";

const SAVE_DELAY_MS = 500;

export class Store {
  constructor(plan, answers, { round = 1, persist } = {}) {
    this.plan = plan;
    this.answers = answers && typeof answers === "object" ? answers : {};
    this.round = round;
    this.persist = persist;
    this.readOnly = false;
    this.listeners = new Set();
    this.timer = null;
    this.entries = new Map(allDecisions(plan).map((entry) => [entry.decision.id, entry]));
  }

  answer(id) {
    return this.answers[id] ?? {};
  }

  decision(id) {
    return this.entries.get(id)?.decision ?? null;
  }

  patch(id, changes) {
    if (this.readOnly) return;
    this.answers[id] = { ...this.answer(id), ...changes, round: this.round, updated_at: new Date().toISOString() };
    this.changed(id);
  }

  patchItem(id, itemId, changes) {
    const items = { ...(this.answer(id).items ?? {}) };
    items[itemId] = { ...(items[itemId] ?? {}), ...changes };
    this.patch(id, { items });
  }

  // A rewrite counts as “Change”: the person said what to change, no remark needed.
  setEdit(id, key, text) {
    const current = this.answer(id);
    const edits = { ...(current.edits ?? {}) };
    const value = text === null ? "" : String(text);
    if (value.trim()) edits[key] = value;
    else delete edits[key];
    const changes = { edits };
    const item = key.match(/^items\/([^/]+)\//);
    if (item && value.trim()) {
      const items = { ...(current.items ?? {}) };
      const state = items[item[1]] ?? {};
      if (!state.status || state.status === "ok") items[item[1]] = { ...state, status: "modify" };
      changes.items = items;
    } else if (value.trim() && (!current.status || current.status === "ok")) {
      changes.status = "modify";
    }
    this.patch(id, changes);
  }

  verdict(id) {
    const decision = this.decision(id);
    return decision ? verdict(decision, this.answer(id)) : "pending";
  }

  itemVerdict(id, itemId) {
    return itemVerdict(this.answer(id), itemId);
  }

  // A page's state for the navigation: nothing to decide, nothing done, in progress, done, or
  // done with points to rework.
  pageState(page) {
    const decisions = page.decisions ?? [];
    if (!decisions.length) return "none";
    const verdicts = decisions.map((d) => this.verdict(d.id));
    if (verdicts.every((v) => v !== "pending")) {
      return verdicts.some((v) => v === "modify" || v === "explain") ? "attention" : "done";
    }
    const touched = decisions.some((d) => Object.keys(this.answer(d.id)).some((key) => !["round", "updated_at"].includes(key)));
    return touched ? "partial" : "todo";
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(id) {
    for (const listener of this.listeners) listener(id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    return this.persist?.(this.answers);
  }
}
