# AGENTS.md

Reglas de trabajo para cualquier agente o persona en este repositorio.
Léelo entero antes de escribir código o documentación.

---

## BLOQUE 1 — CONVENCIONES UNIVERSALES Y CÓDIGO LIMPIO

Aplica a cada archivo `.ts`/`.tsx` que se escriba cuando empiece la implementación.

### 1.1 Principios base

- **TypeScript estricto al máximo:** `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`. Prohibido `any` y los type assertions descuidados.
- **Sin `let`.** Enlaces `const` siempre; usa un IIFE o una función auxiliar para
  inicializaciones condicionales.
- **Arrow functions sobre `function`.**
- **Salida temprana y guard clauses.** Máximo 2 niveles de anidación por función.
- **Utilidades de array** (`.map`, `.filter`, `.reduce`) sobre bucles `for`.
- **Sin código de depuración:** nunca `console.log` ni `debugger` en ficheros finales.

### 1.2 Sistema de tipos y modelado

- **`type` sobre `interface`** para props, payloads y estado.
- **Sin `enum`:** tuplas `as const` + tipo de unión derivado:

  ```ts
  const EnrollmentState = ['draft', 'pending_signature', 'signed'] as const;
  type EnrollmentState = (typeof EnrollmentState)[number];
  ```

- **`as const satisfies`** para objetos de configuración tipados.
- **Prohibidas las aserciones de tipo.** Nunca `valor as Tipo`, `as unknown as Tipo` ni el
  operador de no nulo `valor!`. Solo se permite `as const` (y `as const satisfies`). Si el
  compilador no deduce el tipo, se modela el tipo: anotación explícita
  (`const xs: readonly EnrollmentState[] = [...]`), `satisfies`, un type guard o validación con
  Zod en el borde. Lo imponen el plugin `biome-plugins/no-type-assertion.grit` y la regla
  `noNonNullAssertion`; está prohibido desactivarlos con `biome-ignore`.
- **Zod como fuente única de verdad** en los bordes (formularios, API, webhooks,
  variables de entorno). Los tipos de dominio se derivan de los esquemas, no al revés.

### 1.3 Estructura de ficheros e imports

- **Sin barrels `index.ts` innecesarios:** importa directo del módulo destino.
- **Límite de tamaño: ~500 líneas por fichero.** Si crece, divide en submódulos.

### 1.4 Verificación y comandos

| Comando | Qué hace |
|---|---|
| `pnpm format` / `pnpm format:check` | Formatea o comprueba el formato con Biome |
| `pnpm lint` | Análisis estático con Biome |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete (`turbo typecheck`) |
| `pnpm test` | Suite de pruebas con Vitest (`turbo test`) |
| `pnpm check` | Formato + lint + orden de imports, corrigiendo |
| `pnpm check:ci` | `format:check` + `lint` + `typecheck` + `test` + `build`, en cadena: falla en el primer error — lo mismo que ejecutan los hooks y CI |

El orden antes de dar un cambio por terminado es `pnpm check` → `pnpm typecheck` →
`pnpm test`, los tres en verde (o directamente `pnpm check:ci`).

**Hooks de Git (Lefthook, instalados por `pnpm install` vía el script `prepare`):**

- `pre-commit`: `biome check --write` solo sobre los ficheros preparados; si corrige
  algo, lo vuelve a añadir al stage (`stage_fixed`).
- `commit-msg`: valida el mensaje con commitlint (Conventional Commits). Un mensaje
  no conforme rechaza el commit.
- `pre-push`: `pnpm typecheck` y `pnpm test`. Si algo falla, el push no sale.

**`git commit --no-verify` / `git push --no-verify` están prohibidos.** Saltarse los
hooks no es una opción válida en este repositorio: si un hook bloquea, el problema es
el cambio, no el hook. Corrige el cambio; si crees que el hook está mal, dilo antes de
saltártelo.

CI (`.github/workflows/ci.yml`) ejecuta exactamente `pnpm check:ci` en cada push y
pull request: lo mismo que corre en local y en los hooks, sin listas de comandos
duplicadas.

## BLOQUE 2 — TDD ESTRICTO

Obligatorio en `packages/domain` y `packages/contracts`. Runner: Vitest (^5).

1. **Rojo:** escribe el test que falla y ejecútalo para verlo fallar.
2. **Verde:** el mínimo código que lo pone en verde.
3. **Refactor:** limpia con los tests en verde.

- Un test describe **un comportamiento del negocio**, no un método.
- **Nada de mocks en `packages/domain`.** Si hace falta uno, el diseño está mal: lo
  externo entra por un puerto que se sustituye por un fake trivial (una función),
  no por un mock de una librería.
- **Descripciones de test (`describe`/`it`) en español**; los identificadores del
  código, en inglés: `it('rechaza la firma sin OTP verificado', ...)`.
- Casos límite del dominio (menor sin DNI, duplicado por documento, transición de
  estado inválida, importe en céntimos con decimales) van con test antes que con
  código.

---

## BLOQUE 3 — GIT

- **Conventional Commits**, en inglés, en imperativo: `feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`, `test:`.
- **Nunca** añadas `Co-Authored-By` ni ninguna atribución a una IA.
- Se trabaja siempre en una rama de feature (`feat/...`), nunca directamente en `main`.
- Cada tarea del documento ODD (`odd/tasks/<feature>.md`) se cierra con al menos un
  commit de unidad de trabajo en esa rama, con sus tests y su documentación.
- **Push, pull request y merge: solo cuando Paul lo pida explícitamente.**
- Un commit por comportamiento. El ciclo rojo-verde-refactor cabe en un commit.

---

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
