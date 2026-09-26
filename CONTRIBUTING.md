# Contributing

fluidplan is shared as is, in the hope that it is useful. It is maintained on free time, so answers may take a while. Thank you for your patience.

## Questions and bugs

- Search the [existing issues](https://github.com/morganhub/fluidplan/issues) first.
- Open a new issue with the matching template. For a bug, include your OS, Node.js version, browser, and the steps to reproduce it. The output of `node ~/.claude/skills/fluidplan/engine/fluidplan.mjs check` helps a lot.
- For a security issue, do **not** open a public issue: see [SECURITY.md](SECURITY.md).

## Pull requests

Small, focused pull requests are welcome. For a bigger change, open an issue first so we can agree on the approach.

1. Fork the repository and create a branch.
2. Keep the engine free of dependencies and of any build step (plain Node.js 20+ and vanilla JavaScript modules).
3. Keep both languages in sync: when you add a string to `engine/public/i18n/en`, add it to `fr` too.
4. Run the checks before you push:

   ```sh
   npm run unit    # unit tests
   npm run check   # validates the example and the fixtures
   npm run smoke   # end-to-end run in headless Edge or Chrome
   ```

5. If you change the page, regenerate the screenshots with `npm run screenshots` when they no longer match.
6. Describe what you changed and why in the pull request.

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
