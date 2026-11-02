import { CHECK, useColors, WARNING } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { Button, Group } from "../../settings-app/ui.tsx";
import type { SetupContext } from "../context.ts";
import { STEP_LABELS } from "../extras/plan.ts";
import { appLine, runNotice, stepLine } from "../extras/words.ts";

type Mark = "waiting" | "running" | "done" | "failed";

/** A thin bar of `fraction`; the step's words say what it is doing. */
function Bar({ fraction }: { fraction: number }) {
  const colors = useColors();
  const width = 120;
  return (
    <View style={{ width, height: 4, borderRadius: 2, backgroundColor: colors.track, overflow: "hidden" }}>
      <View style={{ width: Math.max(4, Math.round(width * fraction)), height: 4, borderRadius: 2, backgroundColor: colors.selection }} />
    </View>
  );
}

function StatusRow({ testID, label, line, mark, fraction }: { testID: string; label: string; line: string; mark: Mark; fraction: number | null }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
      <View style={{ width: 16, alignItems: "center" }}>
        {mark === "done" && <Svg markup={CHECK} size={13} color={colors.selection} />}
        {mark === "failed" && <Svg markup={WARNING} size={13} color={colors.critical} />}
        {mark === "running" && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.selection }} />}
      </View>
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
        <Text style={{ fontSize: 11, color: mark === "failed" ? colors.critical : colors.textMuted }}>{line}</Text>
      </View>
      {mark === "running" && fraction !== null && <Bar fraction={fraction} />}
    </View>
  );
}

/** Each step and each app with where it is, then what went wrong (if anything) and the way to try again. */
export function InstallingPage({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  const { run } = useSyncExternalStore(ctx.extras.subscribe, ctx.extras.getSnapshot);
  const notice = runNotice(run);
  return (
    <>
      {run.steps.length > 0 && (
        <Group testID="setup-installing-steps">
          {run.steps.map((step) => {
            const state = run.states[step];
            return (
              <StatusRow
                key={step}
                testID={`setup-step:${step}`}
                label={STEP_LABELS[step]}
                line={stepLine(state)}
                mark={state?.status ?? "waiting"}
                fraction={state?.status === "running" ? state.fraction : null}
              />
            );
          })}
        </Group>
      )}
      {run.apps.length > 0 && (
        <Group testID="setup-installing-apps">
          {run.apps.map(({ app, state }) => (
            <StatusRow
              key={app.id}
              testID={`setup-install-app:${app.id}`}
              label={app.name}
              line={appLine(state)}
              mark={state.status === "installing" ? "running" : state.status === "skipped" ? "waiting" : state.status}
              fraction={state.status === "installing" ? (state.progress?.fraction ?? null) : null}
            />
          ))}
        </Group>
      )}
      {notice && (
        <View testID="setup-installing-notice" style={{ flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 10, paddingTop: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{notice.message}</Text>
          {notice.action && (
            <Button testID="setup-installing-retry" label={notice.action === "retry" ? "Retry" : "Try again"} onPress={() => void ctx.extras.retry()} />
          )}
        </View>
      )}
    </>
  );
}
