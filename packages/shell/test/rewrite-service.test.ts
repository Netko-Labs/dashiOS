import { expect, test } from "bun:test";
import { MODEL } from "../src/rewrite/lib/model.ts";
import { deviceOf, modelPath, PACKAGED_SERVER, rewriteSocket, serverCommand, serverProgram, threads } from "../src/rewrite/lib/service.ts";
import { adviceFor, expectedMs, ONCE_MS, REFINE_MOST_MS, tooSlow } from "../src/rewrite/lib/speed-store.ts";

test("the socket is in the runtime directory, never a port; the model is beside the speech models", () => {
  expect(rewriteSocket({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("/run/user/1000/dashi-rewrite.sock");
  expect(rewriteSocket({ XDG_RUNTIME_DIR: "/run/user/1000", DASHI_REWRITE_SOCKET: "/x/s.sock" })).toBe("/x/s.sock");
  expect(rewriteSocket({})).toBeNull();
  expect(modelPath({ HOME: "/home/alexk" })).toBe(`/home/alexk/.local/share/dashi/voice/rewrite/${MODEL.file}`);
  expect(modelPath({ HOME: "/home/alexk", XDG_DATA_HOME: "/data" })).toBe(`/data/dashi/voice/rewrite/${MODEL.file}`);
  expect(modelPath({ DASHI_VOICE_MODELS: "/models" })).toBe(`/models/rewrite/${MODEL.file}`);
});

test("the server program is the packaged one, or the one a checkout names; none when it is not there", () => {
  const there = (path: string): boolean => path === PACKAGED_SERVER || path === "/build/llama-server";
  expect(serverProgram({}, there)).toBe(PACKAGED_SERVER);
  expect(serverProgram({ DASHI_REWRITE_SERVER: "/build/llama-server" }, there)).toBe("/build/llama-server");
  expect(serverProgram({ DASHI_REWRITE_SERVER: "/gone" }, there)).toBeNull();
  expect(serverProgram({}, () => false)).toBeNull();
});

test("the unit: a Unix socket only, no network, no core dump, the NVIDIA card left asleep, thinking off", () => {
  const command = serverCommand("/usr/libexec/dashi/llama/llama-server", "/models/rewrite/m.gguf", "/run/user/1000/dashi-rewrite.sock", 24);
  expect(command.slice(0, 6)).toEqual(["systemd-run", "--user", "--collect", "--quiet", "--unit", "dashi-rewrite"]);
  const text = command.join(" ");
  for (const property of ["RestrictAddressFamilies=AF_UNIX", "NoNewPrivileges=yes", "LimitCORE=0", "UMask=0077", "PartOf=dashi-session.target"]) {
    expect(text).toContain(`-p ${property}`);
  }
  expect(text).toContain("--setenv=VK_LOADER_DRIVERS_DISABLE=*nvidia*,*lvp*");
  expect(text).toContain("/usr/libexec/dashi/llama/llama-server -m /models/rewrite/m.gguf --host /run/user/1000/dashi-rewrite.sock -ngl 0 --device none");
  expect(text).toContain("-np 1 -t 8");
  // Asked for a graphics card, it may use one; the NVIDIA card stays out of it either way.
  const onGpu = serverCommand("/x/llama-server", "/m.gguf", "/s.sock", 24, "gpu").join(" ");
  expect(onGpu).toContain("-ngl 99");
  expect(onGpu).not.toContain("--device none");
  expect(onGpu).toContain("VK_LOADER_DRIVERS_DISABLE=*nvidia*,*lvp*");
  expect([deviceOf({}), deviceOf({ DASHI_REWRITE_DEVICE: "gpu" }), deviceOf({ DASHI_REWRITE_DEVICE: "nvidia" })]).toEqual(["cpu", "gpu", "cpu"]);
  expect(text).toContain("-rea off");
  expect(text).not.toContain("--port");
});

test("half the threads, eight at most, two at least", () => {
  expect([threads(24), threads(8), threads(2), threads(1)]).toEqual([8, 4, 2, 2]);
});

test("the speed test's word: land once when a sentence is quick, refine when it is not, never when far too slow", () => {
  const speed = (ms: number) => ({ model: MODEL.file, ms });
  // Not timed yet: the usual limit.
  expect(adviceFor(null)).toEqual({ land: "once", deadlineMs: ONCE_MS });
  // 240 ms for sixteen words (the development laptop's processor): forty words still land once.
  expect(adviceFor(speed(240))).toEqual({ land: "once", deadlineMs: ONCE_MS });
  expect(expectedMs(speed(240), 40)).toBe(600);
  expect(adviceFor(speed(240), 40)).toEqual({ land: "once", deadlineMs: ONCE_MS });
  // A long dictation would take seconds: land the rules' text, then refine.
  expect(adviceFor(speed(240), 120)).toEqual({ land: "refine", deadlineMs: 3600 });
  expect(adviceFor(speed(240), 600)).toEqual({ land: "refine", deadlineMs: REFINE_MOST_MS });
  // A slow machine refines even a short sentence.
  expect(adviceFor(speed(1500)).land).toBe("refine");
  expect(tooSlow(speed(1500))).toBe(false);
  expect(tooSlow(speed(2600))).toBe(true);
  expect(tooSlow(null)).toBe(false);
});
