//! The command line (docs/voice.md, "The command line"): the service, and
//! the same models on files, so tests and the VM need no microphone.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Instant;

use serde_json::json;

use crate::audio::pipewire::PipeWire;
use crate::audio::{LISTEN_RATE, SPEAK_RATE, resample::resample, wav};
use crate::engine::gate::Gate;
use crate::engine::vad::FRAME;
use crate::models::fetch::{self, megabytes};
use crate::models::manifest::{self, SETS};
use crate::models::store::Store;
use crate::service::clock::Real;
use crate::service::engines::{Engines, Loaded};
use crate::service::{Parts, Service};
use crate::{paths, server};

pub(crate) const USAGE: &str = "dashi-voice [--models DIR] <command>
  serve [--socket PATH]                          the service (docs/voice.md)
  transcribe [--language LANG] [--json] FILE.wav the words in a WAV file
  speak [--voice ID | --language LANG] [--speed N] [--json] --out FILE.wav TEXT…
                                                 say TEXT into a WAV file
  models [--verify]                              the models, and which are here
  fetch [SET…]                                   fetch models (listen and speak, unless named)
  remove [SET…]                                  delete models (all, unless named)
  inspect FILE.onnx…                             a model's inputs and outputs";

pub(crate) struct Args {
    models: PathBuf,
    command: String,
    rest: Vec<String>,
}

pub(crate) fn parse(raw: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut raw = raw.skip(1);
    let mut models = paths::models();
    loop {
        match raw.next().as_deref() {
            Some("--models") => {
                models = PathBuf::from(raw.next().ok_or("--models needs a folder")?)
            }
            Some("--help" | "-h") | None => return Err(USAGE.into()),
            Some(command) => {
                return Ok(Args {
                    models,
                    command: command.to_owned(),
                    rest: raw.collect(),
                });
            }
        }
    }
}

/// The value after a flag, taken out of the arguments.
fn option(rest: &mut Vec<String>, flag: &str) -> Result<Option<String>, String> {
    let Some(at) = rest.iter().position(|arg| arg == flag) else {
        return Ok(None);
    };
    if at + 1 >= rest.len() {
        return Err(format!("{flag} needs a value"));
    }
    rest.remove(at);
    Ok(Some(rest.remove(at)))
}

fn flag(rest: &mut Vec<String>, flag: &str) -> bool {
    let before = rest.len();
    rest.retain(|arg| arg != flag);
    rest.len() != before
}

fn ms(since: Instant) -> u64 {
    since.elapsed().as_millis() as u64
}

pub(crate) fn run(args: Args) -> Result<(), String> {
    let Args {
        models,
        command,
        mut rest,
    } = args;
    let store = Store::new(models);
    match command.as_str() {
        "serve" => serve(store, option(&mut rest, "--socket")?.map(PathBuf::from)),
        "transcribe" => transcribe(store, rest),
        "speak" => speak(store, rest),
        "models" => models_list(&store, flag(&mut rest, "--verify")),
        "fetch" => fetch_sets(&store, &rest),
        "remove" => {
            for set in sets(&rest, true)? {
                store.remove(set)?;
            }
            Ok(())
        }
        "inspect" => {
            for file in &rest {
                println!(
                    "== {file}\n{}",
                    crate::engine::runtime::describe(Path::new(file))?
                );
            }
            Ok(())
        }
        _ => Err(USAGE.into()),
    }
}

fn sets(ids: &[String], all: bool) -> Result<Vec<&'static manifest::Set>, String> {
    if ids.is_empty() {
        return Ok(SETS.iter().filter(|set| all || set.basic).collect());
    }
    ids.iter()
        .map(|id| manifest::set(id).ok_or_else(|| format!("there are no models named {id}")))
        .collect()
}

/// How the service fetches: itself as a process of its own, as a systemd unit when the unit says so.
fn fetcher(store: &Store) -> Vec<String> {
    let program = std::env::current_exe().map_or_else(
        |_| "dashi-voice".into(),
        |path| path.to_string_lossy().into_owned(),
    );
    let own = [
        program,
        "--models".into(),
        store.folder().to_string_lossy().into_owned(),
        "fetch".into(),
    ];
    if std::env::var("DASHI_VOICE_FETCH_VIA").as_deref() != Ok("systemd-run") {
        return own.to_vec();
    }
    let unit = crate::service::FETCH_UNIT.trim_end_matches(".service");
    let mut via: Vec<String> = [
        "systemd-run",
        "--user",
        "--quiet",
        "--collect",
        "--pipe",
        "--wait",
        "--unit",
        unit,
    ]
    .map(str::to_owned)
    .to_vec();
    via.extend(own);
    via
}

fn serve(store: Store, socket: Option<PathBuf>) -> Result<(), String> {
    let socket = socket.map_or_else(paths::socket, Ok)?;
    let listener = server::listener(&socket)?;
    let service = Service::new(Parts {
        engines: Box::new(Loaded::new(store.clone())),
        fetcher: fetcher(&store),
        store,
        sound: Box::new(PipeWire),
        clock: Arc::new(Real::default()),
    });
    eprintln!("dashi-voice: serving {}", socket.display());
    server::serve(listener, service);
    Ok(())
}

fn transcribe(store: Store, mut rest: Vec<String>) -> Result<(), String> {
    let language = option(&mut rest, "--language")?;
    let as_json = flag(&mut rest, "--json");
    let [file] = rest.as_slice() else {
        return Err(USAGE.into());
    };
    let sound = wav::read(Path::new(file))?;
    let samples = resample(&sound.samples, sound.rate, LISTEN_RATE);
    let engines = Loaded::new(store);
    let started = Instant::now();
    let mut detector = engines.detector()?;
    let recognizer = engines.recognizer(language.as_deref())?;
    let load_ms = ms(started);
    let started = Instant::now();
    let mut gate = Gate::default();
    for frame in samples.chunks(FRAME) {
        let mut frame = frame.to_vec();
        frame.resize(FRAME, 0.0);
        gate.push(&frame, detector.probability(&frame)?);
    }
    let mut recognizer = recognizer.lock().map_err(|_| "the model is not well")?;
    let text = crate::engine::transcribe(&mut *recognizer, gate.speech(), language.as_deref())?;
    let took = ms(started);
    let audio_ms = samples.len() as u64 * 1000 / u64::from(LISTEN_RATE);
    if as_json {
        let speech_ms = gate.speech().len() as u64 * 1000 / u64::from(LISTEN_RATE);
        let factor = took as f64 / audio_ms.max(1) as f64;
        println!(
            "{}",
            json!({ "text": text, "audio_ms": audio_ms, "speech_ms": speech_ms, "load_ms": load_ms, "ms": took, "real_time_factor": factor })
        );
    } else {
        println!("{text}");
    }
    Ok(())
}

fn speak(store: Store, mut rest: Vec<String>) -> Result<(), String> {
    let voice = option(&mut rest, "--voice")?;
    let language = option(&mut rest, "--language")?;
    let speed = option(&mut rest, "--speed")?.map_or(Ok(1.0), |speed| {
        speed.parse::<f32>().map_err(|_| "--speed needs a number")
    })?;
    let out = option(&mut rest, "--out")?.ok_or("speak needs --out FILE.wav")?;
    let as_json = flag(&mut rest, "--json");
    let text = rest.join(" ");
    let voice = crate::service::choose_voice(voice.as_deref(), language.as_deref())?;
    let engines = Loaded::new(store);
    if let Some(why) = engines.mute_in(&voice) {
        return Err(why);
    }
    let started = Instant::now();
    let synthesizer = engines.synthesizer()?;
    let mut synthesizer = synthesizer.lock().map_err(|_| "the model is not well")?;
    let load_ms = ms(started);
    let started = Instant::now();
    let (mut samples, mut sentences, mut first_ms) = (Vec::new(), Vec::new(), None);
    for sentence in crate::text::sentences(&text) {
        let spoken = synthesizer.speak(&sentence, &voice, speed)?;
        first_ms.get_or_insert_with(|| ms(started));
        let at = samples.len() as u64 * 1000 / u64::from(SPEAK_RATE);
        let words: Vec<_> = spoken.words.iter().map(|word| json!({ "text": word.text, "start": at + word.start_ms, "end": at + word.end_ms })).collect();
        sentences.push(json!({ "text": sentence, "at": at, "words": words }));
        samples.extend(spoken.samples);
    }
    let took = ms(started);
    wav::write(Path::new(&out), SPEAK_RATE, &samples)?;
    if as_json {
        let audio_ms = samples.len() as u64 * 1000 / u64::from(SPEAK_RATE);
        let factor = took as f64 / audio_ms.max(1) as f64;
        println!(
            "{}",
            json!({ "voice": voice, "audio_ms": audio_ms, "load_ms": load_ms, "first_sound_ms": first_ms, "ms": took, "real_time_factor": factor, "sentences": sentences })
        );
    }
    Ok(())
}

fn models_list(store: &Store, verify: bool) -> Result<(), String> {
    println!("{}", store.folder().display());
    for set in &SETS {
        let state = if !store.installed(set) {
            format!(
                "not here ({} of {})",
                megabytes(store.have(set)),
                megabytes(set.bytes())
            )
        } else if verify {
            store.verify(set).map(|()| "here, checked".to_owned())?
        } else {
            "here".to_owned()
        };
        println!(
            "{:8} {:>8}  {state}  {}",
            set.id,
            megabytes(set.bytes()),
            set.credit
        );
    }
    Ok(())
}

/// `fetch`: a line of JSON for each step, then `{"done":true}`; the service reads them (service/fetching.rs).
fn fetch_sets(store: &Store, ids: &[String]) -> Result<(), String> {
    use std::io::Write;
    let result = sets(ids, false).and_then(|sets| {
        fetch::fetch(store, &sets, &mut |progress| {
            let line = json!({ "set": progress.set, "file": progress.file, "received": progress.received, "bytes": progress.bytes });
            // Nobody reading any more (the service went, or cancelled): stop.
            writeln!(std::io::stdout(), "{line}").and_then(|()| std::io::stdout().flush()).is_ok()
        })
    });
    let error = match result {
        Ok(true) => None,
        Ok(false) => Some("The fetch was cancelled.".to_owned()),
        Err(error) => Some(error),
    };
    println!("{}", json!({ "done": true, "error": error }));
    error.map_or(Ok(()), Err)
}

pub(crate) fn main() -> ExitCode {
    match parse(std::env::args()).and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("dashi-voice: {message}");
            ExitCode::from(if message == USAGE { 2 } else { 1 })
        }
    }
}
