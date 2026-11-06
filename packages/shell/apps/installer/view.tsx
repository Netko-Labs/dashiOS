/**
 * The Installer's window: a page at a time in the Setup Assistant's frame
 * (a heading, the page, Back and Continue along the bottom). Welcome, the
 * disk, the account, the options (NVIDIA's driver), a last look, then the
 * install itself and Restart. model.ts holds the rules; helper.ts runs it.
 */

import { CHECK, ProgressBar, Row, Switch, TextField, useColors, WARNING } from "@dashi/ui";
import { ScrollView, Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { LOGO } from "../../src/glyphs.ts";
import { Button, Caption, Group, Note, useSurface } from "../../src/settings-app/ui.tsx";
import { type InstallChoice, isDryRun, runInstall, STEPS } from "./helper.ts";
import {
  type Account,
  accountProblem,
  advance,
  type FormPage,
  nextPage,
  overall,
  type Page,
  type Progress,
  previousPage,
  START,
  STEP_LABELS,
  suggestHostname,
  suggestUser,
} from "./model.ts";
import { type Disk, type Machine, probeMachine, sizeLabel } from "./probe.ts";

export const INSTALLER_SIZE = { width: 720, height: 600 };

const HEADINGS: Record<Page, { title: string; subtitle: string }> = {
  welcome: { title: "Install Dashi", subtitle: "Put Dashi on this computer. It takes about ten minutes." },
  disk: { title: "Choose a Disk", subtitle: "Dashi takes the whole disk you choose." },
  account: { title: "Create Your Account", subtitle: "You sign in with it, and it can change the system." },
  options: { title: "Drivers and Kernel", subtitle: "What Dashi sets up for this computer's hardware." },
  confirm: { title: "Ready to Install", subtitle: "Check your choices. Nothing has been changed yet." },
  installing: { title: "Installing Dashi", subtitle: "Keep the computer on and the USB drive in." },
  done: { title: "Dashi Is Installed", subtitle: "Restart and remove the USB drive to start using it." },
  failed: { title: "Dashi Wasn't Installed", subtitle: "Something went wrong. The disk may be partly erased." },
};

function Frame({ page, children, footer }: { page: Page; children: ReactNode; footer: ReactNode }) {
  const colors = useColors();
  const surface = useSurface();
  const { controls } = useWindowChrome();
  const heading = HEADINGS[page];
  return (
    <View style={{ flex: 1, flexDirection: "column", backgroundColor: surface.window }}>
      {controls && <View dragRegion style={{ height: Math.ceil(controls.y + controls.height), flexShrink: 0 }} />}
      <View style={{ flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 6, paddingTop: controls ? 4 : 22, paddingHorizontal: 56 }}>
        <Svg markup={LOGO} size={page === "welcome" ? 72 : 40} color={colors.selection} />
        <View testID="installer-title">
          <Text style={{ fontSize: page === "welcome" ? 28 : 22, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{heading.title}</Text>
        </View>
        <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>{heading.subtitle}</Text>
      </View>
      <ScrollView
        testID={`installer-page:${page}`}
        style={{ flex: 1, flexDirection: "column", gap: 14, paddingHorizontal: 56, paddingTop: 18, paddingBottom: 12 }}
      >
        {children}
      </ScrollView>
      <View
        style={{
          flexShrink: 0,
          height: 64,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          paddingHorizontal: 28,
          borderTopWidth: 1,
          borderColor: colors.separator,
        }}
      >
        {footer}
      </View>
    </View>
  );
}

function DiskRow({ disk, chosen, onChoose }: { disk: Disk; chosen: boolean; onChoose: () => void }) {
  const colors = useColors();
  const detail = disk.unavailable ?? [sizeLabel(disk.bytes), disk.removable ? "removable" : "", disk.path].filter(Boolean).join(" · ");
  return (
    <View
      testID={`installer-disk:${disk.path}`}
      onPress={disk.unavailable ? undefined : onChoose}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: chosen ? colors.selection : "transparent",
        opacity: disk.unavailable ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 1.5,
          borderColor: chosen ? colors.selection : colors.textMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {chosen && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.selection }} />}
      </View>
      <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{disk.name}</Text>
        <Text style={{ fontSize: 11, color: disk.unavailable ? colors.critical : colors.textMuted }}>{detail}</Text>
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10 }}>
      <View style={{ width: 150 }}>
        <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function StepRow({ label, mark }: { label: string; mark: "waiting" | "running" | "done" | "failed" }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 12 }}>
      <View style={{ width: 16, alignItems: "center" }}>
        {mark === "done" && <Svg markup={CHECK} size={13} color={colors.selection} />}
        {mark === "failed" && <Svg markup={WARNING} size={13} color={colors.critical} />}
        {mark === "running" && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.selection }} />}
      </View>
      <Text style={{ fontSize: 13, color: mark === "waiting" ? colors.textMuted : colors.text }}>{label}</Text>
    </View>
  );
}

function ProgressSteps({ progress }: { progress: Progress }) {
  return (
    <Group testID="installer-steps">
      {STEPS.map((step) => (
        <StepRow
          key={step}
          label={STEP_LABELS[step]}
          mark={
            progress.failed?.step === step
              ? "failed"
              : progress.done.includes(step)
                ? "done"
                : progress.step === step && progress.ok === null
                  ? "running"
                  : "waiting"
          }
        />
      ))}
    </Group>
  );
}

export function InstallerWindow({ restart }: { restart: () => void }) {
  const colors = useColors();
  const [page, setPage] = useState<Page>("welcome");
  const [machine, setMachine] = useState<Machine | null>(null);
  const [disk, setDisk] = useState<string | null>(null);
  const [account, setAccount] = useState<Account>({ fullName: "", user: "", password: "", confirm: "", hostname: "dashi" });
  // Typed by hand, the account and computer names stop following the full name.
  const named = useRef({ user: false, hostname: false });
  const [nvidia, setNvidia] = useState(false);
  const [progress, setProgress] = useState<Progress>(START);
  const dryRun = useRef(isDryRun()).current;

  useEffect(() => {
    void probeMachine().then((found) => {
      setMachine(found);
      setNvidia(found.nvidia);
      const usable = found.disks.filter((each) => !each.unavailable);
      if (usable.length === 1) setDisk(usable[0]?.path ?? null);
    });
  }, []);

  const chosen = machine?.disks.find((each) => each.path === disk) ?? null;
  const setName = (fullName: string) =>
    setAccount((was) => {
      const user = named.current.user ? was.user : suggestUser(fullName);
      return { ...was, fullName, user, hostname: named.current.hostname ? was.hostname : suggestHostname(user) };
    });

  const install = () => {
    if (!chosen) return;
    setPage("installing");
    setProgress(START);
    const choice: InstallChoice = { disk: chosen.path, user: account.user, fullName: account.fullName.trim(), hostname: account.hostname, nvidia };
    const password = account.password;
    // The password leaves the form as soon as it is on its way.
    setAccount((was) => ({ ...was, password: "", confirm: "" }));
    let latest = START;
    void runInstall(choice, password, dryRun, (event) => {
      latest = advance(latest, event);
      setProgress(latest);
    }).then((code) => {
      if (latest.ok === true && code === 0) setPage("done");
      else {
        if (!latest.failed) {
          const message = code === null ? "The installer couldn't start (pkexec or dashi-install is missing)." : "The installer stopped without saying why.";
          latest = { ...latest, failed: { step: latest.step ?? "check", message } };
          setProgress(latest);
        }
        setPage("failed");
      }
    });
  };

  const back = (from: FormPage) => <Button testID="installer-back" label="Back" onPress={() => setPage(previousPage(from))} />;
  const next = (from: FormPage, disabled = false, label = "Continue", danger = false) => (
    <Button
      testID="installer-continue"
      label={label}
      primary={!danger}
      danger={danger}
      disabled={disabled}
      onPress={() => (from === "confirm" ? install() : setPage(nextPage(from)))}
    />
  );

  switch (page) {
    case "welcome": {
      const blocked = machine !== null && !machine.uefi;
      return (
        <Frame page={page} footer={next("welcome", machine === null || blocked)}>
          {blocked ? (
            <Note testID="installer-no-uefi">
              This computer started without UEFI. Dashi's installer needs it: turn off Legacy or CSM boot in the firmware settings and start from the USB drive
              again.
            </Note>
          ) : (
            <Note>Dashi erases the disk you choose and puts a fresh system on it, with your account. Your other disks are left alone.</Note>
          )}
          {dryRun && <Caption>This is a practice run: the computer didn't start from the Dashi USB drive, so nothing will be erased.</Caption>}
        </Frame>
      );
    }
    case "disk":
      return (
        <Frame page={page} footer={[back("disk"), next("disk", !chosen)]}>
          <Group testID="installer-disks">
            {machine?.disks.length ? (
              machine.disks.map((each) => <DiskRow key={each.path} disk={each} chosen={each.path === disk} onChoose={() => setDisk(each.path)} />)
            ) : (
              <Note>No disks were found.</Note>
            )}
          </Group>
          <Caption>Everything on the chosen disk is erased: other systems, files, and partitions.</Caption>
        </Frame>
      );
    case "account": {
      const problem = accountProblem(account);
      const typed = account.fullName !== "" || account.password !== "";
      return (
        <Frame page={page} footer={[back("account"), next("account", problem !== null)]}>
          <Group testID="installer-account">
            <Field label="Full name">
              <TextField testID="installer-full-name" value={account.fullName} autoFocus placeholder="Your name" onChangeText={setName} />
            </Field>
            <Field label="Account name">
              <TextField
                testID="installer-user"
                value={account.user}
                onChangeText={(user) => {
                  named.current.user = true;
                  setAccount((was) => ({ ...was, user, hostname: named.current.hostname ? was.hostname : suggestHostname(user) }));
                }}
              />
            </Field>
            <Field label="Password">
              <TextField testID="installer-password" value={account.password} secure onChangeText={(password) => setAccount((was) => ({ ...was, password }))} />
            </Field>
            <Field label="Confirm password">
              <TextField testID="installer-confirm" value={account.confirm} secure onChangeText={(confirm) => setAccount((was) => ({ ...was, confirm }))} />
            </Field>
            <Field label="Computer name">
              <TextField
                testID="installer-hostname"
                value={account.hostname}
                onChangeText={(hostname) => {
                  named.current.hostname = true;
                  setAccount((was) => ({ ...was, hostname }));
                }}
              />
            </Field>
          </Group>
          {typed && problem && (
            <View testID="installer-account-problem">
              <Text style={{ fontSize: 12, color: colors.critical }}>{problem}</Text>
            </View>
          )}
        </Frame>
      );
    }
    case "options":
      return (
        <Frame page={page} footer={[back("options"), next("options")]}>
          <Group>
            <Row
              label="Install NVIDIA's graphics driver"
              detail={
                machine?.nvidia
                  ? "This computer has NVIDIA graphics. The driver is built during the install, so Dashi starts on it."
                  : "No NVIDIA graphics were found. Turn this on only for a card you will add."
              }
            >
              <Switch testID="installer-nvidia" on={nvidia} onChange={setNvidia} />
            </Row>
            <Row
              label={machine?.cachyos ? "CachyOS kernel" : "Fedora kernel"}
              detail={
                machine?.cachyos
                  ? "Tuned for responsiveness and games. It will be the only kernel on this computer."
                  : "CachyOS's kernel can't start this computer (Secure Boot is on, or the processor is older), so Fedora's is the default."
              }
            />
          </Group>
        </Frame>
      );
    case "confirm":
      return (
        <Frame page={page} footer={[back("confirm"), next("confirm", !chosen, "Erase and Install", true)]}>
          <Group testID="installer-summary">
            <Row label="Disk" detail={chosen ? `${chosen.name} · ${sizeLabel(chosen.bytes)} · ${chosen.path}` : "None"} />
            <Row label="Account" detail={`${account.fullName.trim()} (${account.user})`} />
            <Row label="Computer name" detail={account.hostname} />
            <Row label="NVIDIA driver" detail={nvidia ? "Installed" : "Not installed"} />
          </Group>
          <Caption>{`Everything on ${chosen?.name ?? "the disk"} will be erased. This can't be undone.`}</Caption>
        </Frame>
      );
    case "installing":
      return (
        <Frame page={page} footer={null}>
          <ProgressBar testID="installer-bar" size="regular" value={overall(progress)} />
          <ProgressSteps progress={progress} />
        </Frame>
      );
    case "done":
      return (
        <Frame page={page} footer={<Button testID="installer-restart" label="Restart" primary onPress={restart} />}>
          <ProgressSteps progress={progress} />
          {dryRun && <Caption>A practice run: nothing was installed, and Restart only closes this window.</Caption>}
        </Frame>
      );
    case "failed":
      return (
        <Frame page={page} footer={<Button testID="installer-retry" label="Start Over" primary onPress={() => setPage("welcome")} />}>
          <ProgressSteps progress={progress} />
          <View testID="installer-failure" style={{ flexShrink: 0 }}>
            <Text style={{ fontSize: 12, color: colors.critical }}>{progress.failed?.message ?? "The install stopped."}</Text>
          </View>
          {!dryRun && <Caption>What the installer's tools said is in /var/log/dashi-install.log.</Caption>}
        </Frame>
      );
  }
}
