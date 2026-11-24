/** The gallery's login page: the one clock (TY-1, D670) and the login screen's parts, in the lock's look per mode (D671). */

import { ClockHead, LoginBackLink, LoginChip, LoginPerson, loginColors, SPACE, useDark } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { Exhibit, PageBody } from "../specimen.tsx";

const noop = (): void => {};

/** The login screen's ground for the column's mode: Dark's always on the login screen, the mode's on the lock. */
function LoginGround({ children }: { children: (mode: "light" | "dark") => ReactNode }) {
  const mode = useDark() ? "dark" : "light";
  return (
    <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.gap, padding: SPACE.page, backgroundColor: loginColors(mode).ground }}>
      {children(mode)}
    </View>
  );
}

export function LoginPage() {
  return (
    <PageBody>
      <Exhibit
        title="The clock"
        note="The lock screen's, the login screen's and Glance's: 120, hours over minutes, Inter Display ExtraLight where the host draws it; the day over it in upper case (TY-1)."
      >
        <LoginGround>{(mode) => <ClockHead day="Sunday, November 15" time="14:02" ink={loginColors(mode).ink} display={false} />}</LoginGround>
      </Exhibit>
      <Exhibit
        title="The login screen's parts"
        note="Back to everyone, with a drawn chevron; the session as a chip; a person to pick. The lock takes the mode's look, the login screen Dark's."
      >
        <LoginGround>
          {(mode) => (
            <>
              <LoginBackLink testID={`login:back:${mode}`} label="Other users" onPress={noop} colors={loginColors(mode)} />
              <LoginChip testID={`login:session:${mode}`} label="Dashi" accessibilityLabel="Session: Dashi" onPress={noop} colors={loginColors(mode)} />
              <LoginPerson testID={`login:person:${mode}`} name="Alex Kim" onPress={noop} colors={loginColors(mode)} />
            </>
          )}
        </LoginGround>
      </Exhibit>
    </PageBody>
  );
}
