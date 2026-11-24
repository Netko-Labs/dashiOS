/**
 * The Installer's window: a page at a time in the Setup Assistant's frame
 * (the mark in ink, a 20 Bold sentence-case title, the page, and Back and
 * Continue on the window's ground at the content's foot: no footer bar,
 * VS-3). Welcome, the disk, the account, the options (NVIDIA's driver), a
 * last look, then the install itself and Restart. model.ts holds the rules;
 * helper.ts runs it; use-installer.ts is the wizard's state; rows.tsx and
 * headings.ts are the parts the pages use. Everything is the panel look
 * (TK-2): Settings' cards (src/shared/cards) and the kit's panel controls.
 */

import { LOGO, ProgressBar, SPACE, Switch, TextField, TYPE, useColors, useControlColors, WEIGHT, WIZARD_PAGE } from "@dashi/ui";
import { ScrollView, Svg, Text, useWindowChrome, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { Button, Caption, Group, Note, useSurface } from "../../../src/shared/cards/index.ts";
import { HEADINGS } from "./headings.ts";
import { STEPS } from "./helper.ts";
import { accountProblem, type FormPage, nextPage, overall, type Page, type Progress, previousPage, STEP_LABELS } from "./model.ts";
import { sizeLabel } from "./probe.ts";
import { DiskList, FormRow, InfoRow, StepRow } from "./rows.tsx";
import { useInstaller, type Wizard } from "./use-installer.ts";

export const INSTALLER_SIZE = { width: 720, height: 600 };
/** The least size (LA-3): the account rows' label column and a field beside it, and the head, a card and the buttons in height. */
export const INSTALLER_LEAST = { width: 600, height: 480 };

/**
 * The frame's measures: the mark on the welcome and on the other pages, and
 * the room above the head without window controls.
 * A line under a card starts where Settings' captions do (`Caption`), 10 in.
 */
/** The page's sides: the kit's wizard inset. */
const SIDE = WIZARD_PAGE.inset;
const FRAME = { mark: 72, smallMark: 40, top: SPACE.sheet, caption: SPACE.gap } as const;

interface PageProps {
  wizard: Wizard;
}

function Frame({ page, children, footer }: { page: Page; children: ReactNode; footer: ReactNode }) {
  const colors = useColors();
  const panel = useControlColors();
  const surface = useSurface();
  const { controls } = useWindowChrome();
  const heading = HEADINGS[page];
  return (
    <View style={{ flex: 1, flexDirection: "column", backgroundColor: surface.window }}>
      {controls && <View dragRegion style={{ height: Math.ceil(controls.y + controls.height), flexShrink: 0 }} />}
      <View
        style={{
          flexShrink: 0,
          flexDirection: "column",
          alignItems: "center",
          gap: SPACE.s,
          paddingTop: controls ? SPACE.xs : FRAME.top,
          paddingHorizontal: SIDE,
        }}
      >
        {/* The mark in ink: a logo never wears the accent (CO-2). */}
        <Svg markup={LOGO} size={page === "welcome" ? FRAME.mark : FRAME.smallMark} color={colors.text} />
        <View testID="installer-title">
          <Text style={{ fontSize: TYPE.title.size, lineHeight: TYPE.title.line, fontWeight: WEIGHT.bold, color: colors.text, textAlign: "center" }}>
            {heading.title}
          </Text>
        </View>
        <Text style={{ fontSize: TYPE.panel.body.size, lineHeight: TYPE.panel.body.line, color: panel.muted, textAlign: "center" }}>{heading.subtitle}</Text>
      </View>
      <ScrollView
        testID={`installer-page:${page}`}
        style={{ flex: 1, flexDirection: "column", gap: SPACE.button, paddingHorizontal: SIDE, paddingTop: SPACE.sheet, paddingBottom: SPACE.inset }}
      >
        {children}
      </ScrollView>
      {/* The buttons on the window's ground, no bar or hairline over them (VS-3). */}
      <View
        testID="installer-buttons"
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: SPACE.m,
          paddingHorizontal: SIDE,
          paddingTop: SPACE.inset,
          paddingBottom: SPACE.xl,
        }}
      >
        {footer}
      </View>
    </View>
  );
}

function Problem({ testID, children }: { testID: string; children: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, paddingHorizontal: FRAME.caption }}>
      <Text style={{ fontSize: TYPE.panel.detail.size, lineHeight: TYPE.panel.detail.line, color: colors.critical }}>{children}</Text>
    </View>
  );
}

function ProgressSteps({ progress }: { progress: Progress }) {
  return (
    <Group testID="installer-steps">
      {STEPS.map((step) => (
        <StepRow
          key={step}
          testID={`installer-step:${step}`}
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
          This computer started without UEFI. Dashi’s installer needs it: turn off Legacy or CSM boot in the firmware settings and start from the USB drive
          again.
        </Note>
      ) : (
        <Note>Dashi erases the disk you choose and puts a fresh system on it, with your account. Your other disks are left alone.</Note>
      )}
      {/* Centred, as the welcome's other words are. */}
      {dryRun && <Note>This is a practice run: the computer didn’t start from the Dashi USB drive, so nothing will be erased.</Note>}
    </Frame>
  );
}

function DiskPage({ wizard }: PageProps) {
  const { machine, disk, chosen } = wizard;
  return (
    <Frame page="disk" footer={[backButton(wizard, "disk"), continueButton(wizard, "disk", !chosen)]}>
      <Group testID="installer-disks">
        {machine?.disks.length ? <DiskList disks={machine.disks} chosen={disk} onChoose={wizard.setDisk} /> : <Note>No disks were found.</Note>}
      </Group>
      <Caption>Everything on the chosen disk is erased: other systems, files, and partitions.</Caption>
    </Frame>
  );
}

function AccountPage({ wizard }: PageProps) {
  const { account } = wizard;
  const problem = accountProblem(account);
  const typed = account.fullName !== "" || account.password !== "";
  return (
    <Frame page="account" footer={[backButton(wizard, "account"), continueButton(wizard, "account", problem !== null)]}>
      <Group testID="installer-account">
        <FormRow label="Full name">
          <TextField look="panel" testID="installer-full-name" value={account.fullName} autoFocus placeholder="Your name" onChangeText={wizard.setName} />
        </FormRow>
        <FormRow label="Account name">
          <TextField look="panel" testID="installer-user" value={account.user} onChangeText={wizard.setUser} />
        </FormRow>
        <FormRow label="Password">
          <TextField look="panel" testID="installer-password" value={account.password} secure onChangeText={(password) => wizard.edit({ password })} />
        </FormRow>
        <FormRow label="Confirm password">
          <TextField look="panel" testID="installer-confirm" value={account.confirm} secure onChangeText={(confirm) => wizard.edit({ confirm })} />
        </FormRow>
        <FormRow label="Computer name">
          <TextField look="panel" testID="installer-hostname" value={account.hostname} onChangeText={wizard.setHostname} />
        </FormRow>
      </Group>
      {typed && problem && <Problem testID="installer-account-problem">{problem}</Problem>}
    </Frame>
  );
}

function OptionsPage({ wizard }: PageProps) {
  const { machine, nvidia } = wizard;
  return (
    <Frame page="options" footer={[backButton(wizard, "options"), continueButton(wizard, "options")]}>
      <Group>
        <InfoRow
          label="Install NVIDIA’s graphics driver"
          detail={
            machine?.nvidia
              ? "This computer has NVIDIA graphics. The driver is built during the install, so Dashi starts on it."
              : "No NVIDIA graphics were found. Turn this on only for a card you will add."
          }
        >
          <Switch look="panel" testID="installer-nvidia" on={nvidia} onChange={wizard.setNvidia} />
        </InfoRow>
        <InfoRow
          label={machine?.cachyos ? "CachyOS kernel" : "Fedora kernel"}
          detail={
            machine?.cachyos
              ? "Tuned for responsiveness and games. It will be the only kernel on this computer."
              : "CachyOS’s kernel can’t start this computer (Secure Boot is on, or the processor is older), so Fedora’s is the default."
          }
        />
      </Group>
    </Frame>
  );
}

function ConfirmPage({ wizard }: PageProps) {
  const { chosen, account, nvidia } = wizard;
  return (
    <Frame page="confirm" footer={[backButton(wizard, "confirm"), continueButton(wizard, "confirm", !chosen, "Erase and install", true)]}>
      <Group testID="installer-summary">
        <InfoRow label="Disk" detail={chosen ? `${chosen.name} · ${sizeLabel(chosen.bytes)} · ${chosen.path}` : "None"} />
        <InfoRow label="Account" detail={`${account.fullName.trim()} (${account.user})`} />
        <InfoRow label="Computer name" detail={account.hostname} />
        <InfoRow label="NVIDIA driver" detail={nvidia ? "Installed" : "Not installed"} />
      </Group>
      <Caption>{`Everything on ${chosen?.name ?? "the disk"} will be erased. This can’t be undone.`}</Caption>
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
  const { progress, dryRun } = wizard;
  return (
    <Frame page="failed" footer={<Button testID="installer-retry" label="Start over" primary onPress={() => wizard.setPage("welcome")} />}>
      <ProgressSteps progress={progress} />
      <Problem testID="installer-failure">{progress.failed?.message ?? "The install stopped."}</Problem>
      {!dryRun && <Caption>What the installer’s tools said is in /var/log/dashi-install.log.</Caption>}
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
