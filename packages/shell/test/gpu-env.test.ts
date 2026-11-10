/* biome-ignore-all lint/style/useNamingConvention: environment variable names, as the loaders spell them */
import { expect, test } from "bun:test";
import type { Card } from "../src/gpu.ts";
import { gpuEnvFor, gpuEnvs, MESA_EGL } from "../src/gpu-env.ts";
import { parseDesktopEntry } from "../src/shared/apps/index.ts";

const card = (name: string, driver: string): Card => ({ name, devnode: `/dev/dri/${name}`, driver, bootVga: false, connectors: [] });
const amd = card("card1", "amdgpu");
const yes = () => true;

test("an AMD-driven screen beside an NVIDIA card: apps see the AMD GPU; ones asking for the other get NVIDIA's offload", () => {
  const envs = gpuEnvs(amd, [card("card0", "nvidia"), amd], yes);
  expect(envs.display).toEqual({ VK_LOADER_DRIVERS_SELECT: "*radeon*", __EGL_VENDOR_LIBRARY_FILENAMES: MESA_EGL });
  expect(envs.discrete).toEqual({ __NV_PRIME_RENDER_OFFLOAD: "1", __VK_LAYER_NV_optimus: "NVIDIA_only", __GLX_VENDOR_LIBRARY_NAME: "nvidia" });
  // nouveau on the NVIDIA card (before the NVIDIA driver is built): Mesa's PRIME.
  expect(gpuEnvs(amd, [card("card0", "nouveau"), amd], yes).discrete).toEqual({ DRI_PRIME: "1" });
  // No Mesa EGL manifest: Vulkan only.
  expect(gpuEnvs(amd, [card("card0", "nvidia"), amd], () => false).display).toEqual({ VK_LOADER_DRIVERS_SELECT: "*radeon*" });
});

test("nothing to steer: one GPU, the screens on NVIDIA, or a GPU it doesn't know", () => {
  const none = { display: {}, discrete: {} };
  expect(gpuEnvs(amd, [amd], yes)).toEqual(none);
  expect(gpuEnvs(card("card0", "nvidia"), [card("card0", "nvidia"), amd], yes)).toEqual(none);
  expect(gpuEnvs(card("card2", "simpledrm"), [card("card0", "nvidia"), card("card2", "simpledrm")], yes)).toEqual(none);
  expect(gpuEnvs(null, [amd], yes)).toEqual(none);
});

test("which apps get which: Dashi's own and anything the person steered get nothing", () => {
  const envs = gpuEnvs(card("card1", "i915"), [card("card0", "nvidia"), card("card1", "i915")], yes);
  expect(gpuEnvFor({ id: "helium" }, envs, {})).toEqual(envs.display);
  expect(gpuEnvFor({ id: "steam", gpu: "discrete" }, envs, {})).toEqual(envs.discrete);
  expect(gpuEnvFor({ id: "dev.dashi.terminal" }, envs, {})).toEqual({});
  expect(gpuEnvFor({ id: "helium" }, envs, { DRI_PRIME: "1" })).toEqual({});
  expect(envs.display.VK_LOADER_DRIVERS_SELECT).toBe("*intel*");
});

test("a lost card: an app that asks for it starts on the screens' GPU", () => {
  const envs = gpuEnvs(amd, [card("card0", "nvidia"), amd], yes);
  expect(gpuEnvFor({ id: "steam", gpu: "discrete" }, envs, {}, true)).toEqual(envs.display);
  expect(gpuEnvFor({ id: "helium" }, envs, {}, true)).toEqual(envs.display);
});

test("a desktop entry that asks for the discrete GPU says so (Steam sets both keys)", () => {
  const steam = parseDesktopEntry("steam", "[Desktop Entry]\nType=Application\nName=Steam\nExec=/usr/bin/steam %U\nPrefersNonDefaultGPU=true\n");
  expect(steam?.gpu).toBe("discrete");
  const kde = parseDesktopEntry("game", "[Desktop Entry]\nType=Application\nName=Game\nExec=game\nX-KDE-RunOnDiscreteGpu=true\n");
  expect(kde?.gpu).toBe("discrete");
  expect(parseDesktopEntry("helium", "[Desktop Entry]\nType=Application\nName=Helium\nExec=helium\n")?.gpu).toBeUndefined();
});
