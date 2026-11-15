use super::*;

const US: Language = LANGUAGES[0];
const UK: Language = LANGUAGES[1];
const SPANISH: Language = LANGUAGES[2];

#[test]
fn american_sounds_become_kokoros_letters() {
    assert_eq!(
        kokoro_letters("həlˈo^ʊ ðˈɛ^ɹ\n hˈa^ʊ ɑː^ɹ juː", US),
        "həlˈO ðˈɛɹ hˈW ɑɹ ju"
    );
    assert_eq!(
        kokoro_letters("d^ʒˈʌmps ˌo^ʊvɚ ðə lˈe^ɪzi", US),
        "ʤˈʌmps ˌOvəɹ ðə lˈAzi"
    );
    assert_eq!(kokoro_letters("bˈʌʔn\u{329}", US), "bˈʌtn");
    assert_eq!(kokoro_letters("bˈɑːɾə^l wˈɜːd", US), "bˈɑɾᵊl wˈɜɹd");
    assert_eq!(kokoro_letters("ɹˈɪðm\u{329}", US), "ɹˈɪðᵊm");
    assert_eq!(kokoro_letters("a^ɪ kæn hˈa^ɪ", US), "ˌI kæn hˈI");
}

#[test]
fn british_keeps_its_long_vowels() {
    assert_eq!(kokoro_letters("ɡˈə^ʊ ðˈe^ə fˈɑːðə", UK), "ɡˈQ ðˈɛː fˈɑːðə");
}

#[test]
fn other_languages_keep_their_own_sounds() {
    assert_eq!(
        kokoro_letters("kˈomo estˈas\nrˈapiðo", SPANISH),
        "kˈomo estˈas rˈapiðo"
    );
    assert_eq!(kokoro_letters("mˈut^ʃo", SPANISH), "mˈuʧo");
}

#[test]
fn a_voice_names_its_language() {
    assert_eq!(of_voice("af_heart").map(|l| l.code), Some("en-US"));
    assert_eq!(of_voice("bm_george").map(|l| l.espeak), Some("en-gb"));
    assert_eq!(of_voice("pf_dora").map(|l| l.code), Some("pt-BR"));
    assert_eq!(read_as("ef_dora", None).map(|l| l.espeak), Some("es"));
    assert_eq!(
        read_as("ef_dora", Some("es-CO")).map(|l| l.espeak),
        Some("es-419")
    );
    assert_eq!(
        read_as("ef_dora", Some("es-ES")).map(|l| l.espeak),
        Some("es")
    );
    assert_eq!(
        read_as("bm_george", Some("en")).map(|l| l.code),
        Some("en-GB")
    );
    assert_eq!(
        read_as("af_heart", Some("en-GB")).map(|l| l.code),
        Some("en-GB")
    );
    // A voice asked to read another language keeps its sound and takes that language's phonemes.
    assert_eq!(read_as("af_heart", Some("es")).map(|l| l.code), Some("es"));
    assert_eq!(read_as("af_heart", Some("ja")), None);
    // Japanese and Mandarin voices exist, but nothing here can read for them.
    assert_eq!(of_voice("jf_alpha"), None);
    assert_eq!(of_voice(""), None);
}
