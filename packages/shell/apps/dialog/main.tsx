/**
 * Dashi's dialogs (dev.dashi.dialog), for shell scripts: `dashi-dialog
 * --question --text "Delete it?"`, with Zenity's command line, stdin, output,
 * and exit status, so it can stand in for `zenity`. One dialog per process;
 * what the person chose goes to stdout and the process exits with Zenity's
 * code: 0 OK, 1 Cancel or closed, 5 timed out, 255 an error (cli.ts).
 */

import { existsSync, writeSync } from "node:fs";
import type { ReactElement } from "react";
import { METAL_HOST } from "../../src/shared/apps/index.ts";
import { type RunningApp, runApp } from "../kit/index.ts";
import { CalendarDialog } from "./calendar.tsx";
import { prepare } from "./cli.ts";
import { EntryDialog, PasswordDialog } from "./entry.tsx";
import { FileSelectionDialog } from "./file-selection-view.tsx";
import type { Answer } from "./frame.tsx";
import { ListDialog } from "./list-view.tsx";
import { MessageDialog } from "./message.tsx";
import { ProgressDialog } from "./progress-view.tsx";
import { ScaleDialog } from "./scale.tsx";
import { dialogSize, type Size } from "./size.ts";
import type { DialogSpec } from "./spec.ts";
import { TextInfoDialog } from "./text-info.tsx";

/** Zenity's status when the dialog's `--timeout` runs out. */
const TIMED_OUT = 5;

/** Straight to fd 1, before the process exits; a reader that went away loses it. */
function print(text: string): void {
  try {
    writeSync(1, text);
  } catch {
    // Nobody is reading stdout.
  }
}

function dialogFor(spec: DialogSpec, answer: Answer, size: Size): ReactElement {
  switch (spec.kind) {
    case "info":
    case "warning":
    case "error":
    case "question":
      return <MessageDialog spec={spec} answer={answer} />;
    case "progress":
      return <ProgressDialog spec={spec} answer={answer} />;
    case "entry":
      return <EntryDialog spec={spec} answer={answer} />;
    case "password":
      return <PasswordDialog spec={spec} answer={answer} />;
    case "list":
      return <ListDialog spec={spec} answer={answer} />;
    case "text-info":
      return <TextInfoDialog spec={spec} answer={answer} />;
    case "scale":
      return <ScaleDialog spec={spec} answer={answer} width={size.width} print={print} />;
    case "calendar":
      return <CalendarDialog spec={spec} answer={answer} />;
    case "file-selection":
      return <FileSelectionDialog spec={spec} answer={answer} />;
  }
}

const prepared = prepare(Bun.argv.slice(2));
for (const line of prepared.stderr) console.error(line);
if ("exit" in prepared) {
  print(prepared.stdout);
  process.exit(prepared.exit);
}
const { spec } = prepared;

let app: RunningApp | null = null;
let answered = false;
const answer: Answer = (code, output) => {
  if (answered) return;
  answered = true;
  if (output !== undefined) print(output);
  if (app) app.quit(code);
  else process.exit(code);
};

// The kit exits 1 without a host, which a script would take for No: here it is an error.
const host = process.env.DASHI_METAL_HOST ?? METAL_HOST;
if (!existsSync(host)) {
  console.error(`dashi-dialog: no Metal host at ${host}; set DASHI_METAL_HOST`);
  process.exit(255);
}
const size = dialogSize(spec, spec.kind === "list" ? Math.ceil(spec.cells.length / spec.columns.length) : 0);
app = runApp({ id: "dev.dashi.dialog", title: spec.title, size, host, closeCode: 1 }, dialogFor(spec, answer, size));
if (spec.timeout !== null) setTimeout(() => answer(TIMED_OUT), spec.timeout * 1000);
