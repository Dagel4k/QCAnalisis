# Plan de Implementación y Evolución del Analizador

Este documento describe comparativas, fortalezas y debilidades de la herramienta actual, y propone un roadmap de nuevas capacidades con foco en utilidad, viabilidad técnica y bajo costo de adopción.

## 1) Comparativa con herramientas del ecosistema

- SonarQube / SonarCloud
  - Fortalezas: multi‑lenguaje, duplicación, complejidad, cobertura, “quality gates” completos, deuda técnica, seguridad (hotspots).
  - Debilidades: servidor/servicio dedicado, configuración pesada, tuning costoso.
  - Diferencia: la herramienta actual es ligera y focalizada en JS/TS; le faltan baseline/cobertura y gobierno organizacional.

- GitLab Code Quality (CodeClimate)
  - Fortalezas: reporte nativo en MRs, engines maduros.
  - Debilidades: depender del formato / CI, menor flexibilidad fuera del ecosistema.
  - Diferencia: ya generamos CodeClimate JSON; falta publicar en el MR y enriquecerlo con diffs/inline.

- Semgrep (SAST)
  - Fortalezas: reglas multi‑lenguaje, buen balance señal/ruido, rápido, fácil de tunear.
  - Debilidades: curaduría de reglas según dominio; tiempo de ejecución puede crecer.
  - Diferencia: integrado (binarios/Docker), con gates y config; faltan baseline/supresiones/triage.

- CodeQL / Snyk Code
  - Fortalezas: flujo/taint tracking avanzado, buena profundidad en seguridad.
  - Debilidades: más pesado, acoplado a ecosistemas/licencias.
  - Diferencia: podemos interoperar por SARIF (ya generamos SARIF de ESLint).

- Dependencias (OSV / Snyk / Trivy)
  - Fortalezas: CVEs y fixes, políticas de licencias/compliance.
  - Diferencia: OSV integrado; faltan SBOM/licencias/compliance.

- DAST (OWASP ZAP)
  - Fortalezas: validación runtime de seguridad.
  - Debilidades: orquestación, tuning, falsos positivos.
  - Diferencia: aún no integrado; proponible como fase opt‑in.

- Perf Web (Lighthouse / PSI)
  - Fortalezas: Core Web Vitals, accesibilidad, SEO.
  - Diferencia: no integrado aún; se puede incluir como fase opt‑in.

## 2) Fortalezas actuales

- Ligereza y control: CLI+UI sin servidor pesado; integración rápida.
- Cobertura JS/TS: ESLint, ts‑prune, jscpd, Semgrep, Gitleaks, OSV.
- UX y operatividad: progreso real, cancelación, logs persistentes, configuración total por UI.
- Artefactos estándar: CodeClimate JSON y SARIF listos para plataformas.
- Robustez: clonado no interactivo con token, CORS/CSP/HSTS, timeouts por fase, reuso de clones seguro opcional, clonado ligero opcional.
- Docker fallback para herramientas (sin instalar en runners).

## 3) Debilidades / Gaps

- Falta baseline (“Clean as You Code”) para gates diferenciales.
- Integración MR nativa: publicación de Code Quality + comentarios de resumen/diffs.
- Triage/supresiones: por regla/ruta/expiración + ownership por paths.
- Monorepos/multi‑lenguaje: eslint tipado por paquete y soporte ampliado via Semgrep.
- Escala/estado: almacenamiento FS; sin DB/colas persistentes/métricas.
- Supply chain/Compliance: sin SBOM/licencias; sin DAST; secrets heurísticos con FP.
- Auto‑remediación: sin PRs automáticos de fixes simples.

## 4) Viabilidad (esfuerzo ↔ impacto)

- Bajo esfuerzo / alto impacto
  - Baseline de issues + gates por nuevos/agravados (JSON por repo/branch).
  - Publicación Code Quality en MR + comentario de resumen/diff.
  - Triage básico: supresiones (.yml o inline) con expiración.
  - Notificaciones Slack/Teams.
  - UI “Tools run summary” y filtros por source/severity.

- Medio esfuerzo / alto impacto
  - Mirrors + worktrees + LRU (reuso de clones real).
  - Concurrencia controlada (global/por repo) + scheduling/ prioridades.
  - Licencias/Compliance: SBOM (Syft) + Grype/Trivy/Licensee.
  - Inline MR comments por archivo/línea (issues críticos).

- Mayor esfuerzo / alto impacto
  - DAST (ZAP) y Lighthouse opt‑in.
  - DB ligera (SQLite/Postgres) para runs, baseline, triage y métricas.
  - Arquitectura de plugins/fases declarativas.

## 5) Roadmap propuesto

### P3 – Calidad diferencial y MR
- Baseline por repo/branch: guardar `baseline.json` y comparar en cada run.
- Gates por “issues nuevos/agravados” (ESLint/Semgrep/Gitleaks/OSV/jscpd).
- Publicación en MR:
  - Subir `gl-code-quality-report.json` como artifact para widget nativo.
  - Comentar resumen (issues nuevos, SAST/secrets/deps) con enlaces a HTML/JSON/Logs.
- Triage y supresiones:
  - Archivo `.analyzerignore.yml` y supresión inline; expiración opcional.
  - UI básica para gestionar supresiones.
- Notificaciones Slack/Teams (webhook configurable) con KPIs y links.
- UI: “Tools run summary” + tiempos por fase.

### P4 – Escala y performance
- Reuso de clones con mirrors + worktrees + LRU (cleanup automático) y sanidad (fetch/reset/clean).
- Concurrencia y límites:
  - Pool global y por repo; back‑pressure y prioridades (MR > branches).
- Telemetría/Métricas:
  - Duraciones por fase, conteo de hallazgos, export JSON o Prometheus.

### P5 – Supply chain y compliance
- SBOM con Syft; escaneo con Grype/Trivy; licencias/compliance.
- Gates por severidad (CRITICAL/HIGH) y licencias prohibidas.
- Reportes extendidos y enriquecidos en CodeClimate.

### P6 – DAST y performance web
- ZAP: baseline scan sobre endpoints conocidos; gates por severidad.
- Lighthouse/PSI: puntajes mínimos (Perf, Accesibilidad, SEO) y tendencia.
- Scheduling/perfiles (nightly, pre‑release, perf suite).

### P7 – DX y extensibilidad
- PR auto‑fixes: `eslint --fix`, reglas sugeridas, bump de dependencias.
- Config por repo (YAML) + overrides por UI.
- Plugins: interfaz declarativa de fases (command + parser + mapping a outputs).

## 6) Riesgos y mitigación

- Tiempo ↑ (SAST/OSV/DAST): opt‑in por UI, timeouts, perfiles por pipeline.
- Falsos positivos: baseline + triage/supresiones, severidad/categorías claras.
- Infra/red: reuso con sanidad (fetch/reset/clean), timeouts defensivos, logs persistentes.
- Complejidad: arquitectura por fases y outputs estandarizados (HTML, CodeClimate, SARIF, JSON).

## 7) KPIs sugeridos

- % de MRs con gate “OK”.
- Issues nuevos/agravados por MR (ESLint/SAST/Secrets/Deps/Dups).
- Tiempo por fase y total.
- Tendencia de duplicación y deuda (aprox. ESLint rule counts).

## 8) Requisitos/Dependencias

- Binarios (recomendado): semgrep, gitleaks, osv‑scanner; o Docker como fallback.
- Accesos API (GitLab), tokens, permisos.
- Opcional: Slack/Teams webhook, Lighthouse/ZAP si se activa.

## 9) Estimación (orientativa)

- P3: 1–2 semanas (baseline + MR + triage + notifs + UI summary).
- P4: 1–2 semanas (mirrors/worktrees/LRU + concurrencia + métricas).
- P5: 1–2 semanas (SBOM/licencias/compliance + gates + reportes).
- P6: 1–2 semanas (ZAP/Lighthouse opt‑in + perfiles/scheduling).
- P7: 2–3 semanas (auto‑fixes + config por repo + plugins).

## 10) Siguientes pasos

1) Implementar P3 (baseline + MR + triage + notifs + summary UI).
2) Medir impacto/tiempos y priorizar P4 (escala/perf) según carga real.
3) Abordar P5 (supply chain/compliance) para hardening en release.
4) Explorar P6 (DAST/Perf) con equipos que lo necesiten.

---

Este plan prioriza “valor visible pronto” (P3) y asegura que los pasos de crecimiento (P4–P7) mantengan la simplicidad del producto: fases opt‑in, UI de configuración, y artefactos estándar para integraciones.
