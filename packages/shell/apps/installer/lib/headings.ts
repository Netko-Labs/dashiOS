/**
 * The title and subtitle of each installer page, as the Setup Assistant
 * words them (the frame in view.tsx shows them).
 */

import type { Page } from "./model.ts";

export const HEADINGS: Record<Page, { title: string; subtitle: string }> = {
  welcome: { title: "Install Dashi", subtitle: "Put Dashi on this computer. It takes about ten minutes." },
  disk: { title: "Choose a Disk", subtitle: "Dashi takes the whole disk you choose." },
  account: { title: "Create Your Account", subtitle: "You sign in with it, and it can change the system." },
  options: { title: "Drivers and Kernel", subtitle: "What Dashi sets up for this computer's hardware." },
  confirm: { title: "Ready to Install", subtitle: "Check your choices. Nothing has been changed yet." },
  installing: { title: "Installing Dashi", subtitle: "Keep the computer on and the USB drive in." },
  done: { title: "Dashi Is Installed", subtitle: "Restart and remove the USB drive to start using it." },
  failed: { title: "Dashi Wasn't Installed", subtitle: "Something went wrong. The disk may be partly erased." },
};
