//! `speak`: what the service would say, into a WAV file, with each
//! sentence's voice, language and phonemes for whoever checks it.

use std::path::Path;
use std::time::Instant;

use serde_json::json;

use super::{flag, ms, option};
use crate::audio::{SPEAK_RATE, level, wav};
use crate::models::store::Store;
use crate::protocol::Speak;
use crate::service::engines::{Engines, Loaded};

/// "es=ef_dora,fr=ff_siwis" as `speak`'s `voices`.
fn voices(given: &str) -> Result<std::collections::BTreeMap<String, String>, String> {
    given
        .split(',')
        .map(|pair| {
            let (tag, voice) = pair.split_once('=').ok_or("--voices needs LANG=ID,…")?;
            Ok((tag.to_owned(), voice.to_owned()))
        })
        .collect()
}

pub(super) fn speak(store: Store, mut rest: Vec<String>) -> Result<(), String> {
    let speed = option(&mut rest, "--speed")?.map_or(Ok(1.0), |speed| {
        speed.parse::<f32>().map_err(|_| "--speed needs a number")
    })?;
    let out = option(&mut rest, "--out")?.ok_or("speak needs --out FILE.wav")?;
    // An experiment: the voice named reads everything as this language (its
    // own sound, that language's phonemes). The service never does this.
    let read_as = option(&mut rest, "--read-as")?;
    let params = Speak {
        voice: option(&mut rest, "--voice")?,
        language: option(&mut rest, "--language")?,
        voices: option(&mut rest, "--voices")?
            .map(|given| voices(&given))
            .transpose()?,
        hint: option(&mut rest, "--hint")?,
        by_language: flag(&mut rest, "--one-voice").then_some(false),
        ..Speak::default()
    };
    let as_json = flag(&mut rest, "--json");
    let params = Speak {
        text: rest.join(" "),
        ..params
    };
    let (lines, cut) = crate::service::lines(&params)?;
    let engines = Loaded::new(store);
    // "ef_dora+af_heart" is a voice between the two (an experiment too): both must be here.
    let named = lines.iter().flat_map(|line| line.voice.split('+'));
    if let Some(why) = named.into_iter().find_map(|voice| engines.mute_in(voice)) {
        return Err(why);
    }
    let started = Instant::now();
    let synthesizer = engines.synthesizer()?;
    let mut synthesizer = synthesizer.lock().map_err(|_| "the model is not well")?;
    let load_ms = ms(started);
    let started = Instant::now();
    let (mut samples, mut sentences, mut first_ms) = (Vec::new(), Vec::new(), None);
    let seams = crate::service::seams(&lines);
    for (index, line) in lines.iter().enumerate() {
        let tag = read_as.as_deref().or(line.tag.as_deref());
        let spoken = synthesizer.speak(&line.text, &line.voice, tag, speed)?;
        let spoken = crate::service::joined(spoken, index, cut, seams[index]);
        first_ms.get_or_insert_with(|| ms(started));
        let at = samples.len() as u64 * 1000 / u64::from(SPEAK_RATE);
        let words: Vec<_> = spoken.words.iter().map(|word| json!({ "text": word.text, "start": at + word.start_ms, "end": at + word.end_ms })).collect();
        let (lead_ms, tail_ms) = level::hush_ms(&spoken.samples, SPEAK_RATE);
        sentences.push(json!({
            "text": line.text, "at": at, "voice": line.voice, "language": spoken.language,
            "phonemes": spoken.phonemes, "level_db": level::speech_db(&spoken.samples, SPEAK_RATE),
            "lead_ms": lead_ms, "tail_ms": tail_ms, "words": words,
        }));
        samples.extend(spoken.samples);
    }
    let took = ms(started);
    wav::write(Path::new(&out), SPEAK_RATE, &samples)?;
    if as_json {
        let audio_ms = samples.len() as u64 * 1000 / u64::from(SPEAK_RATE);
        let factor = took as f64 / audio_ms.max(1) as f64;
        let voice = lines.first().map(|line| line.voice.as_str());
        println!(
            "{}",
            json!({ "voice": voice, "audio_ms": audio_ms, "load_ms": load_ms, "first_sound_ms": first_ms, "ms": took, "real_time_factor": factor, "sentences": sentences })
        );
    }
    Ok(())
}
