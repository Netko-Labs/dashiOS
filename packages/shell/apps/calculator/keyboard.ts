/**
 * The Calculator's keyboard: what a key (from the kit's KeySink) presses.
 * Digits, . or , for the point, + - * x / for the operators, = or Enter,
 * % , Backspace, Esc (or c) to clear. Text pasted with Ctrl+V is a number
 * when it reads as one, else typed key by key ("12×3=" works).
 */

import { type KeyInput } from "@dashi/ui";
import type { CalcKey } from "./engine.ts";
import { parsePasted } from "./format.ts";

export function keyForChar(char: string): CalcKey | null {
  if (/^[0-9]$/.test(char)) return { kind: "digit", digit: char };
  switch (char) {
    case ".":
    case ",":
      return { kind: "decimal" };
    case "+":
      return { kind: "operator", op: "+" };
    case "-":
    case "−":
      return { kind: "operator", op: "-" };
    case "*":
    case "x":
    case "X":
    case "×":
      return { kind: "operator", op: "×" };
    case "/":
    case "÷":
      return { kind: "operator", op: "÷" };
    case "=":
      return { kind: "equals" };
    case "%":
      return { kind: "percent" };
    case "c":
    case "C":
      return { kind: "clear" };
    default:
      return null;
  }
}

export function calcKeysFor(input: KeyInput): CalcKey[] {
  switch (input.kind) {
    case "enter":
      return [{ kind: "equals" }];
    case "escape":
      return [{ kind: "clear" }];
    case "backspace":
      return [{ kind: "backspace" }];
    case "up":
    case "down":
      return [];
    case "text": {
      const chars = [...input.text];
      if (chars.length > 1) {
        const pasted = parsePasted(input.text);
        if (pasted !== null) return [{ kind: "number", value: pasted }];
      }
      return chars.flatMap((char) => {
        const key = keyForChar(char);
        return key ? [key] : [];
      });
    }
  }
}
