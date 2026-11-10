//! Cards for payments, what agents may spend, and what they spent.

use serde::{Deserialize, Serialize};

use crate::vault::bytes::Secret;

/// A card an agent may pay with: a single-use virtual card (from the
/// issuer's app) is used once and then refused; a reusable one stays.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: u64,
    pub label: String,
    pub number: Secret,
    /// "MM/YY".
    pub expiry: String,
    pub cvc: Secret,
    #[serde(rename = "singleUse")]
    pub single_use: bool,
    #[serde(default)]
    pub used: bool,
    pub created: u64,
}

/// Payment limits (in cents) and the payments made through Dashi.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Spending {
    #[serde(rename = "perPayment")]
    pub per_payment: u64,
    #[serde(rename = "perMonth")]
    pub per_month: u64,
    #[serde(default)]
    pub payments: Vec<Payment>,
}

impl Default for Spending {
    /// $100 a payment, $300 a month, until the person says otherwise.
    fn default() -> Self {
        Self {
            per_payment: 10_000,
            per_month: 30_000,
            payments: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub at: u64,
    pub merchant: String,
    pub cents: u64,
    pub card: u64,
}
