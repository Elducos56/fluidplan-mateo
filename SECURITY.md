# Security policy

## Supported versions

Only the latest version on the `main` branch is supported. Update with `git pull` in `~/.claude/skills/fluidplan` before reporting.

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately through GitHub instead:
[Report a vulnerability](https://github.com/morganhub/fluidplan/security/advisories/new) (Security tab, then *Report a vulnerability*).

Include what you found, how to reproduce it, and its possible impact. You will get an answer as soon as possible; this is a project maintained on free time, so please allow a few days.

## Scope

Relevant reports include, for example:

- the local server being reachable or writable from another origin or host;
- a plan from someone else's repository running code in Node or writing files outside the project;
- path traversal in served assets or written exports;
- the `.docx` reader being made to exhaust memory or disk;
- illustration API keys leaking to the page.

See the *Security* section of the [README](README.md) for what the server is designed to guarantee.
