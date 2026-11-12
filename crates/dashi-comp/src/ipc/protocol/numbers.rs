//! The wire's small types: ids and numbers that are refused when out of range
//! as they are read, never wrapped or truncated (`as`) afterwards.

use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use serde_json::Number;

/// A JSON number, or an error that says what was wanted (`what`).
fn number<'de, D: Deserializer<'de>>(deserializer: D, what: &str) -> Result<Number, D::Error> {
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Number(number) => Ok(number),
        _ => Err(D::Error::custom(format!("must be {what}"))),
    }
}

/// A window id: a positive whole number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct WindowId(pub u64);

impl<'de> Deserialize<'de> for WindowId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        number(deserializer, "a window id")?
            .as_u64()
            .filter(|id| *id > 0)
            .map(Self)
            .ok_or_else(|| D::Error::custom("must be a window id"))
    }
}

impl Serialize for WindowId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u64(self.0)
    }
}

/// A whole number from `MIN` to `MAX`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Int<const MIN: i64, const MAX: i64>(i64);

impl<const MIN: i64, const MAX: i64> Int<MIN, MAX> {
    /// `value`, if it is in range (for building examples and tests).
    pub(crate) fn new(value: i64) -> Option<Self> {
        (MIN..=MAX).contains(&value).then_some(Self(value))
    }

    #[cfg(test)]
    pub(crate) fn get(self) -> i64 {
        self.0
    }

    /// As another integer type; the range is the caller's promise that it fits.
    pub(crate) fn to<T: TryFrom<i64> + Default>(self) -> T {
        T::try_from(self.0).unwrap_or_default()
    }
}

impl<'de, const MIN: i64, const MAX: i64> Deserialize<'de> for Int<MIN, MAX> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = number(deserializer, "a whole number")?;
        value
            .as_i64()
            .and_then(Self::new)
            .ok_or_else(|| D::Error::custom(format!("must be a whole number from {MIN} to {MAX}")))
    }
}

impl<const MIN: i64, const MAX: i64> Serialize for Int<MIN, MAX> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i64(self.0)
    }
}

/// A count or an index: a whole number from 0.
pub(crate) type Count = Int<0, { u32::MAX as i64 }>;

/// A process id above 1.
pub(crate) type Pid = Int<2, { i32::MAX as i64 }>;

/// Milliseconds, up to `MAX`.
pub(crate) type Millis<const MAX: i64> = Int<0, MAX>;

/// A number of logical pixels, rounded to whole (the shell may send fractions),
/// from `MIN` to `MAX`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Pixels<const MIN: i64, const MAX: i64>(i64);

impl<const MIN: i64, const MAX: i64> Pixels<MIN, MAX> {
    pub(crate) fn new(value: i64) -> Option<Self> {
        (MIN..=MAX).contains(&value).then_some(Self(value))
    }

    pub(crate) fn get(self) -> i64 {
        self.0
    }

    /// As an `i32`: every range here fits one.
    pub(crate) fn i32(self) -> i32 {
        i32::try_from(self.0).unwrap_or_default()
    }
}

impl<'de, const MIN: i64, const MAX: i64> Deserialize<'de> for Pixels<MIN, MAX> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = number(deserializer, "a number")?;
        let whole = match value.as_i64() {
            Some(whole) => Some(whole),
            None => value
                .as_f64()
                .filter(|v| v.is_finite() && v.abs() <= 1e15)
                .map(|v| v.round() as i64),
        };
        whole
            .and_then(Self::new)
            .ok_or_else(|| D::Error::custom(format!("must be a number from {MIN} to {MAX}")))
    }
}

impl<const MIN: i64, const MAX: i64> Serialize for Pixels<MIN, MAX> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i64(self.0)
    }
}

/// Any whole number of pixels an `i32` holds (the caller checks the range that matters).
pub(crate) type Wide = Pixels<{ i32::MIN as i64 }, { i32::MAX as i64 }>;

/// A global coordinate (65536 points either way).
pub(crate) type Coord = Pixels<{ -(1 << 16) }, { 1 << 16 }>;

/// A finite number from `MIN_MILLI / 1000` to `MAX_MILLI / 1000`.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub(crate) struct Real<const MIN_MILLI: i64, const MAX_MILLI: i64>(f64);

impl<const MIN_MILLI: i64, const MAX_MILLI: i64> Real<MIN_MILLI, MAX_MILLI> {
    fn bounds() -> (f64, f64) {
        (MIN_MILLI as f64 / 1000.0, MAX_MILLI as f64 / 1000.0)
    }

    pub(crate) fn new(value: f64) -> Option<Self> {
        let (min, max) = Self::bounds();
        (value.is_finite() && (min..=max).contains(&value)).then_some(Self(value))
    }

    pub(crate) fn get(self) -> f64 {
        self.0
    }
}

impl<'de, const MIN_MILLI: i64, const MAX_MILLI: i64> Deserialize<'de>
    for Real<MIN_MILLI, MAX_MILLI>
{
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = number(deserializer, "a number")?
            .as_f64()
            .unwrap_or(f64::NAN);
        Self::new(value).ok_or_else(|| {
            let (min, max) = Self::bounds();
            if min.is_finite() && max.is_finite() && min > -1e15 && max < 1e15 {
                D::Error::custom(format!("must be a number from {min} to {max}"))
            } else {
                D::Error::custom("must be a number")
            }
        })
    }
}

impl<const MIN_MILLI: i64, const MAX_MILLI: i64> Serialize for Real<MIN_MILLI, MAX_MILLI> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_f64(self.0)
    }
}

/// Any finite number.
pub(crate) type Finite = Real<{ i64::MIN }, { i64::MAX }>;

#[cfg(test)]
mod tests {
    use serde_json::{from_value, json};

    use super::*;

    #[test]
    fn window_ids_are_positive_integers() {
        assert_eq!(from_value::<WindowId>(json!(4)).unwrap(), WindowId(4));
        assert!(from_value::<WindowId>(json!(0)).is_err());
        assert!(from_value::<WindowId>(json!("4")).is_err());
        assert!(from_value::<WindowId>(json!(-1)).is_err());
    }

    #[test]
    fn integers_are_refused_out_of_range_not_truncated() {
        type Fingers = Int<1, 10>;
        assert_eq!(from_value::<Fingers>(json!(3)).unwrap().get(), 3);
        // 4294967299 as u32 would be 3: refused instead (Hickey's `gestures`).
        assert!(from_value::<Fingers>(json!(4_294_967_299_u64)).is_err());
        assert!(from_value::<Fingers>(json!(2.5)).is_err());
        assert!(from_value::<Pid>(json!(1)).is_err());
    }

    #[test]
    fn pixels_round_and_stay_in_range() {
        assert_eq!(from_value::<Coord>(json!(10.6)).unwrap().get(), 11);
        assert_eq!(from_value::<Coord>(json!(-40)).unwrap().get(), -40);
        assert!(from_value::<Coord>(json!(1e12)).is_err());
        assert!(from_value::<Coord>(json!("10")).is_err());
    }

    #[test]
    fn reals_are_finite_and_bounded() {
        type Scale = Real<500, 1000>;
        assert_eq!(from_value::<Scale>(json!(0.96)).unwrap().get(), 0.96);
        assert!(from_value::<Scale>(json!(1.5)).is_err());
        assert!(from_value::<Finite>(json!(null)).is_err());
        assert_eq!(from_value::<Finite>(json!(-3)).unwrap().get(), -3.0);
    }
}
