import { describe, expect, test } from "bun:test";

import { parseEvent, parseWindow, parseWindowIcon } from "../src/compositor.ts";

const window = {
	id: 3,
	appId: "foot",
	title: "foot",
	pid: 42,
	focused: true,
	state: "normal",
	zoomed: false,
};

describe("window icons", () => {
	test("a theme name, a picture, or both", () => {
		expect(parseWindowIcon({ name: "foot", path: null })).toEqual({
			name: "foot",
			path: null,
		});
		expect(
			parseWindowIcon({
				name: null,
				path: "/run/user/1000/dashi-comp-icons/3.png",
			}),
		).toEqual({
			name: null,
			path: "/run/user/1000/dashi-comp-icons/3.png",
		});
		expect(parseWindowIcon({ name: "", path: 7 })).toBeNull();
		expect(parseWindowIcon(null)).toBeNull();
	});

	test("a window carries its icon only when it has one", () => {
		expect(
			parseWindow({ ...window, icon: { name: "foot", path: null } })?.icon,
		).toEqual({ name: "foot", path: null });
		expect(parseWindow({ ...window, icon: null })).not.toHaveProperty("icon");
	});

	test("window-icon tells a change, including back to none", () => {
		expect(
			parseEvent({ event: "window-icon", window: 3, name: "foot", path: null }),
		).toEqual({
			event: "window-icon",
			window: 3,
			icon: { name: "foot", path: null },
		});
		expect(
			parseEvent({ event: "window-icon", window: 3, name: null, path: null }),
		).toEqual({
			event: "window-icon",
			window: 3,
			icon: { name: null, path: null },
		});
		expect(parseEvent({ event: "window-icon", window: "3" })).toBeNull();
	});
});

test("the bell names a window or none", () => {
	expect(parseEvent({ event: "bell", window: 3 })).toEqual({
		event: "bell",
		window: 3,
	});
	expect(parseEvent({ event: "bell", window: null })).toEqual({
		event: "bell",
		window: null,
	});
	expect(parseEvent({ event: "bell" })).toBeNull();
});

test("X11 windows say so", () => {
	expect(parseWindow({ ...window, x11: true })?.x11).toBe(true);
	expect(parseWindow({ ...window, x11: false })).not.toHaveProperty("x11");
});
