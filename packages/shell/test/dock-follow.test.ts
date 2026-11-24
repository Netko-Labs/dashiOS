/**
 * The Dock follows the person (D555): it lives on the main display, and the
 * pointer resting against another screen's bottom edge brings it there; it
 * goes home when the main display changes or its screen goes.
 */

import { expect, test } from "bun:test";
import { Autohide } from "../src/dock/lib/autohide.ts";
import type { Slide } from "../src/dock/lib/slide.tsx";
import { DockPresenter, FOLLOW_MS } from "../src/dock/presenter.ts";
import type { DockSettings } from "../src/dock/settings.ts";
import { settle } from "./support/time.ts";

function harness(settings: DockSettings, pointer: { screen: string | undefined }) {
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  let now = 0;
  const later = (fn: () => void, ms: number) => {
    const timer = { at: now + ms, fn, live: true };
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers) {
      if (!timer.live || timer.at > now) continue;
      timer.live = false;
      timer.fn();
    }
  };
  const shownOn: Array<string | undefined> = [];
  const claims: Array<[number, string | undefined]> = [];
  const view = {
    shown: false,
    variant: undefined as string | undefined,
    output: undefined as string | undefined,
    show(output: string | undefined, variant: string) {
      if (view.shown && view.output === output && view.variant === variant) return;
      Object.assign(view, { shown: true, output, variant });
      shownOn.push(output);
    },
    hide() {
      view.shown = false;
    },
    close() {
      view.shown = false;
    },
  };
  const slide = { armEntrance() {}, show() {}, hide() {} } as unknown as Slide;
  const presenter = new DockPresenter({
    prefs: { snapshot: settings, subscribe: () => () => {} },
    autohide: new Autohide({ later }, { revealMs: 100, hideMs: 600 }),
    slide,
    view,
    edges: {
      claim: async (band, output) => {
        claims.push([band, output]);
        return false;
      },
    },
    pointerScreen: async () => pointer.screen,
    later,
  });
  presenter.start();
  return { presenter, view, shownOn, claims, advance };
}

const shown: DockSettings = { style: "dock", autohide: false, visible: true };

test("a Dock that stays shown moves to the screen whose bottom edge the pointer rests on", async () => {
  const pointer = { screen: "HDMI-A-1" as string | undefined };
  const run = harness(shown, pointer);
  run.presenter.place("eDP-1", ["eDP-1", "HDMI-A-1"]);
  expect(run.shownOn).toEqual(["eDP-1"]);
  // Every screen's edge is heard, not only its own.
  expect(run.claims.at(-1)).toEqual([1, undefined]);
  run.presenter.edge(true);
  await settle();
  run.advance(FOLLOW_MS - 1);
  expect(run.view.output).toBe("eDP-1");
  run.advance(1);
  expect(run.view.output).toBe("HDMI-A-1");
  expect(run.presenter.screen).toBe("HDMI-A-1");
});

test("a brush past another screen's edge does not move it", async () => {
  const run = harness(shown, { screen: "HDMI-A-1" });
  run.presenter.place("eDP-1", ["eDP-1", "HDMI-A-1"]);
  run.presenter.edge(true);
  await settle();
  run.advance(50);
  run.presenter.edge(false);
  run.advance(FOLLOW_MS);
  expect(run.view.output).toBe("eDP-1");
});

test("an autohidden Dock comes out on the screen the pointer pushed against", async () => {
  const run = harness({ ...shown, autohide: true }, { screen: "HDMI-A-1" });
  run.presenter.place("eDP-1", ["eDP-1", "HDMI-A-1"]);
  expect(run.view.shown).toBe(false);
  run.presenter.edge(true);
  await settle();
  run.advance(FOLLOW_MS);
  run.advance(100);
  expect(run.view.shown).toBe(true);
  expect(run.view.output).toBe("HDMI-A-1");
  // Out, it watches its own height on its own screen.
  expect(run.claims.at(-1)?.[1]).toBe("HDMI-A-1");
});

test("it goes home when its screen goes or the main display changes, and stays where it is otherwise", async () => {
  const run = harness(shown, { screen: "HDMI-A-1" });
  run.presenter.place("eDP-1", ["eDP-1", "HDMI-A-1"]);
  run.presenter.edge(true);
  await settle();
  run.advance(FOLLOW_MS);
  // Screens changed (a scale), both still there: it stays with the person.
  run.presenter.place("eDP-1", ["eDP-1", "HDMI-A-1"]);
  expect(run.view.output).toBe("HDMI-A-1");
  // The TV unplugged.
  run.presenter.place("eDP-1", ["eDP-1"]);
  expect(run.view.output).toBe("eDP-1");
  // The TV made the main display.
  run.presenter.place("HDMI-A-1", ["eDP-1", "HDMI-A-1"]);
  expect(run.view.output).toBe("HDMI-A-1");
});
