---
name: fluidplan
description: Presents a plan as a small local web app in shadcn/ui style instead of a long .md file — one page per theme, one card per decision (OK, Not OK, Change, Explain) with why it matters, pros and cons per option, importance and a glossary; the person can rewrite any text. Claude revises round after round until everything is settled, then writes PLAN.md (tasks, files, acceptance criteria, verify commands — ready to execute) and DECISIONS.md. Use when a plan or proposal document (.md, .txt, .docx, .pdf) contains choices to settle, or to present the plan for a change Claude designs — "present this plan", "let me decide the options", "review this plan with me", "walk me through the decisions", "fluidplan". Plans are written in French (default) or English. Not for a single decision (answer in the conversation) or a document that only needs reading.
---

# fluidplan

A plan with choices to settle, presented as a local app: the person decides card by card, Claude
revises, and the final plan only has to be executed.

The engine lives in this folder: `engine/fluidplan.mjs` (Node 20+, no dependencies). In the
commands below, `<skill>` is this skill's folder ("Base directory for this skill"). Run the CLI
**from the project root** (or pass `--root`); plans live in the project, in `docs/fluidplan/<id>/` by
default (configurable in `fluidplan.config.json`; a project that already has a `.fluidplan/`
folder keeps using it).

Work **outside plan mode**: the skill writes files and starts a server.

## When to use

- A document proposes several things to decide (options, open questions, lists of proposals) and
  the person wants to settle them, not proofread.
- Claude designs a change (feature, redesign, migration) that involves real choices: present it
  with fluidplan instead of a Markdown plan.

Not for: a single decision, a document that only needs reading, a plan with no choices at all
(write it directly).

## The loop

1. **Frame.** Source: a document or a request? Plan language: `fr` (default) or `en` — the
   person's language. A short `id` (`auth-oauth`). If the request is vague, ask your questions
   first: a fluidplan plan does not replace scoping.
2. **Collect.**
   - `.md` / `.txt`: read directly.
   - `.pdf`: Read tool, in chunks (`pages: "1-20"`).
   - `.docx`: `node <skill>/engine/fluidplan.mjs import <file.docx> --out docs/fluidplan/<id>/source`, then read `source.md`.
   - Request: explore the code (Explore subagents if the change is large) so that every task
     cites real files.
   Details: `references/import.md`.
3. **Break down** following `references/authoring.md` and `references/pedagogy.md`: one page per
   theme (3 to 4 decisions), one decision per point that can be settled on its own, each decision
   with its `why`, its options (pros / cons, effort) and its `tasks` (files, criteria,
   verification). What goes without saying becomes a `minor` decision (accepted in one click) or a
   plain task.
4. **Write** `docs/fluidplan/<id>/plan.json` (format: `references/schema.md`). Skeleton:
   `node <skill>/engine/fluidplan.mjs new --plan <id> --title "…" --lang fr` (`--lang en` for a
   plan in English). Then run `node <skill>/engine/fluidplan.mjs check --plan <id>` until **zero
   errors**; address the teaching warnings (missing why, decision without tasks).
   **Illustrations, only when they help decide** (screen mockup, art direction, visual concept —
   never decoration): set a `prompt` on the visual concerned (an `image` visual with no `src` is an
   image to generate). The person generates it from the page ("Illustrate"). To generate it
   yourself, **ask for consent first** (it costs credits), then
   `node <skill>/engine/fluidplan.mjs images generate --plan <id> --target page:<id> --provider gemini`.
   Services: OpenAI, Gemini, Ludo.ai, Meshy — those whose key is in `<skill>/engine/.env` (run
   `images` to see which). **At most 5 generations per service per plan**, enforced by the engine.
   Details: `references/visuals.md`, "Generated illustrations".
5. **Look before showing.** `node <skill>/engine/fluidplan.mjs snap --plan <id> --themes light,dark --widths 1400,390 --out <scratchpad>/snaps`,
   then read the screenshots (overflow, clipped text, empty visuals). Fix what you find.
6. **Launch, in the background** (`run_in_background` parameter of the Bash or PowerShell tool):
   - `node <skill>/engine/fluidplan.mjs serve --plan <id> --open` (the server; reused if it is already running);
   - `node <skill>/engine/fluidplan.mjs wait --plan <id>`: exits when the person clicks
     "Send to Claude" and prints the digest — that is what wakes you up.
   Tell the person, in two or three sentences: the address, the four possible answers, rewriting
   on hover, the "Send to Claude" button. If `wait` could not run, they can also write "sent" in
   the conversation: then run `digest`.
7. **Revise** when `wait` returns (or run `node <skill>/engine/fluidplan.mjs digest --plan <id>`).
   For each decision the digest lists for rework:
   - *Change* or rewrite: incorporate it; a rewrite by the person is taken over **word for word**;
   - *Explain*: answer in `revision.note` in **two sentences with no technical term**, and add a
     `visual` (most often a `diagram`) when a mechanism or a flow is at stake; details go in `why`
     or `learn_more`; do not change the proposal if it holds;
   - *Another option*: add the option described, and recommend it if it is better;
   - a revised decision starts over with no answer: carry over what the person chose (mark the
     option they picked as `recommended`, set a number control's `default` to their value), unless
     the revision is precisely about changing it;
   - in every case, set `"revision": { "round": <n+1>, "note": "…" }`: one or two sentences
     addressed to the person, saying what changed.
   Rejected decisions stay rejected (no revision required); accepted ones are left untouched —
   except a dependent decision that a revision makes wrong (it gets a `revision` too).
   Then `check`, then `node <skill>/engine/fluidplan.mjs next-round --plan <id>`: the page reloads
   by itself for the next round. Restart `wait` in the background. Back to step 7.
8. **Finalize** when the digest has nothing left to rework and nothing without an answer:
   `node <skill>/engine/fluidplan.mjs finalize --plan <id>` writes `PLAN.md` and `DECISIONS.md`.
   Reread them, present them in a few lines, offer to execute.
   **Then offer — never do it unasked — to file DECISIONS.md in the person's brain inbox**: with
   the person's yes, call the gbrain tool `capture` with the content of DECISIONS.md, as a
   `type: note` page in `0-inbox/`, linking the project concerned in double brackets
   (`[[project]]`). Never write a file directly into the brain's folder (`Cerveau-DEG`): the DEG
   brain is written only through gbrain. Details: `references/execution-plan.md`.
9. **Execute** `PLAN.md` in order (`references/execution-plan.md`): tick each task and each
   criterion as you go, and run its verify commands. A deviation from a decision opens a new round
   instead of being settled silently.

## Rules

- Never write `answers.json` or `state.json` by hand: the page and the CLI take care of them.
- `plan.json` is yours; a revised decision always carries `revision.round` = the next round,
  otherwise `next-round` refuses (by design: nothing gets lost).
- After three rounds on the same decision (the digest flags it), offer to settle it in the
  conversation.
- Local server only (127.0.0.1). No API key in a plan, a page or a log; image keys go in
  `<skill>/engine/.env` (never read or print that file).
- No image generation without the person's explicit consent: each one costs credits. The cap of 5
  per service per plan must not be worked around (no new plan, no other service for the same need
  without saying so); if an image does not fit, rework the `prompt` with the person before
  regenerating.
- Keep the plan human-sized: 3 to 4 non-minor decisions per page, short texts, and `why`s that say
  what a mistake would cost.

## References

| File | When to read it |
|---|---|
| `references/authoring.md` | Before writing a plan: breaking it down, choosing importance, writing tasks. |
| `references/pedagogy.md` | For `why`, pros / cons, `learn_more`, the glossary. |
| `references/schema.md` | The `plan.json` format, field by field, with examples. |
| `references/visuals.md` | Choosing a visual, or writing a plan-specific extension. |
| `references/import.md` | Turning a .md / .txt / .docx / .pdf into a plan. |
| `references/execution-plan.md` | The format of PLAN.md and DECISIONS.md, and how to execute. |
| `examples/tech-feature/` | A complete example project: `plans/tech-feature/plan.json` and the code it targets (`serve --root examples/tech-feature`; its `fluidplan.config.json` sets `plansDir` to `plans`). |
