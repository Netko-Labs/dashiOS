//! Sentences that mix languages, the owner's kind of speech (dictated,
//! bilingual, with fillers), and the languages a person turns on.

use super::Tongue::{self, English, French, Hindi, Italian, Portuguese, Spanish};
use super::evidence;
use super::tests::all_are;

const BOTH: [Tongue; 2] = [English, Spanish];

#[test]
fn names_and_english_terms_do_not_flip_a_spanish_sentence() {
    all_are(
        Spanish,
        &BOTH,
        &[
            "abre Helium y ve a YouTube",
            "Abre Settings y pon Dark Mode.",
            "Busca el pull request de Alex en GitHub.",
            "Pon la canción Bohemian Rhapsody de Queen.",
            "El deploy falló en el branch main.",
            "Mándale un email a Alex Kim con el link.",
            "Ya hice el commit y el push.",
            "¿Abro Visual Studio Code o Zed?",
            "Tienes un meeting con Design Team a las tres.",
            "Cierra Files y abre Calendar.",
        ],
    );
}

#[test]
fn spanish_names_do_not_flip_an_english_sentence() {
    all_are(
        English,
        &BOTH,
        &[
            "Open Helium and go to YouTube.",
            "Play Despacito by Luis Fonsi.",
            "The meeting with Camila is at three.",
            "I found the file called Descargas.",
            "Send it to Juan and Sofía, please.",
            "Is El País open in a tab?",
            "Call La Casa de Toño and book a table.",
            "Your flight to Bogotá leaves at ten.",
        ],
    );
}

#[test]
fn the_owners_dictated_speech_is_told_by_its_most_words() {
    all_are(
        Spanish,
        &BOTH,
        &[
            "o sea, like, abre el browser y ve a YouTube",
            "pues este, quiero que me digas qué hay en el calendar hoy",
            "si empiezo una conversación en español entonces que siga en español",
            "bueno, dale, ábrelo y me dices qué dice",
            "eh, no sé, creo que está en downloads",
        ],
    );
    all_are(
        English,
        &BOTH,
        &[
            "it will be nice to have like an option for the text to speech tool",
            "when I say something that should be said like in English or in Spanish",
            "if I start a conversation in Spanish then the model could say the next two sentences",
            "because it only uses one single voice",
            "so, um, open the thing I was working on yesterday",
        ],
    );
}

#[test]
fn a_sentence_split_evenly_tells_nothing_and_keeps_what_came_before() {
    for sentence in ["Open la app.", "Listo, done."] {
        assert_eq!(evidence(sentence, &BOTH), None, "{sentence}");
    }
}

#[test]
fn the_languages_a_person_turns_on_are_told_apart() {
    let all = Tongue::ALL;
    all_are(
        French,
        &all,
        &[
            "Je l'ai trouvé dans le dossier.",
            "Voulez-vous que je l'ouvre ?",
            "C'est prêt.",
        ],
    );
    all_are(
        Italian,
        &all,
        &[
            "L'ho trovato nella cartella.",
            "Vuoi che lo apra adesso?",
            "È tutto pronto, grazie.",
        ],
    );
    all_are(
        Portuguese,
        &all,
        &[
            "Encontrei o arquivo na pasta.",
            "Você quer que eu abra agora?",
            "Não está aqui.",
        ],
    );
    all_are(Hindi, &all, &["मुझे फ़ाइल मिल गई।", "क्या मैं इसे खोलूँ?"]);
    all_are(
        Spanish,
        &all,
        &["Está en la carpeta de descargas.", "Dime si quieres."],
    );
    all_are(
        English,
        &all,
        &["I found it.", "Do you want me to open it?"],
    );
    // Hindi letters when Hindi is not among the voices: nothing can say it.
    assert_eq!(evidence("मुझे फ़ाइल मिल गई।", &BOTH), None);
}
