/** A dialog's prompt (`--text`): body words in ink over what the dialog asks for; nothing when there is none. */

import { TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";

export function Prompt({ text }: { text: string }) {
  const colors = useColors();
  if (text === "") return null;
  return (
    <View testID="dialog:text" style={{ flexShrink: 0 }}>
      <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, color: colors.text }}>{text}</Text>
    </View>
  );
}
