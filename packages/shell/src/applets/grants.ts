/**
 * The layer shell for applets, granted per process by the shell
 * (docs/compositor-ipc.md, `applet-clients`), the way screencopy is granted
 * to executables (`screencopy-clients`). The compositor hears every applet
 * process that spoke version 2 (or runs in the sandbox): Wayland clients
 * under one may open layer surfaces only while its popover is open; when
 * the grant goes, their layer surfaces are closed.
 *
 * Every change sends the whole list, and `set` resolves once the compositor
 * has it, so a popover's placement goes to the applet only after its grant
 * is in place.
 */

/** What the grants need of the compositor connection. */
export interface GrantsCompositor {
  request(method: "applet-clients", params: { applets: Array<{ pid: number; layerShell: boolean }> }): Promise<unknown>;
}

/** The most applet processes the compositor is told of at once. */
export const MAX_APPLET_CLIENTS = 64;

export class AppletGrants {
  private readonly pids = new Map<number, boolean>();

  constructor(private readonly compositor: GrantsCompositor | null) {}

  /** An applet process: no layer shell until a popover opens. */
  register(pid: number): Promise<void> {
    if (this.pids.has(pid)) return Promise.resolve();
    if (this.pids.size >= MAX_APPLET_CLIENTS) return Promise.reject(new Error("too many applet processes"));
    this.pids.set(pid, false);
    return this.send();
  }

  /** Its popover opened (true) or closed (false). */
  set(pid: number, layerShell: boolean): Promise<void> {
    if (!this.pids.has(pid) || this.pids.get(pid) === layerShell) return Promise.resolve();
    this.pids.set(pid, layerShell);
    return this.send();
  }

  /** It went (its connection closed). */
  forget(pid: number): Promise<void> {
    if (!this.pids.delete(pid)) return Promise.resolve();
    return this.send();
  }

  granted(pid: number): boolean {
    return this.pids.get(pid) === true;
  }

  private async send(): Promise<void> {
    if (!this.compositor) return;
    const applets = [...this.pids].map(([pid, layerShell]) => ({ pid, layerShell }));
    await this.compositor.request("applet-clients", { applets });
  }
}
