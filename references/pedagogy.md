# Teaching in a plan

The person decides well when they know **what is at stake**, **what they give up** by choosing,
and **what the words mean**. Four tools, from the most important to the lightest.

## 1. `why` — Why it matters

Two to three sentences: the context that makes the decision necessary, then **what a mistake would
cost**. The consequence conveys the importance, not the adjective.

| Weak | Useful |
|---|---|
| "Important choice for performance." | "Every request goes through here: at 5,000 users, the wrong option doubles the response time, and changing it later means migrating the active sessions." |
| "A format has to be chosen." | "The format is written into the players' save files: changing it after release requires a migration with every update." |

Rules:
- No undefined jargon (otherwise: glossary).
- Do not repeat the proposal: `why` says why we decide, `proposal` says what.
- Required for `critical`; expected for `important`; optional for `minor` (tooltip).

## 2. Pros / cons per option

Each option of a `choice` carries `pros`, `cons`, and when useful `effort` (S, M, L or a duration)
and `cost`. The "Compare" view puts them side by side.

- **Honest**: the recommended option has cons too; a non-recommended option has real pros
  (otherwise it does not deserve to be offered).
- **Comparable**: cover the same axes from one option to the next (operations, cost, time, risk),
  so the table reads row by row.
- **Short**: one line each, two or three per option.
- **Concrete**: "lost on restart" rather than "less robust".

```json
{ "id": "memory", "label": "In-process memory",
  "pros": ["Nothing to deploy", "The fastest"],
  "cons": ["Lost on every restart", "Not shared between two instances"],
  "effort": "S" }
```

## 3. `learn_more` — Learn more

Collapsed by default. For what helps a curious reader without slowing the others down:
alternatives ruled out from the start and why, detailed figures, a code excerpt, links to the
docs. Full Markdown (lists, code blocks, `https://` links).

It is also where the answer to an "Explain" goes when it is long; `why` stays short.

## 4. The glossary

```json
"glossary": [
  { "term": "TTL", "aliases": ["time to live"], "definition": "How long a piece of data lives before it expires." }
]
```

- Each term is underlined with dots at its first appearance in a card, and is explained on hover
  (and on keyboard focus). The full glossary opens from the header.
- Put in it: acronyms, domain terms, names of internal components the person does not know.
- A one-sentence definition, with no other technical term.
- `check` warns about a term that is never used.

## Answering "Explain"

In the next round, the person must find their answer **in the card**, not in the conversation:

1. extend `why` (if the question is about what is at stake) or `learn_more` (if it is about how it
   works);
2. change the proposal only if the question reveals a real problem;
3. `revision.note` sums up the answer in one sentence: "Explained: a clock that goes backwards is
   ignored; we keep the latest date seen."

## Tone

- Address the person simply, in the present tense. No promises, no superlatives.
- One idea per sentence. Figures rather than adjectives.
- Write in the plan's language (`lang`: `en` by default, or `fr`); the interface follows.
