# Lobster (plugin)

Adds the `lobster` agent tool as an **optional** plugin tool.

## Install

```bash
openclaw plugins install @openclaw/lobster
```

Restart the Gateway after installing or updating the plugin.

## What this is

- Lobster is a standalone workflow shell (typed JSON-first pipelines + approvals/resume).
- This plugin integrates Lobster with OpenClaw _without core changes_.

## Workflow viewer

Open **Lobster** from the sidebar. For a separately installed copy, first enable
**Custom plugin UI** in Settings → Labs. The read-only viewer lists built-ins and
files in the default agent's `workflows/` directory, with search, pagination, flow
diagrams, and highlighted source files. File changes refresh open views
automatically. Viewing a workflow does not execute it or enable the optional
agent tool.

The shared viewer and inspection API are maintained in the Lobster repository's
`@clawdbot/lobster-viewer` package. This plugin owns only its OpenClaw pages,
navigation, read-scoped RPCs, and service lifecycle. Run the package's asset build
after changing `browser/index.ts`; it generates the immutable Control UI assets
and updates `openclaw.plugin.json`.

This fork draft pins an unreleased viewer commit for source development with
`pnpm install`. Before publishing the plugin, release that library and replace
the Git dependency with its exact npm version; the normal npm packaging check
intentionally rejects the temporary pin.

## Enable

Because this tool can trigger side effects (via workflows), it is registered with `optional: true`.

Enable it in an agent allowlist:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": [
            "lobster" // plugin id (enables all tools from this plugin)
          ]
        }
      }
    ]
  }
}
```

## Using `openclaw.invoke` (Lobster → OpenClaw tools)

Some Lobster pipelines may include a `openclaw.invoke` step to call back into OpenClaw tools/plugins (for example: `gog` for Google Workspace, `gh` for GitHub, `message.send`, etc.).

For this to work, the OpenClaw Gateway must expose the tool bridge endpoint and the target tool must be allowed by policy:

- OpenClaw provides an HTTP endpoint: `POST /tools/invoke`.
- The request is gated by **gateway auth** (e.g. `Authorization: Bearer …` when token auth is enabled).
- The invoked tool is gated by **tool policy** (global + per-agent + provider + group policy). If the tool is not allowed, OpenClaw returns `404 Tool not available`.

### Allowlisting recommended

To avoid letting workflows call arbitrary tools, set a tight allowlist on the agent that will be used by `openclaw.invoke`.

Example (allow only a small set of tools):

```jsonc
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": ["lobster", "web_fetch", "web_search", "gog", "gh"],
          "deny": ["gateway"],
        },
      },
    ],
  },
}
```

Notes:

- If `tools.allow` is omitted or empty, it behaves like "allow everything (except denied)". For a real allowlist, set a **non-empty** `allow`.
- Tool names depend on which plugins you have installed/enabled.

## Security

- Runs Lobster in process via the published `@clawdbot/lobster/core` runtime.
- Does not manage OAuth/tokens.
- Uses timeouts, stdout caps, and strict JSON envelope parsing.

## Docs

- https://docs.openclaw.ai/tools/lobster

## Package

- Plugin id: `lobster`
- Tool: `lobster`
- Package: `@openclaw/lobster`
- Minimum OpenClaw host: `2026.4.25`
