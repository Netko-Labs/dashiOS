/**
 * A stand-in for dashi-mcp (vm/agent's DASHI_AGENT_CMD): answers initialize
 * and tools/call, a screenshot with a 1922 × 1201 PNG's header, and writes
 * to the log file it is given when each call came and when the session ended.
 */

import { appendFileSync } from "node:fs";

const log = process.argv[2] ?? "/dev/null";
const note = (what: string): void => appendFileSync(log, `${JSON.stringify({ what, at: performance.timeOrigin + performance.now() })}\n`);

function pngHeader(width: number, height: number): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

let pending = "";
for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk);
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as { id?: number; method: string; params?: { name?: string } };
    if (message.id === undefined) continue;
    const name = message.params?.name;
    if (message.method === "tools/call") note(`call ${name}`);
    const result =
      message.method === "tools/call" && name === "screenshot"
        ? { content: [{ type: "image", mimeType: "image/png", data: pngHeader(1922, 1201) }] }
        : message.method === "tools/call"
          ? { content: [{ type: "text", text: "ok" }] }
          : {};
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  }
}
note("end");
