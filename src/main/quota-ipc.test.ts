import type { IpcMainInvokeEvent, IpcRendererEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { UsageQuotaSnapshot } from "../core/types";
import { createQuotaApi } from "../preload/quota";
import { QUOTA_EVENTS, QUOTA_IPC } from "../shared/ipc/quota";
import { IpcInputError } from "../shared/ipc/contract";
import { registerQuotaIpc } from "./ipc/quota";
import type { IpcMainRegistrar } from "./ipc/register-ipc-handler";

type RegisteredHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const snapshot: UsageQuotaSnapshot = {
  generatedAt: "2026-07-23T08:00:00.000Z",
  providers: [],
  freshness: "fresh",
};

function createMainRegistrar() {
  const handlers = new Map<string, RegisteredHandler>();
  const removed: string[] = [];
  const ipc = {
    handle(channel: string, listener: RegisteredHandler) {
      handlers.set(channel, listener);
    },
    removeHandler(channel: string) {
      removed.push(channel);
      handlers.delete(channel);
    },
  } as unknown as IpcMainRegistrar;
  return { ipc, handlers, removed };
}

describe("quota IPC", () => {
  it("normalizes the optional force flag and disposes the handler", async () => {
    const { ipc, handlers, removed } = createMainRegistrar();
    const service = { getSnapshot: vi.fn(async () => snapshot) };
    const dispose = registerQuotaIpc(ipc, service);
    const event = {} as IpcMainInvokeEvent;

    await handlers.get(QUOTA_IPC.get.channel)?.(event);
    await handlers.get(QUOTA_IPC.get.channel)?.(event, true);
    expect(service.getSnapshot).toHaveBeenNthCalledWith(1, false);
    expect(service.getSnapshot).toHaveBeenNthCalledWith(2, true);

    expect(() => handlers.get(QUOTA_IPC.get.channel)?.(event, "yes")).toThrow(IpcInputError);
    dispose();
    expect(removed).toEqual([QUOTA_IPC.get.channel]);
  });

  it("delivers quota updates through preload and unsubscribes", async () => {
    const invoke = vi.fn(async () => snapshot);
    const listeners = new Map<string, (event: IpcRendererEvent, value: UsageQuotaSnapshot) => void>();
    const removeListener = vi.fn((channel: string) => listeners.delete(channel));
    const renderer = {
      invoke,
      on(channel: string, listener: (event: IpcRendererEvent, value: UsageQuotaSnapshot) => void) {
        listeners.set(channel, listener);
        return renderer;
      },
      removeListener,
    } as unknown as Parameters<typeof createQuotaApi>[0];
    const api = createQuotaApi(renderer);
    const callback = vi.fn();

    await api.getQuotas();
    await api.getQuotas(true);
    const unsubscribe = api.onQuotaUpdated(callback);
    listeners.get(QUOTA_EVENTS.updated)?.({} as IpcRendererEvent, snapshot);
    expect(invoke.mock.calls).toEqual([
      [QUOTA_IPC.get.channel, false],
      [QUOTA_IPC.get.channel, true],
    ]);
    expect(callback).toHaveBeenCalledWith(snapshot);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(QUOTA_EVENTS.updated, expect.any(Function));
  });
});
