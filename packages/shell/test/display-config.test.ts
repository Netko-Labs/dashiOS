import { expect, test } from "bun:test";

import { parseMonitors } from "../src/display-config/monitors.ts";
import { toWire } from "../src/display-config/plan.ts";

const output = {
	name: "DP-1",
	make: "Dell",
	model: "U2720Q",
	mode: { width: 3840, height: 2160, refreshMhz: 60000 },
	modes: [],
};

test("variable refresh rate is read, off when not said", () => {
	const [on] = parseMonitors({
		outputs: [
			{ ...output, vrr: { supported: true, active: true, mode: "fullscreen" } },
		],
	});
	expect(on?.vrr).toEqual({
		supported: true,
		active: true,
		mode: "fullscreen",
	});
	const [old] = parseMonitors({ outputs: [output] });
	expect(old?.vrr).toEqual({ supported: false, active: false, mode: "off" });
	const [odd] = parseMonitors({
		outputs: [{ ...output, vrr: { supported: true, mode: "sometimes" } }],
	});
	expect(odd?.vrr.mode).toBe("off");
});

test("a variable refresh rate choice goes out only when made", () => {
	expect(toWire({ outputs: [{ name: "DP-1", vrr: "on" }] })).toEqual({
		outputs: [{ name: "DP-1", vrr: "on" }],
	});
	expect(toWire({ outputs: [{ name: "DP-1", scale: 2 }] })).toEqual({
		outputs: [{ name: "DP-1", scale: 2 }],
	});
});
