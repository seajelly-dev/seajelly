# Agent Tooling Architecture

This folder is the control plane for builtin agent tools and toolkits.

## Goals

- Keep LLM-facing tools atomic and explicit.
- Let the UI grant a grouped capability through a single toolkit switch.
- Centralize policy injection and tool-focus behavior so `loop.ts` does not drift.
- Keep runtime code as the source of truth. Skills are supplementary.

## File Map

```txt
src/lib/agent/tooling/
  catalog.ts                    -> client-safe metadata and config resolution
  registry.ts                   -> runtime toolkit registry
  runtime.ts                    -> shared builtin tool filtering + policy injection + tool directives
  toolkits/self-evolution.ts    -> self_evolution_toolkit policy + focus rules
  tools/self-evolution.ts       -> GitHub/self-evolution atomic tool implementations
```

## Mental Model

- A `tool` is an atomic capability the model can call directly.
- A `toolkit` is a code-owned bundle of multiple tools plus policy and UI metadata.
- `tools_config` still stores agent permissions.
- `self_evolution_toolkit` is the primary example:
  - UI shows one switch.
  - Runtime expands that switch into the GitHub tools.
  - Advanced overrides can still disable individual member tools.

## Config Semantics

Toolkit-aware resolution lives in `catalog.ts`.

- If `tools_config.self_evolution_toolkit === true`, member tools are enabled by default.
- If `tools_config.self_evolution_toolkit === false`, all member tools are disabled.
- If the toolkit key is absent, legacy per-tool booleans still work as before.
- Individual member tool booleans are treated as overrides.

This gives us zero-schema-migration compatibility while still supporting the new one-switch UX.

## Adding a New Toolkit

Use this when you have multiple tools that should be granted together and share operating rules.

1. Implement the atomic tool functions in `src/lib/agent/tooling/tools/<your-toolkit>.ts`.
2. Add the toolkit key and member tool names to `catalog.ts`.
3. Add client-safe toolkit metadata to `BUILTIN_TOOLKIT_CATALOG` in `catalog.ts`.
4. Add runtime behavior in `toolkits/<your-toolkit>.ts`:
   - `buildPolicySection` for system prompt instructions
   - `getGenerateTextDirective` for `activeTools` / `toolChoice` behavior when needed
5. Register the toolkit in `registry.ts`.
6. Mount the atomic tools from `createAgentTools()` in `src/lib/agent/tools.ts`.
7. Do not manually wire toolkit UI in the dashboard unless you need a custom experience. The default toolkit switch UI reads from `BUILTIN_TOOLKIT_CATALOG`.

## Adding a New Builtin Tool

Use this when the capability stands alone and does not need grouped permission semantics.

1. Add the tool implementation in `createAgentTools()` or extract it into `src/lib/agent/tooling/tools/<domain>.ts`.
2. Register the tool in `BUILTIN_TOOL_CATALOG` in `catalog.ts`.
3. If the tool needs prompt policy, add it in `runtime.ts`.
4. If more tools in the same domain arrive later, promote them into a toolkit instead of spreading ad-hoc checks through `loop.ts`.

## Adding a New Sub-App Tool

Sub-app tools are still separate from builtin toolkits.

- Implement them in `createSubAppTools()` in `src/lib/agent/tools.ts`.
- Bind them through `sub_apps.tool_names`.
- If they need prompt policy, add it in `runtime.ts`.
- Do not hardcode policy text directly into `loop.ts`.

## Rules of Thumb

- Prefer a toolkit when the UI should expose one high-level permission switch.
- Prefer atomic tools for the model, even when the UI groups them behind a toolkit.
- Do not collapse a complex workflow into one giant tool unless the model has repeatedly failed with atomic tools and the wrapper meaningfully reduces risk.
- Keep audit, allowlist, and write-guard logic close to the tool implementation.
- Keep prompt policy text close to the toolkit runtime definition.
- Treat `SKILL.md` as examples and reinforcement, not the canonical authority.

## Review Checklist

Before merging a new tool or toolkit, verify:

- `pnpm exec tsc --noEmit`
- `pnpm exec eslint <changed files>`
- `runAgentLoop` is picking up the new behavior through `runtime.ts`
- The dashboard shows the expected switch or tool row
- Legacy agents without the new toolkit key still behave correctly
