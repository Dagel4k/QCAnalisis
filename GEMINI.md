# ScriptC Systemic Directives (GEMINI.md)

## 1. Project Context: ScriptC
ScriptC is a high-performance, three-layer Automated Code Analysis Platform. 
- **Layer 1 (UI):** Vite/React/Tailwind/shadcn.
- **Layer 2 (Orchestrator):** Node.js API (Async processing/SSE).
- **Layer 3 (Core CLI):** Node.js/Docker (The Analysis Engine).

## 2. The Three Laws of ScriptC Refactoring
1. **The Law of Isolation:** No analysis tool (ESLint, Semgrep, etc.) shall have direct access to the file system. All interactions must pass through the `SandboxManager` abstraction.
2. **The Law of Purity:** The Core CLI must remain "Stealth." No modification to the target project's `package.json` or source files is permitted. All "injections" must exist in the volatile memory or a temporary `.work/` directory.
3. **The Law of Determinism:** Given the same source code and configuration, the analyzer must produce an identical SARIF/JSON output. Side effects (logging, telemetry) must not interfere with the data pipeline.

## 3. Operational Constraints
- **Type Safety:** All refactored code must be strictly typed (TypeScript 5.x). No `any` types permitted.
- **Error Handling:** Implement a "Fail-Soft" strategy. If one scanner (e.g., Gitleaks) fails, the orchestrator must catch the exception, log the failure in the metadata, and proceed with the remaining scanners.
- **Memory Management:** Analysis jobs are resource-intensive. Prioritize `Stream` processing over `Buffer` for large JSON artifacts.

## 4. Refactoring Instructions (The Prompt)
When analyzing a file, you must:
1.  **Identify Architectural Leakage:** Check if the Execution Layer is attempting to perform Presentation Layer tasks.
2.  **Evaluate Dependency Health:** Flag any utility functions that can be replaced by native Node.js APIs to reduce the `node_modules` footprint.
3.  **Audit the "Stealth" Injection:** Ensure the logic in `bin/review-gitlab-branches.js` correctly cleans up the sandbox environment under all exit codes (0, 1, SIGTERM).
4.  **Consolidate Logic:** Merge redundant configuration-loading logic into a single `ConfigProvider` singleton.

## 5. Definition of Done
Refactoring is considered complete only if:
- Unit tests pass with >90% coverage for the affected module.
- The `Dependency Cruiser` graph shows zero circular dependencies.
- The code adheres to the "Strategy Pattern" for scanner integration.