/** `listen.stop`'s reply, as dictation reads it (docs/voice.md). */

import { obj, str } from "@dashi/shape";

export const HeardText = obj({ text: str() }, { strict: false });
