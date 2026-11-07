/**
 * Settings › Passwords, Payments: the cards agents may pay with (single-use
 * virtual cards first; their numbers stay in the vault), and the limits per
 * payment and per month, which dashi-secretd enforces and changes only with
 * the login password. Every payment still asks for the fingerprint or password.
 */

import { Switch, useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useCallback, useEffect, useState } from "react";
import { dollars, parseAmount } from "../../agents/secrets/pay.ts";
import type { CardSummary, Vault } from "../../agents/secrets/vault.ts";
import { Button, Caption, FormRow, Group, Item, Note, Spot, useSurface } from "../ui.tsx";
import { ConfirmDelete, Failure, VAULT_TROUBLE } from "./parts.tsx";

function Field({
  testID,
  value,
  placeholder,
  secure,
  width = 160,
  onChange,
}: {
  testID: string;
  value: string;
  placeholder: string;
  secure?: boolean;
  width?: number;
  onChange: (text: string) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ width }}>
      <TextInput
        testID={testID}
        value={value}
        placeholder={placeholder}
        secureTextEntry={secure === true}
        onChangeText={onChange}
        style={{ width: "100%", fontSize: 13, padding: 7, borderRadius: 7, color: colors.text, backgroundColor: surface.field }}
      />
    </View>
  );
}

function Limits({ vault }: { vault: Vault }) {
  const [spending, setSpending] = useState<{ perPayment: number; perMonth: number; spentThisMonth: number } | null>(null);
  const [form, setForm] = useState({ perPayment: "", perMonth: "", password: "" });
  const [problem, setProblem] = useState<string | null>(null);
  // A failed read says so instead of leaving the limits out without a word.
  const [unread, setUnread] = useState(false);
  const refresh = useCallback(() => {
    void vault
      .spending()
      .then((next) => {
        setSpending(next);
        setUnread(false);
      })
      .catch((error: unknown) => {
        console.error("dashi-shell: Payments:", error instanceof Error ? error.message : error);
        setSpending(null);
        setUnread(true);
      });
  }, [vault]);
  useEffect(() => refresh(), [refresh]);
  const save = () => {
    const perPayment = parseAmount(form.perPayment);
    const perMonth = parseAmount(form.perMonth);
    if (perPayment === null || perMonth === null) return setProblem("Limits are amounts in dollars, like 100.");
    void vault
      .setLimits(perPayment, perMonth, form.password)
      .then(() => {
        setForm({ perPayment: "", perMonth: "", password: "" });
        setProblem(null);
        refresh();
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  };
  if (!spending)
    return unread ? (
      <Group testID="payments-limits">
        <Note testID="payments-limits-unread">The limits can't be shown right now.</Note>
      </Group>
    ) : null;
  return (
    <Spot id="passwords/payment-limits" cards>
      <Group testID="payments-limits">
        <FormRow label="Limit per payment" detail={`Now ${dollars(spending.perPayment)}`}>
          <Field testID="payments-per-payment" value={form.perPayment} placeholder="100" onChange={(perPayment) => setForm((f) => ({ ...f, perPayment }))} />
        </FormRow>
        <FormRow label="Limit per month" detail={`Now ${dollars(spending.perMonth)}; ${dollars(spending.spentThisMonth)} spent in the last 30 days`}>
          <Field testID="payments-per-month" value={form.perMonth} placeholder="300" onChange={(perMonth) => setForm((f) => ({ ...f, perMonth }))} />
        </FormRow>
        <FormRow label="Your password" detail={problem ?? "Changing a limit needs it"}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Field
              testID="payments-password"
              value={form.password}
              placeholder="Password"
              secure
              onChange={(password) => setForm((f) => ({ ...f, password }))}
            />
            <Button testID="payments-limits-save" label="Save" primary disabled={!form.password} onPress={save} />
          </View>
        </FormRow>
      </Group>
    </Spot>
  );
}

function AddCard({ vault, onSaved }: { vault: Vault; onSaved: () => void }) {
  const empty = { label: "", number: "", expiry: "", cvc: "", singleUse: true };
  const [form, setForm] = useState(empty);
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    void vault
      .saveCard(form)
      .then(() => {
        setForm(empty);
        setProblem(null);
        onSaved();
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  };
  return (
    <Spot id="passwords/add-card" cards>
      <Group testID="payments-add">
        <FormRow label="Name">
          <Field
            testID="payments-add-label"
            value={form.label}
            placeholder="Single-use from my bank"
            width={220}
            onChange={(label) => setForm((f) => ({ ...f, label }))}
          />
        </FormRow>
        <FormRow label="Card number">
          <Field
            testID="payments-add-number"
            value={form.number}
            placeholder="Card number"
            secure
            width={220}
            onChange={(number) => setForm((f) => ({ ...f, number }))}
          />
        </FormRow>
        <FormRow label="Expiry and code" detail={problem ?? undefined}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Field testID="payments-add-expiry" value={form.expiry} placeholder="MM/YY" width={80} onChange={(expiry) => setForm((f) => ({ ...f, expiry }))} />
            <Field testID="payments-add-cvc" value={form.cvc} placeholder="Code" secure width={80} onChange={(cvc) => setForm((f) => ({ ...f, cvc }))} />
          </View>
        </FormRow>
        <FormRow label="Single use" detail="A virtual card from your bank's app, refused after one payment">
          <Switch testID="payments-add-single" on={form.singleUse} onChange={(singleUse) => setForm((f) => ({ ...f, singleUse }))} />
        </FormRow>
        <FormRow label="">
          <Button testID="payments-add-save" label="Save Card" primary disabled={!form.number || !form.expiry || !form.cvc} onPress={save} />
        </FormRow>
      </Group>
    </Spot>
  );
}

function CardRow({ card, onDelete }: { card: CardSummary; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  const name = card.label || "Card";
  const detail = asking
    ? `Delete this card ending ${card.last4}? Agents can't pay with it again, and you can't undo this.`
    : `•••• ${card.last4} · ${card.expiry}${card.singleUse ? (card.used ? " · used" : " · single use") : ""}`;
  return (
    <Item label={name} detail={detail} testID={`payments-card:${card.id}`}>
      <ConfirmDelete testID={`payments-delete:${card.id}`} onDelete={onDelete} onAsking={setAsking} />
    </Item>
  );
}

export function Payments({ vault }: { vault: Vault }) {
  const colors = useColors();
  // Null until the vault answers; a failed read says so instead of claiming there are no cards.
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void vault
      .cards()
      .then((list) => setCards(list))
      .catch((error: unknown) => {
        console.error("dashi-shell: Payments:", error instanceof Error ? error.message : error);
        setFailure(`Your cards couldn't be read. ${VAULT_TROUBLE}`);
      });
  }, [vault]);
  useEffect(() => refresh(), [refresh]);
  const remove = (card: CardSummary): void => {
    setFailure(null);
    void vault
      .removeCard(card.id)
      .catch((error: unknown) => {
        console.error("dashi-shell: Payments:", error instanceof Error ? error.message : error);
        setFailure(`“${card.label || "Card"}” wasn't deleted. ${VAULT_TROUBLE}`);
      })
      .finally(refresh);
  };
  return (
    <>
      <Spot id="passwords/cards" cards>
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Payments</Text>
        <Group testID="payments-cards">
          {cards === null ? (
            <Note testID="payments-loading">{failure ? "Cards can't be shown right now." : "Looking…"}</Note>
          ) : cards.length === 0 ? (
            <Note testID="payments-none">No cards. Agents can't pay until you add one; a single-use virtual card is safest.</Note>
          ) : (
            cards.map((card) => <CardRow key={card.id} card={card} onDelete={() => remove(card)} />)
          )}
        </Group>
      </Spot>
      {failure && <Failure testID="payments-failure">{failure}</Failure>}
      <AddCard vault={vault} onSaved={refresh} />
      <Limits vault={vault} />
      <Caption>
        Agents pay only through Dashi, within these limits, and each payment asks for your fingerprint or password. Pay for you is never kept by Always Allow.
      </Caption>
    </>
  );
}
