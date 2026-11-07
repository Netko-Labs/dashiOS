/**
 * The pills in the menu bar, left of the status items: "Screen is being
 * shared", each connected agent, then the recording's stop button. The stop
 * button is the last, beside the status items, so it stays put while the
 * agents' pills come and go to its left (an agent's pill shows while it is
 * connected, often just for one call): with it first, a pill going shifted
 * it from under the pointer, and the click found nothing.
 */

import type { AgentInfo } from "./agents/index.ts";
import { AgentPill } from "./consent.tsx";
import { RecordingButton } from "./recorder/indicator.tsx";
import type { ScreenRecorder } from "./recorder/recorder.ts";
import type { ScreenCaptureStore } from "./screen-capture.ts";
import { CapturePill } from "./screen-capture.tsx";

export function BarPills({
  capture,
  recorder,
  agents,
  onStopAgent,
}: {
  capture: ScreenCaptureStore;
  recorder?: ScreenRecorder;
  agents: readonly AgentInfo[];
  onStopAgent: (id: number) => void;
}) {
  return (
    // A fragment: the bar's row spaces them, and leaves no gap when there are none.
    <>
      <CapturePill store={capture} {...(recorder ? { recorder } : {})} />
      {agents.map((agent) => (
        <AgentPill key={agent.id} agent={agent} onStop={() => onStopAgent(agent.id)} />
      ))}
      {recorder ? <RecordingButton recorder={recorder} /> : null}
    </>
  );
}
