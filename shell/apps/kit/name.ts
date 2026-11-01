/**
 * The app's process name, so Activity Monitor and `ps` list "Calculator",
 * not "bun". Bun's `process.title` leaves the kernel's name alone, so this
 * is prctl(PR_SET_NAME) through bun:ffi (libc; the kernel keeps 15 bytes).
 * Best effort: anywhere it can't, the process keeps its name.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";

const PR_SET_NAME = 15;

/** The kernel's 15-byte name for `title`, NUL-terminated. */
export function kernelName(title: string): Uint8Array {
  const bytes = new TextEncoder().encode(title).subarray(0, 15);
  const out = new Uint8Array(16);
  out.set(bytes);
  return out;
}

export function setProcessName(title: string): boolean {
  try {
    const libc = dlopen("libc.so.6", { prctl: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 } });
    const name = kernelName(title);
    const result = libc.symbols.prctl(PR_SET_NAME, ptr(name), 0, 0, 0);
    libc.close();
    return result === 0;
  } catch {
    return false;
  }
}
