//! The words reading.rs says for signs, money and measures, by language.

use crate::tongue::Tongue;

/// One and many: ("dollar", "dollars").
type Name = (&'static str, &'static str);

pub(super) struct Names {
    pub(super) percent: &'static str,
    pub(super) dollar: Name,
    pub(super) euro: Name,
    pub(super) pound: Name,
    pub(super) peso: Option<Name>,
    /// What joins an amount to its hundredths, and their name: "and", "cents".
    pub(super) cents: Option<(&'static str, &'static str)>,
    /// A sign that stands alone between words.
    pub(super) signs: &'static [(&'static str, &'static str)],
    /// A measure as written, and its name.
    pub(super) units: &'static [(&'static str, Name)],
    /// The names (in the singular) that take "una".
    pub(super) feminine: &'static [&'static str],
}

const ENGLISH: Names = Names {
    percent: "percent",
    dollar: ("dollar", "dollars"),
    euro: ("euro", "euros"),
    pound: ("pound", "pounds"),
    peso: Some(("peso", "pesos")),
    cents: Some(("and", "cents")),
    signs: &[
        ("&", "and"),
        ("+", "plus"),
        ("=", "equals"),
        ("%", "percent"),
    ],
    units: &[
        ("km", ("kilometer", "kilometers")),
        ("m", ("meter", "meters")),
        ("cm", ("centimeter", "centimeters")),
        ("mm", ("millimeter", "millimeters")),
        ("kg", ("kilogram", "kilograms")),
        ("g", ("gram", "grams")),
        ("mg", ("milligram", "milligrams")),
        ("l", ("liter", "liters")),
        ("ml", ("milliliter", "milliliters")),
        ("h", ("hour", "hours")),
        ("min", ("minute", "minutes")),
        ("ms", ("millisecond", "milliseconds")),
        ("km/h", ("kilometer per hour", "kilometers per hour")),
        ("°", ("degree", "degrees")),
        ("°C", ("degree Celsius", "degrees Celsius")),
        ("°F", ("degree Fahrenheit", "degrees Fahrenheit")),
        ("KB", ("kilobyte", "kilobytes")),
        ("MB", ("megabyte", "megabytes")),
        ("GB", ("gigabyte", "gigabytes")),
        ("TB", ("terabyte", "terabytes")),
        ("px", ("pixel", "pixels")),
    ],
    feminine: &[],
};

const SPANISH: Names = Names {
    percent: "por ciento",
    dollar: ("dólar", "dólares"),
    euro: ("euro", "euros"),
    pound: ("libra", "libras"),
    peso: Some(("peso", "pesos")),
    cents: Some(("con", "centavos")),
    signs: &[
        ("&", "y"),
        ("+", "más"),
        ("=", "igual a"),
        ("%", "por ciento"),
    ],
    units: &[
        ("km", ("kilómetro", "kilómetros")),
        ("m", ("metro", "metros")),
        ("cm", ("centímetro", "centímetros")),
        ("mm", ("milímetro", "milímetros")),
        ("kg", ("kilo", "kilos")),
        ("g", ("gramo", "gramos")),
        ("mg", ("miligramo", "miligramos")),
        ("l", ("litro", "litros")),
        ("ml", ("mililitro", "mililitros")),
        ("h", ("hora", "horas")),
        ("min", ("minuto", "minutos")),
        ("ms", ("milisegundo", "milisegundos")),
        ("km/h", ("kilómetro por hora", "kilómetros por hora")),
        ("°", ("grado", "grados")),
        ("°C", ("grado centígrado", "grados centígrados")),
        ("°F", ("grado Fahrenheit", "grados Fahrenheit")),
        ("KB", ("kilobyte", "kilobytes")),
        ("MB", ("mega", "megas")),
        ("GB", ("giga", "gigas")),
        ("TB", ("tera", "teras")),
        ("px", ("pixel", "pixeles")),
    ],
    feminine: &["hora", "libra", "mega", "giga", "tera"],
};

/// Money and shares only: the rest is left to eSpeak.
const fn few(percent: &'static str, dollar: Name, euro: Name, pound: Name) -> Names {
    Names {
        percent,
        dollar,
        euro,
        pound,
        peso: None,
        cents: None,
        signs: &[],
        units: &[],
        feminine: &[],
    }
}

const FRENCH: Names = few(
    "pour cent",
    ("dollar", "dollars"),
    ("euro", "euros"),
    ("livre", "livres"),
);
const ITALIAN: Names = few(
    "per cento",
    ("dollaro", "dollari"),
    ("euro", "euro"),
    ("sterlina", "sterline"),
);
const PORTUGUESE: Names = few(
    "por cento",
    ("dólar", "dólares"),
    ("euro", "euros"),
    ("libra", "libras"),
);

pub(super) fn names(tongue: Tongue) -> Option<&'static Names> {
    match tongue {
        Tongue::English => Some(&ENGLISH),
        Tongue::Spanish => Some(&SPANISH),
        Tongue::French => Some(&FRENCH),
        Tongue::Italian => Some(&ITALIAN),
        Tongue::Portuguese => Some(&PORTUGUESE),
        Tongue::Hindi => None,
    }
}

/// Where `$` is a peso: the tag's region ("es-CO"). Elsewhere it is a dollar.
pub(super) fn counts_in_pesos(tag: &str) -> bool {
    let region = tag.split(['-', '_']).nth(1).unwrap_or("").to_uppercase();
    ["AR", "CL", "CO", "CU", "DO", "MX", "PH", "UY"].contains(&region.as_str())
}
