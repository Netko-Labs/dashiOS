//! Payments (docs/secrets.md, "Payments"): cards kept in the vault, limits
//! per payment and per month (the last 30 days) enforced here, where an agent
//! can't reach them, and each payment asked of the person with proof. A
//! single-use card is refused once used. The card's number goes only to the
//! broker that types it, and only after the person said yes.

use serde_json::json;

use super::{protocol::Request, reply::Reply};
use crate::vault::{
    Vault,
    bytes::Secret,
    item::{Card, Payment, Spending},
};

const MONTH: u64 = 30 * 86_400;
const MAX_CARDS: usize = 100;
/// No single payment above this, whatever the limits say ($10,000).
pub const CEILING: u64 = 1_000_000;

fn digits(secret: &Secret, min: usize, max: usize) -> bool {
    let bytes = secret.expose();
    (min..=max).contains(&bytes.len()) && bytes.iter().all(u8::is_ascii_digit)
}

fn luhn(number: &[u8]) -> bool {
    let sum: u32 = number
        .iter()
        .rev()
        .enumerate()
        .map(|(i, d)| {
            let d = u32::from(d - b'0');
            if i % 2 == 1 {
                if d * 2 > 9 { d * 2 - 9 } else { d * 2 }
            } else {
                d
            }
        })
        .sum();
    sum.is_multiple_of(10)
}

pub fn spent(spending: &Spending, now: u64) -> u64 {
    spending
        .payments
        .iter()
        .filter(|p| p.at + MONTH > now)
        .map(|p| p.cents)
        .sum()
}

/// Whether paying `cents` with `card` is within the limits now; why not, if not.
pub fn check(vault: &Vault, card: u64, cents: u64, now: u64) -> Result<(), String> {
    let data = &vault.data;
    let card = data
        .cards
        .iter()
        .find(|c| c.id == card)
        .ok_or("no such card")?;
    if card.single_use && card.used {
        return Err("that single-use card was used already".into());
    }
    if cents == 0 || cents > CEILING {
        return Err("that amount can't be paid".into());
    }
    if cents > data.spending.per_payment {
        return Err(format!(
            "that is over the limit per payment (${:.2})",
            data.spending.per_payment as f64 / 100.0
        ));
    }
    if spent(&data.spending, now) + cents > data.spending.per_month {
        return Err(format!(
            "that would go over the limit for the month (${:.2})",
            data.spending.per_month as f64 / 100.0
        ));
    }
    Ok(())
}

/// The payment is made: noted, the card spent if single-use, and its number and code for the broker.
pub fn finish(
    vault: &mut Vault,
    merchant: &str,
    card: u64,
    cents: u64,
    now: u64,
) -> Result<Reply, String> {
    check(vault, card, cents, now)?;
    let data = &mut vault.data;
    data.spending.payments.retain(|p| p.at + MONTH > now);
    data.spending.payments.push(Payment {
        at: now,
        merchant: merchant.into(),
        cents,
        card,
    });
    let card = data
        .cards
        .iter_mut()
        .find(|c| c.id == card)
        .ok_or("no such card")?;
    card.used = true;
    // Number and code on two lines, one secret; the expiry is no secret.
    let mut both = card.number.expose().to_vec();
    both.push(b'\n');
    both.extend_from_slice(card.cvc.expose());
    Ok(Reply::Secret {
        fields: json!({ "expiry": card.expiry }),
        key: "card",
        secret: Secret::new(both),
    })
}

pub fn handle(vault: &mut Vault, request: Request, now: u64) -> Result<(Reply, bool), String> {
    let data = &mut vault.data;
    match request {
        Request::Cards {} => {
            let cards: Vec<_> = data
                .cards
                .iter()
                .map(|c| {
                    let number = c.number.expose();
                    let last4 = String::from_utf8_lossy(&number[number.len().saturating_sub(4)..]).into_owned();
                    json!({ "id": c.id, "label": c.label, "last4": last4, "expiry": c.expiry, "singleUse": c.single_use, "used": c.used })
                })
                .collect();
            Ok((Reply::Plain(json!({ "cards": cards })), false))
        }
        Request::SaveCard {
            label,
            number,
            expiry,
            cvc,
            single_use,
        } => {
            if !digits(&number, 12, 19) || !luhn(number.expose()) {
                return Err("that is not a card number".into());
            }
            let expiry_ok = expiry.len() == 5
                && expiry.as_bytes()[2] == b'/'
                && expiry
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| i == 2 || b.is_ascii_digit());
            if !expiry_ok
                || !digits(&cvc, 3, 4)
                || label.chars().any(char::is_control)
                || label.len() > 100
            {
                return Err("the expiry is MM/YY, the code 3 or 4 digits".into());
            }
            if data.cards.len() >= MAX_CARDS {
                return Err("the vault is full".into());
            }
            let id = data.next_id();
            data.cards.push(Card {
                id,
                label,
                number,
                expiry,
                cvc,
                single_use,
                used: false,
                created: now,
            });
            Ok((Reply::Plain(json!({ "id": id })), true))
        }
        Request::DeleteCard { id } => {
            let before = data.cards.len();
            data.cards.retain(|c| c.id != id);
            Ok((Reply::ok(), before != data.cards.len()))
        }
        Request::Spending {} => Ok((
            Reply::Plain(json!({
                "perPayment": data.spending.per_payment,
                "perMonth": data.spending.per_month,
                "spentThisMonth": spent(&data.spending, now),
            })),
            false,
        )),
        _ => Err("unknown request".into()),
    }
}

pub fn owns(request: &Request) -> bool {
    matches!(
        request,
        Request::Cards {}
            | Request::SaveCard { .. }
            | Request::DeleteCard { .. }
            | Request::Spending {}
    )
}
