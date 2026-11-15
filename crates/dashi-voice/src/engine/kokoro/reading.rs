//! How a written word is said when eSpeak NG would say it wrong, or when
//! its sign would be lost before eSpeak sees it: money ("$20"), a share
//! ("50%"), a measure ("3 km"), a time ("15:30"), a sign alone ("&"). The
//! answer is plain words and digits in the sentence's language; eSpeak
//! says the digits. English and Spanish in full; French, Italian and
//! Portuguese for money and shares; anything else is left as written.

use super::reading_words::{self as words, Names};
use crate::tongue::Tongue;

/// A sign that is part of what a word says, so it is kept with the word.
pub(super) fn sign(character: char) -> bool {
    matches!(
        character,
        '$' | '€' | '£' | '%' | '°' | '&' | '+' | '=' | '/'
    )
}

/// Digits, with the marks numbers are written with: "20", "1,000", "3.5".
fn number(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_digit())
        && text.ends_with(|c: char| c.is_ascii_digit())
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.' || c == ',')
}

/// Whether a number is one: "1", and not "1.5" or "11".
fn one(amount: &str) -> bool {
    amount == "1"
}

/// "1,000" and "20,000,000" in Spanish are thousands, never "uno coma cero cero cero".
fn plain(amount: &str, tongue: Tongue) -> String {
    let grouped = amount
        .split(',')
        .skip(1)
        .all(|group| group.len() == 3 && group.chars().all(|c| c.is_ascii_digit()));
    if tongue == Tongue::Spanish && amount.contains(',') && !amount.contains('.') && grouped {
        return amount.replace(',', "");
    }
    amount.to_owned()
}

/// An amount as its whole and its hundredths: "20.50" is 20 and 50; "20.000" is whole.
fn hundredths(amount: &str) -> (&str, Option<&str>) {
    match amount.rsplit_once(['.', ',']) {
        Some((whole, part)) if part.len() == 2 && !whole.is_empty() => (whole, Some(part)),
        _ => (amount, None),
    }
}

/// "20" with "dollar" is "20 dollars"; one of them is "1 dollar", "un dólar", "una hora".
fn counted(amount: &str, name: &(&str, &str), names: &Names, tongue: Tongue) -> String {
    if !one(amount) {
        return format!("{} {}", plain(amount, tongue), name.1);
    }
    match tongue {
        Tongue::Spanish if names.feminine.contains(&name.0) => format!("una {}", name.0),
        Tongue::Spanish => format!("un {}", name.0),
        _ => format!("1 {}", name.0),
    }
}

/// "$20.50": twenty dollars and fifty cents. `$` is pesos where the tag's region counts in pesos.
fn money(body: &str, names: &Names, tongue: Tongue, tag: &str) -> Option<String> {
    let (dollars_only, rest) = match body.strip_prefix("US") {
        Some(rest) => (true, rest),
        None => (false, body),
    };
    let symbol = rest.chars().find(|c| matches!(c, '$' | '€' | '£'))?;
    let amount = rest
        .strip_prefix(symbol)
        .or_else(|| rest.strip_suffix(symbol))?;
    if !number(amount) {
        return None;
    }
    let pesos = symbol == '$' && !dollars_only && words::counts_in_pesos(tag);
    let coin = match symbol {
        '$' if pesos => names.peso?,
        '$' => names.dollar,
        '€' => names.euro,
        _ => names.pound,
    };
    let (whole, part) = hundredths(amount);
    let said = counted(whole, &coin, names, tongue);
    match (part, names.cents) {
        (Some("00") | None, _) => Some(said),
        (Some(part), Some((join, cents))) => {
            let part = part.trim_start_matches('0');
            Some(format!("{said} {join} {part} {cents}"))
        }
        (Some(_), None) => Some(counted(amount, &coin, names, tongue)),
    }
}

/// "15:30" in Spanish is "15 y 30"; "9:00" is "nine o'clock", "9 en punto"; "9:05" is "nine oh five".
fn time(body: &str, tongue: Tongue) -> Option<String> {
    let (hour, minutes) = body.split_once(':')?;
    let digits = |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_digit());
    if !digits(hour) || hour.len() > 2 || minutes.len() != 2 || !digits(minutes) {
        return None;
    }
    let hour = hour.trim_start_matches('0');
    let hour = if hour.is_empty() { "0" } else { hour };
    let small = hour.parse::<u8>().is_ok_and(|hour| hour <= 12);
    let minute = minutes.trim_start_matches('0');
    match (tongue, minutes) {
        (Tongue::Spanish, "00") => Some(format!("{hour} en punto")),
        (Tongue::Spanish, _) => Some(format!("{hour} y {minute}")),
        (Tongue::English, "00") if small => Some(format!("{hour} o'clock")),
        (Tongue::English, _) if minutes.starts_with('0') && minutes != "00" => {
            Some(format!("{hour} oh {minute}"))
        }
        _ => None,
    }
}

/// A number with its measure written against it: "3km", "50%", "20°C".
fn measured(body: &str, names: &Names, tongue: Tongue) -> Option<String> {
    let digits = body
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .filter(|at| *at > 0)?;
    let (amount, unit) = body.split_at(digits);
    if !number(amount) {
        return None;
    }
    if unit == "%" {
        return Some(format!("{} {}", plain(amount, tongue), names.percent));
    }
    let name = names.units.iter().find(|(written, _)| *written == unit)?;
    Some(counted(amount, &name.1, names, tongue))
}

/// What to say for `body`, a written word without the marks around it;
/// `before` is the word before it. None: say it as written.
pub(super) fn said(body: &str, before: Option<&str>, tongue: Tongue, tag: &str) -> Option<String> {
    let names = words::names(tongue)?;
    if let Some(alone) = names.signs.iter().find(|(written, _)| *written == body) {
        return Some(alone.1.to_owned());
    }
    if let Some(said) = money(body, names, tongue, tag).or_else(|| time(body, tongue)) {
        return Some(said);
    }
    if let Some(said) = measured(body, names, tongue) {
        return Some(said);
    }
    // A measure after its number: "3 km", "1 h".
    if let Some(amount) = before.filter(|before| number(before)) {
        let name = names.units.iter().find(|(written, _)| *written == body)?;
        let name = if one(amount) { name.1.0 } else { name.1.1 };
        return Some(name.to_owned());
    }
    (number(body) && plain(body, tongue) != body).then(|| plain(body, tongue))
}

#[cfg(test)]
#[path = "reading_tests.rs"]
mod tests;
