// @vitest-environment jsdom
import { mountWorkflow, mountWorkflows, type LobsterView } from "@clawdbot/lobster-viewer";
import type { ControlUiPage, ControlUiView } from "openclaw/plugin-sdk/control-ui";
import { expect, it, vi } from "vitest";
import plugin from "./index.js";

vi.mock("@clawdbot/lobster-viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clawdbot/lobster-viewer")>()),
  mountWorkflow: vi.fn<LobsterView>(),
  mountWorkflows: vi.fn<LobsterView>(),
}));

it("adapts navigation, read RPCs, events, theme, and view disposal to the shared viewer", async () => {
  const originalColorScheme = document.documentElement.style.colorScheme;
  document.documentElement.style.colorScheme = "light";
  const pages = new Map<string, ControlUiPage>();
  const disposeRegistration = vi.fn();
  const disposeEvent = vi.fn();
  const disposeSubscription = vi.fn();
  const disposeView = vi.fn();
  const updateView = vi.fn();
  const request = vi.fn().mockResolvedValue({ ok: true, result: { workflows: [] } });
  const host = {
    connection: { connected: true },
    request,
    onEvent: vi.fn(() => disposeEvent),
    subscribe: vi.fn((_listener: () => void) => disposeSubscription),
    navigation: { pageHref: vi.fn(), openPage: vi.fn() },
    components: { mountDialog: vi.fn() },
    ui: {
      registerPage: vi.fn((page: ControlUiPage) => {
        pages.set(page.id, page);
        return disposeRegistration;
      }),
      registerNavigation: vi.fn(() => disposeRegistration),
    },
  };
  // Supply only the capabilities this adapter owns; no Gateway or application is booted.
  const disposePlugin: () => void = Reflect.apply(plugin.activate, plugin, [host]);
  const container = document.createElement("div");
  const lifetime = new AbortController();
  vi.mocked(mountWorkflow).mockReturnValue({ update: updateView, dispose: disposeView });
  let mounted: ReturnType<ControlUiView> = undefined;
  try {
    expect(plugin.id).toBe("lobster");
    expect([...pages.keys()]).toEqual(["workflows", "workflow"]);
    expect(host.ui.registerNavigation).toHaveBeenCalledWith({
      id: "workflows",
      label: "Lobster",
      page: { id: "workflows" },
      icon: "gitFork",
    });
    const page = pages.get("workflow");
    if (!page) {
      throw new Error("Missing workflow page");
    }
    const context = {
      host,
      signal: lifetime.signal,
      props: { workflowId: "builtin:github.pr.monitor" },
      presented: true,
    };
    mounted = Reflect.apply(page.mount, page, [container, context]);
    const view = vi.mocked(mountWorkflow).mock.calls.at(-1)?.[1];
    if (!view) {
      throw new Error("The page did not mount the shared viewer");
    }
    expect(view.props).toEqual(context.props);
    expect(view.host.theme.colorMode).toBe("light");
    document.documentElement.style.colorScheme = "dark";
    host.subscribe.mock.calls[0]?.[0]();
    expect(view.host.theme.colorMode).toBe("dark");
    expect(view.host.navigation).toBe(host.navigation);
    expect(view.host.components).toBe(host.components);
    if (mounted?.update) {
      Reflect.apply(mounted.update, mounted, [
        { ...context, props: { workflowId: "next" }, presented: false },
      ]);
    }
    expect(updateView).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { workflowId: "next" },
        presented: false,
        signal: view.signal,
      }),
    );
    host.connection = { connected: false };
    expect(view.host.connection.connected).toBe(false);
    const unsubscribe = view.host.onWorkflowsChanged(() => {});
    expect(host.onEvent).toHaveBeenCalledWith(
      "plugin.lobster.workflows-changed",
      expect.any(Function),
    );
    unsubscribe();
    expect(disposeEvent).toHaveBeenCalledTimes(1);
    const workflows = view.host.workflows;
    expect(await workflows.list()).toEqual({ workflows: [] });
    await workflows.get("id");
    await workflows.files("id");
    await workflows.file("id", "workflow.lobster");
    expect(request.mock.calls).toEqual([
      ["lobster.workflows.list", {}],
      ["lobster.workflows.get", { id: "id" }],
      ["lobster.workflows.files", { id: "id" }],
      ["lobster.workflows.file", { id: "id", path: "workflow.lobster" }],
    ]);
    request.mockResolvedValueOnce({ ok: false, error: "Select a workflow." });
    await expect(workflows.get("missing")).rejects.toThrow("Select a workflow.");
    const pending = Promise.withResolvers<unknown>();
    request.mockReturnValueOnce(pending.promise);
    const late = workflows.list();
    lifetime.abort();
    pending.resolve({ ok: true, result: { workflows: [] } });
    await expect(late).rejects.toThrow();
    await expect(workflows.list()).rejects.toThrow();
    expect(disposeSubscription).toHaveBeenCalledTimes(1);
    mounted?.dispose?.();
    mounted = undefined;
    expect(disposeView).toHaveBeenCalledTimes(1);
    expect(mountWorkflows).not.toHaveBeenCalled();
  } finally {
    lifetime.abort();
    mounted?.dispose?.();
    disposePlugin();
    vi.mocked(mountWorkflow).mockReset();
    vi.mocked(mountWorkflows).mockReset();
    document.documentElement.style.colorScheme = originalColorScheme;
  }
  expect(disposeRegistration).toHaveBeenCalledTimes(3);
});
