use super::*;
use crate::tongue::Tongue::{English, French, Hindi, Spanish};

fn en(body: &str) -> Option<String> {
    said(body, None, English, "en-US")
}

fn es(body: &str) -> Option<String> {
    said(body, None, Spanish, "es")
}

#[test]
fn money_is_an_amount_and_its_name_in_the_sentences_language() {
    assert_eq!(en("$20").as_deref(), Some("20 dollars"));
    assert_eq!(en("$1").as_deref(), Some("1 dollar"));
    assert_eq!(en("$20.50").as_deref(), Some("20 dollars and 50 cents"));
    assert_eq!(en("$3.05").as_deref(), Some("3 dollars and 5 cents"));
    assert_eq!(en("$1,000").as_deref(), Some("1,000 dollars"));
    assert_eq!(en("€5").as_deref(), Some("5 euros"));
    assert_eq!(en("£3.00").as_deref(), Some("3 pounds"));
    assert_eq!(es("$20").as_deref(), Some("20 dólares"));
    assert_eq!(es("$1").as_deref(), Some("un dólar"));
    assert_eq!(es("20€").as_deref(), Some("20 euros"));
    assert_eq!(es("£1").as_deref(), Some("una libra"));
    assert_eq!(es("$20,50").as_deref(), Some("20 dólares con 50 centavos"));
    assert_eq!(said("$5", None, French, "fr").as_deref(), Some("5 dollars"));
    assert_eq!(said("$5", None, Hindi, "hi"), None);
}

#[test]
fn a_dollar_sign_is_pesos_where_the_region_counts_in_pesos() {
    let co = |body| said(body, None, Spanish, "es-CO");
    assert_eq!(co("$20.000").as_deref(), Some("20.000 pesos"));
    assert_eq!(co("$1").as_deref(), Some("un peso"));
    assert_eq!(co("US$20").as_deref(), Some("20 dólares"));
    assert_eq!(
        said("$20", None, Spanish, "es-US").as_deref(),
        Some("20 dólares")
    );
    assert_eq!(
        said("$20", None, English, "en-US").as_deref(),
        Some("20 dollars")
    );
}

#[test]
fn shares_and_measures_are_said_whole() {
    assert_eq!(en("50%").as_deref(), Some("50 percent"));
    assert_eq!(es("50%").as_deref(), Some("50 por ciento"));
    assert_eq!(en("3km").as_deref(), Some("3 kilometers"));
    assert_eq!(es("3,5kg").as_deref(), Some("3,5 kilos"));
    assert_eq!(es("20°C").as_deref(), Some("20 grados centígrados"));
    assert_eq!(en("1h").as_deref(), Some("1 hour"));
    assert_eq!(es("1h").as_deref(), Some("una hora"));
    // After its number: only the measure's name is this word's.
    assert_eq!(
        said("km", Some("3"), English, "en").as_deref(),
        Some("kilometers")
    );
    assert_eq!(
        said("km", Some("1"), Spanish, "es").as_deref(),
        Some("kilómetro")
    );
    assert_eq!(
        said("GB", Some("16"), Spanish, "es").as_deref(),
        Some("gigas")
    );
    // A measure's letters with no number before them are a word.
    assert_eq!(said("m", Some("the"), English, "en"), None);
    assert_eq!(said("min", None, Spanish, "es"), None);
}

#[test]
fn times_and_signs_are_said_as_people_say_them() {
    assert_eq!(es("15:30").as_deref(), Some("15 y 30"));
    assert_eq!(es("9:00").as_deref(), Some("9 en punto"));
    assert_eq!(es("09:05").as_deref(), Some("9 y 5"));
    assert_eq!(en("9:00").as_deref(), Some("9 o'clock"));
    assert_eq!(en("9:05").as_deref(), Some("9 oh 5"));
    assert_eq!(en("15:30"), None);
    assert_eq!(en("&").as_deref(), Some("and"));
    assert_eq!(es("&").as_deref(), Some("y"));
    assert_eq!(es("+").as_deref(), Some("más"));
    assert_eq!(en("="), Some("equals".into()));
    // A ratio, a version and a score are not times.
    assert_eq!(en("16:9:1"), None);
    assert_eq!(en("1:5"), None);
}

#[test]
fn spanish_thousands_with_commas_are_thousands_and_words_are_left_alone() {
    assert_eq!(es("1,000").as_deref(), Some("1000"));
    assert_eq!(es("20,000,000").as_deref(), Some("20000000"));
    assert_eq!(es("3,5"), None);
    assert_eq!(es("1.000"), None);
    assert_eq!(en("1,000"), None);
    for word in ["hola", "2026", "3.5", "example.com", "e-mail", "can't"] {
        assert_eq!(en(word), None, "{word}");
        assert_eq!(es(word), None, "{word}");
    }
}

#[test]
fn sh_between_vowels_is_said_in_spanish_as_its_speakers_say_it() {
    assert_eq!(es("Dashi").as_deref(), Some("Dachi"));
    assert_eq!(es("sushi").as_deref(), Some("suchi"));
    assert_eq!(es("WASHINGTON").as_deref(), Some("WACHINGTON"));
    // Where eSpeak keeps the sound, the word is left alone.
    for kept in ["show", "flash", "dashboard", "casa", "Shakira"] {
        assert_eq!(es(kept), None, "{kept}");
    }
    assert_eq!(en("Dashi"), None);
}
