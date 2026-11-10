/**
 * The Installer's window: a page at a time in the Setup Assistant's frame
 * (a heading, the page, Back and Continue along the bottom). Welcome, the
 * disk, the account, the options (NVIDIA's driver), a last look, then the
 * install itself and Restart. model.ts holds the rules; helper.ts runs it;
 * use-installer.ts is the wizard's state; rows.tsx and headings.ts are the
 * parts the pages use. The pages live here because they and the frame use the
 * Settings kit (src/settings-app/ui.tsx), which only this file may import
 * (import-ways).
 */

import { LOGO, ProgressBar, Row, Switch, TextField, useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { Button, Caption, Group, Note, useSurface } from "../../../src/settings-app/ui.tsx";
import { HEADINGS } from "./headings.ts";
import { STEPS } from "./helper.ts";
import { accountProblem, type FormPage, nextPage, overall, type Page, type Progress, previousPage, STEP_LABELS } from "./model.ts";
import { sizeLabel } from "./probe.ts";
import { DiskRow, Field, StepRow } from "./rows.tsx";
import { useInstaller, type Wizard } from "./use-installer.ts";

export const INSTALLER_SIZE = { width: 720, height: 600 };

/** A line under a card starts where Settings' captions do (`Caption`), 10 in from the card's edge. */
const CAPTION_INSET = 10;

interface PageProps {
  wizard: Wizard;
}

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

function backButton(wizard: Wizard, from: FormPage) {
  return <Button testID="installer-back" label="Back" onPress={() => wizard.setPage(previousPage(from))} />;
}

function continueButton(wizard: Wizard, from: FormPage, disabled = false, label = "Continue", danger = false) {
  return (
    <Button
      testID="installer-continue"
      label={label}
      primary={!danger}
      danger={danger}
      disabled={disabled}
      onPress={() => (from === "confirm" ? wizard.install() : wizard.setPage(nextPage(from)))}
    />
  );
}

function WelcomePage({ wizard }: PageProps) {
  const { machine, dryRun } = wizard;
  const blocked = machine !== null && !machine.uefi;
  return (
    <Frame page="welcome" footer={continueButton(wizard, "welcome", machine === null || blocked)}>
      {blocked ? (
        <Note testID="installer-no-uefi">
          This computer started without UEFI. Dashi's installer needs it: turn off Legacy or CSM boot in the firmware settings and start from the USB drive
          again.
        </Note>
      ) : (
        <Note>Dashi erases the disk you choose and puts a fresh system on it, with your account. Your other disks are left alone.</Note>
      )}
      {/* Centred, as the welcome's other words are. */}
      {dryRun && <Note>This is a practice run: the computer didn't start from the Dashi USB drive, so nothing will be erased.</Note>}
    </Frame>
  );
}

function DiskPage({ wizard }: PageProps) {
  const { machine, disk, chosen } = wizard;
  return (
    <Frame page="disk" footer={[backButton(wizard, "disk"), continueButton(wizard, "disk", !chosen)]}>
      <Group testID="installer-disks">
        {machine?.disks.length ? (
          machine.disks.map((each) => <DiskRow key={each.path} disk={each} chosen={each.path === disk} onChoose={() => wizard.setDisk(each.path)} />)
        ) : (
          <Note>No disks were found.</Note>
        )}
      </Group>
      <Caption>Everything on the chosen disk is erased: other systems, files, and partitions.</Caption>
    </Frame>
  );
}

function AccountPage({ wizard }: PageProps) {
  const colors = useColors();
  const { account } = wizard;
  const problem = accountProblem(account);
  const typed = account.fullName !== "" || account.password !== "";
  return (
    <Frame page="account" footer={[backButton(wizard, "account"), continueButton(wizard, "account", problem !== null)]}>
      <Group testID="installer-account">
        <Field label="Full name">
          <TextField testID="installer-full-name" value={account.fullName} autoFocus placeholder="Your name" onChangeText={wizard.setName} />
        </Field>
        <Field label="Account name">
          <TextField testID="installer-user" value={account.user} onChangeText={wizard.setUser} />
        </Field>
        <Field label="Password">
          <TextField testID="installer-password" value={account.password} secure onChangeText={(password) => wizard.edit({ password })} />
        </Field>
        <Field label="Confirm password">
          <TextField testID="installer-confirm" value={account.confirm} secure onChangeText={(confirm) => wizard.edit({ confirm })} />
        </Field>
        <Field label="Computer name">
          <TextField testID="installer-hostname" value={account.hostname} onChangeText={wizard.setHostname} />
        </Field>
      </Group>
      {typed && problem && (
        <View testID="installer-account-problem" style={{ paddingLeft: CAPTION_INSET, paddingRight: CAPTION_INSET }}>
          <Text style={{ fontSize: 12, color: colors.critical }}>{problem}</Text>
        </View>
      )}
    </Frame>
  );
}

function OptionsPage({ wizard }: PageProps) {
  const { machine, nvidia } = wizard;
  return (
    <Frame page="options" footer={[backButton(wizard, "options"), continueButton(wizard, "options")]}>
      <Group>
        <Row
          label="Install NVIDIA's graphics driver"
          detail={
            machine?.nvidia
              ? "This computer has NVIDIA graphics. The driver is built during the install, so Dashi starts on it."
              : "No NVIDIA graphics were found. Turn this on only for a card you will add."
          }
        >
          <Switch testID="installer-nvidia" on={nvidia} onChange={wizard.setNvidia} />
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
}

function ConfirmPage({ wizard }: PageProps) {
  const { chosen, account, nvidia } = wizard;
  return (
    <Frame page="confirm" footer={[backButton(wizard, "confirm"), continueButton(wizard, "confirm", !chosen, "Erase and Install", true)]}>
      <Group testID="installer-summary">
        <Row label="Disk" detail={chosen ? `${chosen.name} · ${sizeLabel(chosen.bytes)} · ${chosen.path}` : "None"} />
        <Row label="Account" detail={`${account.fullName.trim()} (${account.user})`} />
        <Row label="Computer name" detail={account.hostname} />
        <Row label="NVIDIA driver" detail={nvidia ? "Installed" : "Not installed"} />
      </Group>
      <Caption>{`Everything on ${chosen?.name ?? "the disk"} will be erased. This can't be undone.`}</Caption>
    </Frame>
  );
}

function InstallingPage({ wizard }: PageProps) {
  const { progress } = wizard;
  return (
    <Frame page="installing" footer={null}>
      <ProgressBar testID="installer-bar" size="regular" value={overall(progress)} />
      <ProgressSteps progress={progress} />
    </Frame>
  );
}

function DonePage({ wizard, restart }: PageProps & { restart: () => void }) {
  const { progress, dryRun } = wizard;
  return (
    <Frame page="done" footer={<Button testID="installer-restart" label="Restart" primary onPress={restart} />}>
      <ProgressSteps progress={progress} />
      {dryRun && <Caption>A practice run: nothing was installed, and Restart only closes this window.</Caption>}
    </Frame>
  );
}

function FailedPage({ wizard }: PageProps) {
  const colors = useColors();
  const { progress, dryRun } = wizard;
  return (
    <Frame page="failed" footer={<Button testID="installer-retry" label="Start Over" primary onPress={() => wizard.setPage("welcome")} />}>
      <ProgressSteps progress={progress} />
      <View testID="installer-failure" style={{ flexShrink: 0, paddingLeft: CAPTION_INSET, paddingRight: CAPTION_INSET }}>
        <Text style={{ fontSize: 12, color: colors.critical }}>{progress.failed?.message ?? "The install stopped."}</Text>
      </View>
      {!dryRun && <Caption>What the installer's tools said is in /var/log/dashi-install.log.</Caption>}
    </Frame>
  );
}

export function InstallerWindow({ restart }: { restart: () => void }) {
  const wizard = useInstaller();
  switch (wizard.page) {
    case "welcome":
      return <WelcomePage wizard={wizard} />;
    case "disk":
      return <DiskPage wizard={wizard} />;
    case "account":
      return <AccountPage wizard={wizard} />;
    case "options":
      return <OptionsPage wizard={wizard} />;
    case "confirm":
      return <ConfirmPage wizard={wizard} />;
    case "installing":
      return <InstallingPage wizard={wizard} />;
    case "done":
      return <DonePage wizard={wizard} restart={restart} />;
    case "failed":
      return <FailedPage wizard={wizard} />;
  }
}
