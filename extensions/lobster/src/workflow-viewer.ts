import type { createWorkflowApi } from "@clawdbot/lobster-viewer/server";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { methods } from "./workflow-viewer-contract.js";

type InspectionOwner = {
  workflows?: ReturnType<typeof createWorkflowApi>;
  close?: () => Promise<void>;
  errorMessage?: (error: unknown) => string;
};

export function registerWorkflowViewer(api: OpenClawPluginApi) {
  let current: InspectionOwner | undefined;
  api.registerService({
    id: "lobster:workflows",
    reload: { configPrefixes: ["agents"] },
    async start(context) {
      const previous = current;
      const owner: InspectionOwner = {};
      current = owner;
      try {
        await previous?.close?.();
        if (current !== owner) {
          return;
        }
        if (!context.workspaceDir) {
          throw new Error("Lobster viewer requires a default agent workspace.");
        }
        // Inspection and filesystem watching are needed only by the running service.
        const { createWorkflowApi, WorkflowApiError, watchWorkflows } =
          await import("@clawdbot/lobster-viewer/server");
        if (current !== owner) {
          return;
        }
        owner.workflows = createWorkflowApi(context.workspaceDir);
        owner.errorMessage = (error) =>
          error instanceof WorkflowApiError ? error.message : "Could not read workflow.";
        const emit = () => {
          if (current === owner) {
            context.gatewayEvents?.emit("workflows-changed", {}, { scope: "operator.read" });
          }
        };
        const watcher = await watchWorkflows(context.workspaceDir, emit, (error) => {
          if (current === owner) {
            context.logger.error(`Lobster workflow watcher failed: ${String(error)}`);
            context.serviceHealth?.reportFailure(error);
          }
        });
        if (current !== owner) {
          await watcher.close();
          return;
        }
        owner.close = watcher.close;
        await watcher.ready;
        emit();
      } catch (error) {
        if (current === owner) {
          current = undefined;
        }
        await owner.close?.();
        throw error;
      }
    },
    async stop() {
      const owner = current;
      current = undefined;
      await owner?.close?.();
    },
  });
  for (const operation of Object.keys(methods) as (keyof typeof methods)[]) {
    api.registerGatewayMethod(
      methods[operation],
      async ({ params, respond }) => {
        const active = current;
        if (!active?.workflows) {
          respond(true, {
            ok: false,
            error: "Lobster viewer is unavailable. Check the plugin service and default workspace.",
          });
          return;
        }
        const workflows = active.workflows;
        const keys = operation === "list" ? [] : operation === "file" ? ["id", "path"] : ["id"];
        if (
          Object.keys(params).length !== keys.length ||
          keys.some(
            (key) =>
              typeof params[key] !== "string" ||
              !params[key] ||
              params[key].length > (key === "id" ? 2800 : 2048),
          )
        ) {
          respond(true, { ok: false, error: "Select a workflow or a source file from its tree." });
          return;
        }
        try {
          const result =
            operation === "list"
              ? await workflows.list()
              : operation === "get"
                ? await workflows.get(String(params.id))
                : operation === "files"
                  ? await workflows.files(String(params.id))
                  : await workflows.file(String(params.id), String(params.path));
          if (active !== current) {
            respond(true, {
              ok: false,
              error: "Lobster viewer restarted. Please reopen the workflow.",
            });
            return;
          }
          respond(true, { ok: true, result });
        } catch (error) {
          respond(true, {
            ok: false,
            error: active.errorMessage?.(error) ?? "Could not read workflow.",
          });
        }
      },
      { scope: "operator.read" },
    );
  }
}
