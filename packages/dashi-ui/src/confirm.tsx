/**
 * Asking before something that can't be taken back (docs/design.html, PA-1
 * and UI-6): a sheet with the question, what will be lost, Cancel, and the
 * button that goes ahead. When going ahead destroys something (`danger`),
 * that button is ume and Enter never presses it: Enter and Esc both cancel,
 * and Cancel wears the kombu ring that says it is the default. Only a click
 * on the ume button goes ahead.
 *
 * `useConfirm` is the short way to it: `confirm.ask({...})` from a handler,
 * and `confirm.sheet` in the window's `overlay`.
 */

import { type ReactNode, useState } from "react";
import { AlertSheet } from "./alert.tsx";
import { WARNING } from "./glyphs.ts";
import type { KeyInput } from "./keys.ts";

export interface ConfirmSheetProps {
  /** The question, naming the thing: "Delete “Groceries”?" */
  title: string;
  /** What will be lost, or what happens next: "You can't undo this." */
  message: string;
  /** The button that goes ahead, saying what it does ("Delete", "Force Quit"). */
  confirmLabel: string;
  /** It can't be taken back: the button is ume, and Enter cancels. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
  /** A glyph beside the title; a warning sign by default. */
  glyph?: string;
}

/** What a key does on a confirm sheet: Esc cancels; Enter goes ahead only when that is safe. */
export function confirmKeyAction(key: KeyInput, danger: boolean): "confirm" | "cancel" | null {
  if (key.kind === "escape") return "cancel";
  if (key.kind === "enter") return danger ? "cancel" : "confirm";
  return null;
}

/** A question with Cancel and one button that goes ahead; see the module comment for the keys. */
/** A question with Cancel and one button that goes ahead, in the one alert frame (alert.tsx); see the module comment for the keys. */
export function ConfirmSheet({ title, message, confirmLabel, danger = false, onConfirm, onCancel, testID = "confirm", glyph = WARNING }: ConfirmSheetProps) {
  return (
    <AlertSheet
      testID={testID}
      question={title}
      message={message}
      glyph={glyph}
      tone={danger ? "danger" : "neutral"}
      buttons={[
        // Danger: Cancel is what Enter presses too, so only a click on the ume button goes ahead.
        { label: "Cancel", testID: `${testID}:cancel`, onPress: onCancel, cancel: true, isDefault: danger },
        { label: confirmLabel, testID: `${testID}:ok`, onPress: onConfirm, kind: danger ? "danger" : "primary" },
      ]}
    />
  );
}

/** What `confirm.ask` takes: the sheet's words, and what to do on each answer. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  glyph?: string;
  testID?: string;
  onConfirm: () => void;
  /** After Cancel, Esc, or (for `danger`) Enter. */
  onCancel?: () => void;
}

export interface Confirm {
  /** Show the sheet; a second ask replaces the first. */
  ask: (request: ConfirmRequest) => void;
  /** The sheet while one is asked, else null: pass it as the window's `overlay`. */
  sheet: ReactNode;
  /** A sheet is up (hold the window's own keys while it is). */
  isOpen: boolean;
}

/** One confirm sheet for a window: ask from a handler, put `sheet` in the overlay. */
export function useConfirm(): Confirm {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const answer = (go: boolean): void => {
    if (!request) return;
    setRequest(null);
    if (go) request.onConfirm();
    else request.onCancel?.();
  };
  return {
    ask: setRequest,
    isOpen: request !== null,
    sheet:
      request === null ? null : (
        <ConfirmSheet
          title={request.title}
          message={request.message}
          confirmLabel={request.confirmLabel}
          danger={request.danger}
          glyph={request.glyph}
          testID={request.testID}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      ),
  };
}
