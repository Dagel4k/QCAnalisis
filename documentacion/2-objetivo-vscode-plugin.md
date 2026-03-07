# 2. Objetivo: Plugin de VS Code para ScriptC

## ¿Qué estamos buscando ahora?
El objetivo principal es trasladar el poder de detección de `ScriptC` directamente al entorno de desarrollo del programador. Queremos implementar lo que en ciberseguridad se conoce como **"Shift-Left"**: encontrar y solucionar problemas en el momento exacto en que el código está siendo escrito, mucho antes de que se haga un commit o llegue a Integración Continua (CI).

Para lograr esto de forma escalable y sin perjudicar el rendimiento del ordenador del desarrollador, implementaremos una arquitectura basada en el **Language Server Protocol (LSP)** de Microsoft. (Opción 1 de nuestra deliberación arquitectónica).

## El Protocolo LSP (Language Server Protocol)
El LSP es un protocolo de red estandarizado basado en JSON-RPC. Resuelve un problema de "M x N" complejidad: en lugar de que cada editor de texto (VS Code, Vim, IntelliJ) tenga que implementar un puente único para cada herramienta (ESLint, ScriptC, TypeScript), todos "hablan" el mismo idioma intermedio.

### Arquitectura Cliente-Servidor Desacoplada
Nuestra implementación se dividirá en dos piezas completamente aisladas:

1.  **El Cliente (Extensión de VS Code - Visual Tonto):**
    *   Será un plugin ultra ligero (pesará menos de 2MB).
    *   **No ejecutará análisis.** No tendrá a ESLint ni Semgrep en sus dependencias.
    *   Su única responsabilidad es enviar al Servidor eventos como: *"El usuario abrió auth.ts"*, *"El usuario escribió la palabra 'function' en la línea 12"*.
    *   Recibirá los resultados del Servidor y "dibujará" las líneas onduladas rojas bajo el código o mostrará alertas en panel de *Problemas*.

2.  **El Servidor (Motor Pesado CLI de ScriptC):**
    *   Residirá dentro de nuestra capa *Layer 3 (Core CLI)* existente de `QCAnalisis`.
    *   Se ejecutará en un proceso de Node.js independiente oculto (Background Daemon).
    *   Recibirá el texto emitido por el Cliente, ejecutará nuestras estrategias de `lib/scanners` de manera ultra-rápida, y devolverá un bloque JSON (Diagnostic) indicando la línea, la gravedad y el mensaje del error.

## Metas del Proyecto
*   **Fricción Cero:** El desarrollador solo debe instalar la extensión y ver los errores aparecer al vuelo.
*   **Bajo Consumo de RAM:** Al separar los procesos y evitar que el plugin cargue con las dependencias pesadas de análisis, el IDE (VS Code) mantendrá su fluidez intacta.
*   **Reaprovechamiento de Código:** Utilizaremos la infraestructura existente de ScriptC (`lib/scanners`), exponiéndola a través de una nueva interfaz de comunicación (LSP).
