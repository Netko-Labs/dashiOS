import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { LocalePickers } from "../../region/pickers.tsx";
import { describeFailure, useRegion } from "../../region/store.ts";
import { useSettings } from "../../settings-app/hooks.ts";
import type { SetupContext } from "../context.ts";

/** Language (the system's, through localed) and region formats (this person's), applied the moment they are picked. */
export function LanguagePage({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  const state = useRegion(ctx.region);
  const { region } = useSettings(ctx.settings).data;
  return (
    <>
      <LocalePickers
        locales={state.locales}
        language={state.language}
        formats={region.formats}
        height={236}
        onLanguage={(locale) => void ctx.region.setLanguage(locale)}
        onFormats={(formats) => ctx.settings.patch("region", { formats })}
      />
      <View testID="setup-language-note" style={{ flexShrink: 0 }}>
        <Text style={{ fontSize: 11, color: state.error ? colors.critical : colors.textMuted }}>
          {state.error
            ? describeFailure(state.error)
            : state.busy === "language"
              ? "Changing the language. If a password sheet appears, enter your password there."
              : "Choosing a language asks for your password. It applies to apps you open after you log in again."}
        </Text>
      </View>
    </>
  );
}
