# 1. Arquitectura Actual de ScriptC

## Resumen Ejecutivo
ScriptC es una Plataforma de Análisis Estático de Código Automatizado estructurada en tres capas principales: Interfaz de Usuario (React + Vite), Orquestador (Web API) y el Motor de Análisis (Core CLI en Node.js). 

Actualmente, el Motor de Análisis opera bajo un modelo de procesamiento por lotes (Batch Processing), ideal para entornos de Integración Continua (CI) pero con un ciclo de retroalimentación largo para el desarrollador individual.

## ¿Qué hace actualmente?
El CLI principal (`bin/review-gitlab-branches.js`) ejecuta una tubería de análisis completa sobre un repositorio:
1.  **Aislamiento (Sandbox):** Clona un repositorio (o rama específica) en un directorio de trabajo temporal (`.work/`). Cumpliendo con la "Ley de Aislamiento", nunca modifica el código fuente del proyecto objetivo ni sus dependencias reales.
2.  **Orquestación de Escáneres:** Invoca secuencialmente o en paralelo herramientas como:
    *   **ESLint:** Para el linting de código y mejores prácticas en JavaScript/TypeScript.
    *   **Semgrep:** Análisis semántico profundo para encontrar vulnerabilidades lógicas.
    *   **Gitleaks:** Detección de secretos o credenciales hardcodeadas (contraseñas, tokens).
    *   **Dependency-Cruiser:** Validación de la arquitectura y búsqueda de dependencias circulares.
3.  **Agregación de Resultados:** Unifica las salidas (stdout, stderr, XML, SARIF) de cada escáner y genera artefactos JSON unificados (`storage/<repo-slug>/reports/`).
4.  **Limpieza Determinista:** Al finalizar (éxito o error), elimina el entorno temporal de trabajo para preservar el estado original del sistema.

## ¿Cómo lo hace?
*   Utiliza un patrón de **Estrategia (Strategy Pattern)** en `lib/scanners/` para encapsular la ejecución de cada herramienta de terceros.
*   Implementa flujos asíncronos (`async/await`) y uso de `child_process.exec` para lanzar los analizadores sobre el Sandbox.
*   Cumple estricta tipificación con TypeScript 5.x.

## Limitaciones (El Problema Actual)
*   **Ausencia de Tiempo Real (Feedback Lento):** Para saber si introdujo una vulnerabilidad, el desarrollador tiene que hacer `git commit` y esperar a que termine el pipeline de escaneo del repositorio completo. 
*   **Granularidad de Análisis:** Está diseñado para analizar repositorios o directorios enteros. No puede escanear eficientemente *un solo archivo* a medida que se modifica en memoria.
*   **Consumo de Recursos en Local:** Si un desarrollador corre el CLI en su laptop, clonará e instalará dependencias del proyecto completo en `.work/`, lo cual es costoso en tiempo y CPU para el ciclo de escritura normal.
*   **Desconexión del Flujo de Trabajo (DX):** Exige que el programador abandone su IDE para ir a ver reportes a un Dashboard (la interfaz React) o revisar logs en la consola. Esto genera fricción y disminuye las probabilidades de remediación temprana.
