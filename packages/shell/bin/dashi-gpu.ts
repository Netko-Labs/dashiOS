#!/usr/bin/env bun
/**
 * dashi-gpu: the GPU the display should run on (src/gpu/gpu.ts), for the
 * programs that open one before the shell runs: dashi-session passes it to
 * dashi-comp as DASHI_DRM_DEVICE, and the login screen's Weston gets it as
 * --drm-device.
 *
 *   dashi-gpu            /dev/dri/card2 on stdout, the reason on stderr
 *   dashi-gpu --name     card2
 *
 * Exits 1, printing nothing on stdout, when there is no GPU.
 */

import { chooseGpu, readCards } from "../src/gpu/index.ts";

const cards = readCards();
const choice = chooseGpu(cards);
if (!choice) {
  console.error("dashi-gpu: no GPU found under /sys/class/drm");
  process.exit(1);
}
const listed = cards.map((card) => `${card.name} (${card.driver ?? "no driver"})`).join(", ");
console.error(`dashi-gpu: ${choice.card.name} (${choice.card.driver ?? "no driver"}): ${choice.why}; cards: ${listed}`);
console.log(Bun.argv.includes("--name") ? choice.card.name : choice.card.devnode);
