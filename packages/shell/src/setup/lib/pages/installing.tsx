import { Button, CHECK, Group, ProgressBar, RADIUS, SPACE, TYPE, useColors, WARNING } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { SetupContext } from "../context.ts";
import { STEP_LABELS } from "../extras/plan.ts";
import { appLine, runNotice, stepLine } from "../extras/words.ts";

type Mark = "waiting" | "running" | "done" | "failed";

function StatusRow({ testID, label, line, mark, fraction }: { testID: string; label: string; line: string; mark: Mark; fraction: number | null }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, padding: SPACE.inset }}>
      <View style={{ width: 16, alignItems: "center" }}>
        {mark === "done" && <Svg markup={CHECK} size={13} color={colors.moss} />}
        {mark === "failed" && <Svg markup={WARNING} size={13} color={colors.critical} />}
        {mark === "running" && <View style={{ width: 7, height: 7, borderRadius: RADIUS.check, backgroundColor: colors.textMuted }} />}
      </View>
      <View style={{ flex: 1, flexDirection: "column", gap: SPACE.xxs, minWidth: 0 }}>
        <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>{label}</Text>
        <Text style={{ fontSize: TYPE.caption.size, color: mark === "failed" ? colors.critical : colors.textMuted }}>{line}</Text>
      </View>
      {mark === "running" && fraction !== null && <ProgressBar value={fraction} width={120} />}
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
        <View testID="setup-installing-notice" style={{ flexShrink: 0, flexDirection: "column", alignItems: "center", gap: SPACE.gap, paddingTop: SPACE.xs }}>
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted, textAlign: "center" }}>{notice.message}</Text>
          {notice.action && (
            <Button testID="setup-installing-retry" label={notice.action === "retry" ? "Retry" : "Try again"} onPress={() => void ctx.extras.retry()} />
          )}
        </View>
      )}
    </>
  );
}
