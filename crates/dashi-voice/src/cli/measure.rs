//! `levels`: each installed voice says a line of its own language, and its
//! loudness, pitch and pace are printed. The loudness is what
//! engine/kokoro/levels.rs holds, so every voice is as loud as the next;
//! pitch and pace say how alike two voices are (docs/voice.md).

use serde_json::json;

use crate::audio::{SPEAK_RATE, level, pitch};
use crate::models::store::Store;
use crate::service::engines::{Engines, Loaded};
use crate::tongue::Tongue;

/// A line for each language: plain, a few seconds, no numbers.
fn line(tongue: Tongue) -> &'static str {
    match tongue {
        Tongue::English => {
            "I found the file you asked for. It is in your downloads folder, next to the photos from last week."
        }
        Tongue::Spanish => {
            "Encontré el archivo que pediste. Está en tu carpeta de descargas, junto a las fotos de la semana pasada."
        }
        Tongue::French => {
            "J'ai trouvé le fichier que vous avez demandé. Il est dans votre dossier de téléchargements, à côté des photos de la semaine dernière."
        }
        Tongue::Hindi => "मुझे वह फ़ाइल मिल गई जो आपने माँगी थी। वह आपके डाउनलोड फ़ोल्डर में है।",
        Tongue::Italian => {
            "Ho trovato il file che hai chiesto. È nella tua cartella dei download, accanto alle foto della settimana scorsa."
        }
        Tongue::Portuguese => {
            "Encontrei o arquivo que você pediu. Está na sua pasta de downloads, ao lado das fotos da semana passada."
        }
    }
}

pub(super) fn levels(store: Store) -> Result<(), String> {
    let listed = crate::service::voices(&store);
    let engines = Loaded::new(store);
    let synthesizer = engines.synthesizer()?;
    let mut synthesizer = synthesizer.lock().map_err(|_| "the model is not well")?;
    for voice in listed["voices"].as_array().into_iter().flatten() {
        let (Some(id), Some(true)) = (voice["id"].as_str(), voice["installed"].as_bool()) else {
            continue;
        };
        let Some(tongue) = voice["language"].as_str().and_then(Tongue::of) else {
            continue;
        };
        let (mut samples, mut phonemes) = (Vec::new(), 0);
        for sentence in crate::text::sentences(line(tongue)) {
            let spoken = synthesizer.speak(&sentence, id, None, 1.0)?;
            phonemes += spoken
                .phonemes
                .chars()
                .filter(|c| c.is_alphabetic())
                .count();
            samples.extend(spoken.samples);
        }
        let speech_s = level::speech_samples(&samples, SPEAK_RATE) as f32 / SPEAK_RATE as f32;
        println!(
            "{}",
            json!({
                "voice": id,
                "language": voice["language"],
                "level_db": level::speech_db(&samples, SPEAK_RATE),
                "peak": samples.iter().fold(0.0_f32, |peak, sample| peak.max(sample.abs())),
                "pitch_hz": pitch::median_hz(&samples, SPEAK_RATE),
                "phonemes_per_s": phonemes as f32 / speech_s.max(0.001),
            })
        );
    }
    Ok(())
}
