/** The few extension APIs Dashi's extension uses (Chromium's MV3), declared by hand: no @types/chrome dependency. */

declare namespace chrome {
  namespace runtime {
    interface Port {
      name: string;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: Event<(message: unknown) => void>;
      onDisconnect: Event<() => void>;
    }
    interface MessageSender {
      id?: string;
      tab?: tabs.Tab;
      frameId?: number;
    }
    const lastError: { message?: string } | undefined;
    const id: string;
    function connectNative(application: string): Port;
    function getManifest(): { version: string };
    const onMessage: Event<(message: unknown, sender: MessageSender, respond: (response: unknown) => void) => boolean | undefined>;
    const onStartup: Event<() => void>;
    const onInstalled: Event<() => void>;
  }

  interface Event<T> {
    addListener(listener: T): void;
    removeListener(listener: T): void;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId: number;
      active: boolean;
      title?: string;
      url?: string;
      pendingUrl?: string;
      status?: "loading" | "complete" | "unloaded";
    }
    function query(query: { active?: boolean; lastFocusedWindow?: boolean; windowType?: "normal" }): Promise<Tab[]>;
    function get(tabId: number): Promise<Tab>;
    function update(tabId: number, change: { url?: string; active?: boolean }): Promise<Tab>;
    function create(options: { url: string; active?: boolean; windowId?: number }): Promise<Tab>;
    function sendMessage(tabId: number, message: unknown, options: { frameId: number }): Promise<unknown>;
    function getZoom(tabId: number): Promise<number>;
    const onRemoved: Event<(tabId: number) => void>;
  }

  namespace windows {
    interface Window {
      id?: number;
      focused: boolean;
    }
    function update(windowId: number, change: { focused?: boolean }): Promise<Window>;
    function getLastFocused(): Promise<Window>;
    function create(options: { url: string; focused?: boolean }): Promise<Window & { tabs?: tabs.Tab[] }>;
  }

  namespace webNavigation {
    interface Frame {
      frameId: number;
      parentFrameId: number;
      url: string;
      errorOccurred: boolean;
    }
    interface Details {
      tabId: number;
      frameId: number;
      url: string;
    }
    function getAllFrames(details: { tabId: number }): Promise<Frame[] | null>;
    const onBeforeNavigate: Event<(details: Details) => void>;
    const onCommitted: Event<(details: Details) => void>;
    const onCompleted: Event<(details: Details) => void>;
    const onErrorOccurred: Event<(details: Details & { error: string }) => void>;
    const onHistoryStateUpdated: Event<(details: Details) => void>;
    const onReferenceFragmentUpdated: Event<(details: Details) => void>;
  }

  namespace alarms {
    function create(name: string, info: { periodInMinutes: number }): void;
    const onAlarm: Event<(alarm: { name: string }) => void>;
  }

  namespace scripting {
    function executeScript(injection: { target: { tabId: number; allFrames?: boolean; frameIds?: number[] }; files: string[] }): Promise<unknown[]>;
  }
}
