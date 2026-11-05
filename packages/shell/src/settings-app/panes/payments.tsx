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
import { Button, Caption, Group, Note, Row, useSurface } from "../ui.tsx";

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
  const refresh = useCallback(() => {
    void vault
      .spending()
      .then(setSpending)
      .catch(() => setSpending(null));
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
  if (!spending) return null;
  return (
    <Group testID="payments-limits">
      <Row label="Limit per payment" detail={`Now ${dollars(spending.perPayment)}`}>
        <Field testID="payments-per-payment" value={form.perPayment} placeholder="100" onChange={(perPayment) => setForm((f) => ({ ...f, perPayment }))} />
      </Row>
      <Row label="Limit per month" detail={`Now ${dollars(spending.perMonth)}; ${dollars(spending.spentThisMonth)} spent in the last 30 days`}>
        <Field testID="payments-per-month" value={form.perMonth} placeholder="300" onChange={(perMonth) => setForm((f) => ({ ...f, perMonth }))} />
      </Row>
      <Row label="Your password" detail={problem ?? "Changing a limit needs it"}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Field testID="payments-password" value={form.password} placeholder="Password" secure onChange={(password) => setForm((f) => ({ ...f, password }))} />
          <Button testID="payments-limits-save" label="Save" primary disabled={!form.password} onPress={save} />
        </View>
      </Row>
    </Group>
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
    <Group testID="payments-add">
      <Row label="Name">
        <Field
          testID="payments-add-label"
          value={form.label}
          placeholder="Single-use from my bank"
          width={220}
          onChange={(label) => setForm((f) => ({ ...f, label }))}
        />
      </Row>
      <Row label="Card number">
        <Field
          testID="payments-add-number"
          value={form.number}
          placeholder="Card number"
          secure
          width={220}
          onChange={(number) => setForm((f) => ({ ...f, number }))}
        />
      </Row>
      <Row label="Expiry and code" detail={problem ?? undefined}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Field testID="payments-add-expiry" value={form.expiry} placeholder="MM/YY" width={80} onChange={(expiry) => setForm((f) => ({ ...f, expiry }))} />
          <Field testID="payments-add-cvc" value={form.cvc} placeholder="Code" secure width={80} onChange={(cvc) => setForm((f) => ({ ...f, cvc }))} />
        </View>
      </Row>
      <Row label="Single use" detail="A virtual card from your bank's app, refused after one payment">
        <Switch testID="payments-add-single" on={form.singleUse} onChange={(singleUse) => setForm((f) => ({ ...f, singleUse }))} />
      </Row>
      <Row label="">
        <Button testID="payments-add-save" label="Save Card" primary disabled={!form.number || !form.expiry || !form.cvc} onPress={save} />
      </Row>
    </Group>
  );
}

export function Payments({ vault }: { vault: Vault }) {
  const colors = useColors();
  const [cards, setCards] = useState<CardSummary[]>([]);
  const refresh = useCallback(() => {
    void vault
      .cards()
      .then(setCards)
      .catch(() => setCards([]));
  }, [vault]);
  useEffect(() => refresh(), [refresh]);
  return (
    <>
      <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Payments</Text>
      <Group testID="payments-cards">
        {cards.length === 0 ? (
          <Note testID="payments-none">No cards. Agents can't pay until you add one; a single-use virtual card is safest.</Note>
        ) : (
          cards.map((card) => (
            <Row
              key={card.id}
              label={card.label || "Card"}
              detail={`•••• ${card.last4} · ${card.expiry}${card.singleUse ? (card.used ? " · used" : " · single use") : ""}`}
            >
              <Button testID={`payments-delete:${card.id}`} label="Delete" danger onPress={() => void vault.removeCard(card.id).then(refresh)} />
            </Row>
          ))
        )}
      </Group>
      <AddCard vault={vault} onSaved={refresh} />
      <Limits vault={vault} />
      <Caption>
        Agents pay only through Dashi, within these limits, and each payment asks for your fingerprint or password. Pay for you is never kept by Always Allow.
      </Caption>
    </>
  );
}
