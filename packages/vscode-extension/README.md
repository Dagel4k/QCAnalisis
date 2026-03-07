# ScriptC Linter

Real-time static analysis for JavaScript and TypeScript, directly in VS Code.

Detects security vulnerabilities, bad practices, and low-quality code **as you type** — no need to commit or wait for a CI pipeline.

**Repository:** [github.com/Dagel4k/QCAnalisis](https://github.com/Dagel4k/QCAnalisis)

---

## Features

- **Instant feedback** — Issues appear underlined in the editor in real time
- **Zero configuration** — Works out of the box with a strict set of default rules
- **Project-aware** — If your project already has ESLint configured, ScriptC uses it instead of its own rules
- **Lightweight** — Analysis runs in a separate process (LSP server); the IDE stays responsive

## Included rules

When the project has no ESLint config, ScriptC applies a curated set of rules from:

| Plugin | Covers |
|---|---|
| `@typescript-eslint` | Unsafe types, unused variables, problematic TS patterns |
| `sonarjs` | Duplicated code, unnecessary complexity, dead code |
| `security` | `eval` usage, code injection, unsanitized paths |

## Supported languages

- JavaScript (`.js`, `.jsx`)
- TypeScript (`.ts`, `.tsx`)

## Usage

Install the extension. Open any `.ts` or `.js` file. Diagnostics appear automatically in the **Problems** panel (`Cmd+Shift+M`) and as underlines in the editor.

To view the LSP client–server communication logs, go to **View → Output → ScriptC Linter**.

## Development

See the repository for local development instructions and contribution guidelines:
[github.com/Dagel4k/QCAnalisis](https://github.com/Dagel4k/QCAnalisis)
