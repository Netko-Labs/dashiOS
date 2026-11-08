//! dashi-voice: Dashi's voice, a session service (docs/architecture.md,
//! "Voice"). It owns the microphone, the speech models and the speaker, and
//! tells the shell what it heard; the shell decides where the words go.
//!
//!   dashi-voice [serve] [--models DIR]          the service, on $XDG_RUNTIME_DIR/dashi-voice.sock
//!   dashi-voice transcribe [--models DIR] WAV…  print what each file says, and how fast
//!   dashi-voice say [--models DIR] [--voice V] [--lang L] [--speed S] --out WAV TEXT
//!   dashi-voice check [--models DIR]            what is installed

mod audio;
mod engine;
mod models;
mod outbox;
mod phonemes;
mod protocol;
mod segmenter;
mod server;
mod speaker;
mod stt;
mod tts;
mod vad;

use std::{path::PathBuf, process::ExitCode, sync::mpsc::channel, thread, time::Instant};

use crate::{engine::Engine, models::Paths, outbox::Outbox};

struct Options {
    models: Option<PathBuf>,
    voice: String,
    lang: String,
    speed: f32,
    out: Option<PathBuf>,
    rest: Vec<String>,
}

fn parse(args: &[String]) -> Result<Options, String> {
    let mut options = Options {
        models: None,
        voice: "af_heart".into(),
        lang: "en".into(),
        speed: 1.0,
        out: None,
        rest: Vec::new(),
    };
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        let mut value = || args.next().cloned().ok_or(format!("{arg} needs a value"));
        match arg.as_str() {
            "--models" => options.models = Some(PathBuf::from(value()?)),
            "--voice" => options.voice = value()?,
            "--lang" => options.lang = value()?,
            "--speed" => options.speed = value()?.parse().map_err(|_| "--speed is a number")?,
            "--out" => options.out = Some(PathBuf::from(value()?)),
            _ => options.rest.push(arg.clone()),
        }
    }
    Ok(options)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, rest) = match args.first().map(String::as_str) {
        Some(command @ ("serve" | "transcribe" | "say" | "check")) => (command, &args[1..]),
        _ => ("serve", &args[..]),
    };
    let result = parse(rest).and_then(|options| match command {
        "transcribe" => transcribe(options),
        "say" => say(options),
        "check" => check(options),
        _ => serve(options),
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("dashi-voice: {error}");
            ExitCode::FAILURE
        }
    }
}

fn serve(options: Options) -> Result<(), String> {
    let paths = Paths::find(options.models);
    let path = server::socket_path()?;
    let listener = server::listen(&path)?;
    eprintln!(
        "dashi-voice: listening on {} (models in {})",
        path.display(),
        paths.root.display()
    );
    let outbox = Outbox::default();
    let (sender, receiver) = channel();
    let engine = Engine::new(paths, outbox.clone(), sender.clone());
    thread::Builder::new()
        .name("server".into())
        .spawn(move || server::serve(listener, outbox, sender))
        .map_err(|error| error.to_string())?;
    engine.run(receiver);
    Ok(())
}

fn transcribe(options: Options) -> Result<(), String> {
    let paths = Paths::find(options.models);
    let loading = Instant::now();
    let mut stt = stt::Parakeet::load(&paths)?;
    eprintln!("loaded in {:.2} s", loading.elapsed().as_secs_f32());
    for file in &options.rest {
        let (samples, rate) =
            audio::read_wav(file.as_ref()).map_err(|error| format!("{file}: {error}"))?;
        let samples = audio::resample(&samples, rate, audio::LISTEN_RATE);
        let seconds = samples.len() as f32 / audio::LISTEN_RATE as f32;
        let started = Instant::now();
        let text = stt.transcribe(&samples)?;
        let took = started.elapsed().as_secs_f32();
        println!("{text}");
        eprintln!(
            "{file}: {seconds:.2} s of audio in {took:.3} s (real-time factor {:.3})",
            took / seconds.max(0.001)
        );
    }
    Ok(())
}

fn say(options: Options) -> Result<(), String> {
    let out = options.out.ok_or("say needs --out FILE.wav")?;
    let text = options.rest.join(" ");
    let paths = Paths::find(options.models);
    let mut kokoro = tts::Kokoro::load(paths)?;
    let started = Instant::now();
    let mut samples = Vec::new();
    for sentence in phonemes::sentences(&text) {
        samples.extend(kokoro.say(&sentence, &options.lang, &options.voice, options.speed)?);
        // A breath between sentences.
        samples.extend(std::iter::repeat_n(0.0, audio::SPEAK_RATE as usize / 5));
    }
    let seconds = samples.len() as f32 / audio::SPEAK_RATE as f32;
    std::fs::write(&out, audio::wav_bytes(&samples, audio::SPEAK_RATE))
        .map_err(|error| error.to_string())?;
    eprintln!(
        "{}: {seconds:.2} s of speech in {:.3} s",
        out.display(),
        started.elapsed().as_secs_f32()
    );
    Ok(())
}

fn check(options: Options) -> Result<(), String> {
    let paths = Paths::find(options.models);
    println!("models: {}", paths.root.display());
    println!("listen: {}", paths.can_listen());
    println!("speak: {}", paths.can_speak());
    models::environment()?;
    println!("onnxruntime: loaded");
    Ok(())
}
