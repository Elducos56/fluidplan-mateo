// Answers → DECISIONS.md, the explanatory log: for each decision, the choice, why, what was
// rejected, the remarks and the history of rounds. Pure module.
import { cell, headerLines, oneLine, punctuation, quote } from "./export_common.js";
import { allDecisions, controlSummary, counts, effectiveChoice, effectiveChoices, importanceOf, itemVerdict, optionLabel, textOf, verdict } from "./model.js";

// history: [{ round, answers }] of the rounds already sent (current round excluded).
export function buildDecisionsMd(plan, answers, { t, now = new Date(), state = {}, history = [] } = {}) {
  const { colon } = punctuation(t);
  const get = (id) => answers?.[id] ?? {};
  const L = [];
  L.push(`# ${t("decisionsMd.title", { title: plan.title })}`, "");
  const header = headerLines(plan, answers, { t, now, state });
  L.push(...header.lines);
  const c = counts(plan, answers);
  L.push(`> ${t("decisionsMd.tally", { ok: c.ok + c.mixed, modify: c.modify, explain: c.explain, ko: c.ko, pending: c.pending, all: c.all })}`, "");

  if (plan.context) L.push(`## ${t("planMd.context")}`, "", plan.context.trim(), "");

  const rows = allDecisions(plan);
  const phases = new Map((plan.phases ?? []).map((phase, i) => [phase.id, { phase, n: i + 1 }]));
  const kept = rows.filter(({ decision }) => ["ok", "mixed"].includes(verdict(decision, get(decision.id))));
  const rejected = rows.filter(({ decision }) => verdict(decision, get(decision.id)) === "ko");
  const open = rows.filter(({ decision }) => ["pending", "modify", "explain"].includes(verdict(decision, get(decision.id))));

  if (kept.length) {
    L.push(`## ${t("decisionsMd.kept")}`, "");
    for (const { decision } of kept) pushDecision(L, decision, get(decision.id), { plan, t, phases, history, state });
  }

  if (rejected.length) {
    L.push(`## ${t("decisionsMd.rejected")}`, "");
    for (const { decision } of rejected) {
      const answer = get(decision.id);
      L.push(`### ${decision.id} · ${decision.title}`, "");
      const proposal = textOf(answer, "proposal", decision.proposal);
      if (proposal) L.push(`- **${t("decisionsMd.proposal")}${colon}** ${oneLine(proposal)}`);
      if (decision.why) L.push(`- **${t("decisionsMd.why")}${colon}** ${oneLine(decision.why)}`);
      L.push(`- **${t("decisionsMd.reason")}${colon}** ${answer.comment ? quote(answer.comment, t) : "—"}`);
      pushHistory(L, decision, answer, { t, history, state });
      L.push("");
    }
  }

  if (open.length) {
    L.push(`## ${t("decisionsMd.open")}`, "");
    for (const { decision } of open) {
      const answer = get(decision.id);
      const v = verdict(decision, answer);
      L.push(`- **${decision.id} · ${decision.title}** — ${t(`verdict.${v}`)}${answer.comment ? `${colon} ${quote(answer.comment, t)}` : ""}`);
    }
    L.push("");
  }

  if (plan.glossary?.length) {
    L.push(`## ${t("decisionsMd.glossary")}`, "");
    for (const entry of [...plan.glossary].sort((a, b) => a.term.localeCompare(b.term, t.lang))) {
      L.push(`- **${entry.term}**${entry.aliases?.length ? ` (${entry.aliases.join(", ")})` : ""} — ${oneLine(entry.definition)}`);
    }
    L.push("");
  }

  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function pushDecision(L, decision, answer, { plan, t, phases, history, state }) {
  const { colon, semicolon } = punctuation(t);
  L.push(`### ${decision.id} · ${decision.title}`, "");
  L.push(`- **${t("decisionsMd.importance")}${colon}** ${t(`importance.${importanceOf(decision)}`)}`);
  const phase = phases.get(decision.phase);
  if (phase) L.push(`- **${t("decisionsMd.phase")}${colon}** ${t("planMd.phase", { n: phase.n, title: phase.phase.title })}`);
  const summary = controlSummary(decision, answer, plan, t, { effective: true });
  if (summary) L.push(`- **${t("decisionsMd.choice")}${colon}** ${summary}`);
  if (decision.why) L.push(`- **${t("decisionsMd.why")}${colon}** ${oneLine(decision.why)}`);
  const proposal = textOf(answer, "proposal", decision.proposal);
  if (proposal) L.push(`- **${t("decisionsMd.proposal")}${colon}** ${oneLine(proposal)}${answer.edits?.proposal ? ` _(${t("decisionsMd.rewritten")})_` : ""}`);

  const control = decision.control;
  if (control?.kind === "choice" || control?.kind === "multi") {
    const chosen = control.kind === "choice" ? [effectiveChoice(decision, answer)] : effectiveChoices(decision, answer);
    const others = control.options.filter((option) => !chosen.includes(option.id));
    if (others.length) {
      const text = others.map((option) => {
        const cons = option.cons?.length ? ` (${t("decisionsMd.cons")}${colon} ${option.cons.join(semicolon)})` : "";
        return `${optionLabel(decision, answer, option)}${cons}`;
      }).join(" · ");
      L.push(`- **${t("decisionsMd.others")}${colon}** ${text}`);
    }
  }
  pushHistory(L, decision, answer, { t, history, state });
  L.push("");

  if (decision.items?.length) {
    L.push(`| ${t("decisionsMd.item")} | ${t("decisionsMd.detail")} | ${t("decisionsMd.opinion")} | ${t("decisionsMd.remark")} |`, "|---|---|---|---|");
    for (const item of decision.items) {
      const state2 = answer.items?.[item.id] ?? {};
      const label = item.tag ? `${item.title} (${item.tag})` : item.title;
      const detail = textOf(answer, `items/${item.id}/detail`, item.detail);
      L.push(`| ${cell(label)} | ${cell(detail)} | ${t(`itemVerdict.${itemVerdict(answer, item.id)}`)} | ${cell(state2.comment)} |`);
    }
    L.push("");
  }
}

// Remarks from each round, then the sequence of verdicts when there was more than one round.
function pushHistory(L, decision, answer, { t, history, state }) {
  const { colon, semicolon } = punctuation(t);
  const rounds = [...history, { round: state?.round ?? history.length + 1, answers: { [decision.id]: answer } }]
    .map(({ round, answers }) => ({ round, answer: answers?.[decision.id] }))
    .filter((entry) => entry.answer && Object.keys(entry.answer).length);
  const remarks = [];
  for (const { round, answer: a } of rounds) {
    const text = oneLine(a.comment);
    if (text && !remarks.some((r) => r.text === text)) remarks.push({ round, text });
  }
  if (remarks.length) {
    L.push(`- **${t("decisionsMd.remarks")}${colon}** ${remarks.map((r) => `${quote(r.text, t)} (${t("round.short", { n: r.round })})`).join(semicolon)}`);
  }
  if (rounds.length > 1) {
    L.push(`- **${t("decisionsMd.history")}${colon}** ${rounds.map(({ round, answer: a }) => `${t("round.short", { n: round })}${colon} ${t(`verdict.${verdict(decision, a)}`).toLowerCase()}`).join(" → ")}`);
  }
}
