import type { LobsterViewContext } from "@clawdbot/lobster-viewer";

export const pluginId = "lobster";
export const changedEvent = `plugin.${pluginId}.workflows-changed`;
export const methods = {
  list: "lobster.workflows.list",
  get: "lobster.workflows.get",
  files: "lobster.workflows.files",
  file: "lobster.workflows.file",
} as const;
export type Workflows = LobsterViewContext["host"]["workflows"];
export type WorkflowResponse<T> = { ok: true; result: T } | { ok: false; error: string };
