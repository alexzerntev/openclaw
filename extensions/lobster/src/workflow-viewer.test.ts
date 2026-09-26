import { mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { watchWorkflows } from "@clawdbot/lobster-viewer/server";
import type {
  OpenClawPluginApi,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { useAutoCleanupTempDirTracker } from "openclaw/plugin-sdk/test-env";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import plugin from "../index.js";

vi.mock("@clawdbot/lobster-viewer/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clawdbot/lobster-viewer/server")>()),
  watchWorkflows: vi.fn(),
}));

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const watchers: { changed: () => void; close: ReturnType<typeof vi.fn> }[] = [];
const workflowId = `file:${Buffer.from("inspect.lobster").toString("base64url")}`;
const definition =
  "name: Inspect me\nsteps:\n  - id: inspect\n    command: node scripts/helper.js\n";
type GatewayHandler = Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1];

beforeEach(() => {
  watchers.length = 0;
  vi.mocked(watchWorkflows)
    .mockReset()
    .mockImplementation(async (_workspace, changed) => {
      const close = vi.fn(async () => {});
      watchers.push({ changed, close });
      return { close, ready: Promise.resolve() };
    });
});

async function workspace(name = "Inspect me") {
  const directory = tempDirs.make("lobster-viewer-test-");
  await mkdir(path.join(directory, "workflows", "scripts"), { recursive: true });
  await writeFile(
    path.join(directory, "workflows", "inspect.lobster"),
    definition.replace("Inspect me", name),
  );
  return directory;
}

function host() {
  const handlers = new Map<string, GatewayHandler>();
  const services: OpenClawPluginService[] = [];
  const active = new Map<OpenClawPluginService, OpenClawPluginServiceContext>();
  const events: { event: string; payload: unknown; scope: string }[] = [];
  const error = vi.fn();
  const registerTool = vi.fn<OpenClawPluginApi["registerTool"]>();
  plugin.register(
    createTestPluginApi({
      id: "lobster",
      registerTool,
      registerGatewayMethod(method, handler, options) {
        expect(options?.scope).toBe("operator.read");
        expect(handlers.has(method)).toBe(false);
        handlers.set(method, handler);
      },
      registerService(service) {
        services.push(service);
      },
    }),
  );
  expect(registerTool).toHaveBeenCalledTimes(1);
  expect(registerTool.mock.calls[0]?.[1]).toEqual({ optional: true });
  const stop = async () => {
    for (const [service, context] of [...active].toReversed()) {
      active.delete(service);
      await service.stop?.(context);
    }
  };
  onTestFinished(async () => {
    await stop();
    expect(error).not.toHaveBeenCalled();
  });
  return {
    events,
    stop,
    async start(directory?: string) {
      expect(services).toHaveLength(1);
      for (const service of services) {
        const context: OpenClawPluginServiceContext = {
          config: {},
          workspaceDir: directory,
          stateDir: directory ?? os.tmpdir(),
          logger: { info() {}, warn() {}, error },
          gatewayEvents: {
            emit(event, payload, options) {
              events.push({ event, payload, scope: options.scope });
            },
            onSessionsChanged: () => () => {},
          },
        };
        active.set(service, context);
        await service.start(context);
      }
    },
    async request(operation: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const handler = handlers.get(`lobster.workflows.${operation}`);
      if (!handler) {
        throw new Error(`The plugin entry did not register ${operation}`);
      }
      const responses: unknown[] = [];
      await Reflect.apply(handler, undefined, [
        {
          params,
          respond(ok: boolean, payload: unknown) {
            expect(ok).toBe(true);
            responses.push(structuredClone(payload));
          },
        },
      ]);
      expect(responses).toHaveLength(1);
      return responses[0];
    },
  };
}

it("serves graphs and source files through the existing plugin's read-only RPCs", async () => {
  const runtime = host();
  const directory = await workspace();
  const source = "throw new Error('Inspection must not execute companion code');\n";
  await writeFile(path.join(directory, "workflows", "scripts", "helper.js"), source);
  await runtime.start(directory);
  const event = { event: "workflows-changed", payload: {}, scope: "operator.read" };
  expect(runtime.events).toEqual([event]);
  watchers[0]?.changed();
  expect(runtime.events).toEqual([event, event]);
  expect(await runtime.request("list")).toMatchObject({
    ok: true,
    result: {
      workflows: expect.arrayContaining([
        expect.objectContaining({ id: workflowId, name: "Inspect me", source: "file" }),
      ]),
    },
  });
  expect(await runtime.request("get", { id: workflowId })).toMatchObject({
    ok: true,
    result: {
      workflow: {
        id: workflowId,
        definition: { filename: "inspect.lobster", language: "yaml", text: definition },
        graph: { nodes: [{ id: "inspect", type: "run" }] },
      },
    },
  });
  expect(await runtime.request("files", { id: workflowId })).toEqual({
    ok: true,
    result: {
      defaultPath: "inspect.lobster",
      truncated: false,
      files: [
        { path: "inspect.lobster", language: "yaml" },
        { path: "scripts/helper.js", language: "javascript" },
      ],
    },
  });
  expect(await runtime.request("file", { id: workflowId, path: "scripts/helper.js" })).toEqual({
    ok: true,
    result: { file: { path: "scripts/helper.js", language: "javascript", text: source } },
  });
  const builtin = "builtin:github.pr.monitor";
  const filename = "src/workflows/github_pr_monitor.ts";
  expect(await runtime.request("get", { id: builtin })).toMatchObject({
    ok: true,
    result: {
      workflow: {
        definition: {
          filename,
          language: "typescript",
          text: expect.stringContaining("export async function runGithubPrMonitorWorkflow"),
        },
      },
    },
  });
  expect(await runtime.request("file", { id: builtin, path: filename })).toMatchObject({
    ok: true,
    result: {
      file: {
        path: filename,
        language: "typescript",
        text: expect.stringContaining("export async function runGithubPrMonitorWorkflow"),
      },
    },
  });
});

it("rejects malformed requests and keeps filesystem errors private", async () => {
  const runtime = host();
  const directory = await workspace();
  const privateFile = path.join(directory, "private.js");
  await writeFile(privateFile, "private content");
  await symlink(privateFile, path.join(directory, "workflows", "linked.js"));
  await runtime.start(directory);
  for (const [operation, params] of [
    ["list", { id: workflowId }],
    ["get", {}],
    ["files", { id: 42 }],
    ["file", { id: workflowId, path: "inspect.lobster", extra: true }],
  ] satisfies [string, Record<string, unknown>][]) {
    expect(await runtime.request(operation, params)).toEqual({
      ok: false,
      error: "Select a workflow or a source file from its tree.",
    });
  }
  expect(await runtime.request("file", { id: workflowId, path: "../private.js" })).toMatchObject({
    ok: false,
    error: expect.stringMatching(/Invalid source path/),
  });
  expect(await runtime.request("file", { id: workflowId, path: "linked.js" })).toEqual({
    ok: false,
    error: "Could not read workflow.",
  });
});

it("retires unfinished reads and watcher events on stop, then reads the new workspace", async () => {
  const runtime = host();
  const first = await workspace("First workspace");
  const second = await workspace("Second workspace");
  expect(await runtime.request("list")).toMatchObject({
    ok: false,
    error: expect.stringMatching(/unavailable/),
  });
  await runtime.start(first);
  const pending = runtime.request("get", { id: workflowId });
  await runtime.stop();
  expect(await pending).toMatchObject({ ok: false, error: expect.stringMatching(/restarted/) });
  expect(watchers[0]?.close).toHaveBeenCalledTimes(1);
  watchers[0]?.changed();
  expect(runtime.events).toHaveLength(1);
  expect(await runtime.request("get", { id: workflowId })).toMatchObject({
    ok: false,
    error: expect.stringMatching(/unavailable/),
  });
  await runtime.start(second);
  expect(await runtime.request("get", { id: workflowId })).toMatchObject({
    ok: true,
    result: { workflow: { name: "Second workspace" } },
  });
  await runtime.stop();
  await expect(runtime.start()).rejects.toThrow(/default agent workspace/);
  expect(await runtime.request("list")).toMatchObject({
    ok: false,
    error: expect.stringMatching(/unavailable/),
  });
});

it("closes a watcher that finishes starting after its service has stopped", async () => {
  const runtime = host();
  const directory = await workspace();
  const opening = Promise.withResolvers<Awaited<ReturnType<typeof watchWorkflows>>>();
  const started = Promise.withResolvers<void>();
  const close = vi.fn(async () => {});
  vi.mocked(watchWorkflows).mockImplementationOnce(() => {
    started.resolve();
    return opening.promise;
  });
  const start = runtime.start(directory);
  await started.promise;
  await runtime.stop();
  opening.resolve({ close, ready: Promise.resolve() });
  await start;
  expect(close).toHaveBeenCalledTimes(1);
  expect(runtime.events).toEqual([]);
  expect(await runtime.request("list")).toMatchObject({
    ok: false,
    error: expect.stringMatching(/unavailable/),
  });
});
