//! The microphone and the speakers, through PipeWire's own tools run as
//! programs: `pw-record` writes what the default microphone hears to a pipe,
//! `pw-play` plays what is written to one. The microphone exists only while
//! a listen runs; killing the program closes it, and stops speech at once.
//! Both streams call themselves "Dashi", so the shell's microphone pill
//! names them (packages/shell/src/sound/apps/).

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{LISTEN_RATE, SPEAK_RATE, from_s16le, to_s16le};

/// Ends a microphone or a speaker from another thread.
pub(crate) type Closer = Arc<dyn Fn() + Send + Sync>;

pub(crate) trait Microphone: Send {
    /// Fill `frame` with the next samples (16 kHz); false when the sound ended.
    fn read(&mut self, frame: &mut [f32]) -> Result<bool, String>;
    fn closer(&self) -> Closer;
}

pub(crate) trait Speaker: Send {
    /// More sound to play (24 kHz).
    fn write(&mut self, samples: &[f32]) -> Result<(), String>;
    fn closer(&self) -> Closer;
    /// No more is coming: let what was written play out.
    fn finish(self: Box<Self>);
}

/// Where sound comes from and goes to.
pub(crate) trait Sound: Send + Sync {
    fn microphone(&self) -> Result<Box<dyn Microphone>, String>;
    fn speaker(&self) -> Result<Box<dyn Speaker>, String>;
}

pub(crate) struct PipeWire;

/// A tool's arguments: raw 16-bit sound, one channel, on a pipe.
fn tool(program: &str, rate: u32, role: &str, name: &str) -> Command {
    let properties = format!(
        "{{ application.name = \"Dashi\" application.id = \"dev.dashi.Voice\" node.name = \"{name}\" media.name = \"Dashi Voice\" }}"
    );
    let mut command = Command::new(program);
    command
        .args([
            "--raw",
            "--format",
            "s16",
            "--channels",
            "1",
            "--latency",
            "20ms",
        ])
        .args(["--rate", &rate.to_string(), "--media-role", role])
        .args(["-P", &properties, "-"])
        .stderr(Stdio::null());
    command
}

fn kill(child: &Mutex<Child>) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

struct Recording {
    child: Arc<Mutex<Child>>,
    sound: ChildStdout,
    bytes: Vec<u8>,
}

impl Microphone for Recording {
    fn read(&mut self, frame: &mut [f32]) -> Result<bool, String> {
        self.bytes.resize(frame.len() * 2, 0);
        match self.sound.read_exact(&mut self.bytes) {
            Ok(()) => {
                frame.copy_from_slice(&from_s16le(&self.bytes));
                Ok(true)
            }
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
            Err(error) => Err(format!("The microphone stopped: {error}")),
        }
    }

    fn closer(&self) -> Closer {
        let child = self.child.clone();
        Arc::new(move || kill(&child))
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        kill(&self.child);
    }
}

struct Playing {
    child: Arc<Mutex<Child>>,
    sound: Option<ChildStdin>,
}

impl Speaker for Playing {
    fn write(&mut self, samples: &[f32]) -> Result<(), String> {
        let sound = self.sound.as_mut().ok_or("The speakers are closed.")?;
        sound
            .write_all(&to_s16le(samples))
            .map_err(|_| "The speakers stopped.".to_owned())
    }

    fn closer(&self) -> Closer {
        let child = self.child.clone();
        Arc::new(move || kill(&child))
    }

    fn finish(mut self: Box<Self>) {
        // The pipe's end tells pw-play to play out what it holds and leave; it is given two seconds.
        drop(self.sound.take());
        let until = Instant::now() + Duration::from_secs(2);
        while Instant::now() < until {
            match self.child.lock().map(|mut child| child.try_wait()) {
                Ok(Ok(None)) => std::thread::sleep(Duration::from_millis(20)),
                _ => return,
            }
        }
    }
}

impl Drop for Playing {
    fn drop(&mut self) {
        kill(&self.child);
    }
}

impl Sound for PipeWire {
    fn microphone(&self) -> Result<Box<dyn Microphone>, String> {
        let mut child = tool(
            "pw-record",
            LISTEN_RATE,
            "Communication",
            "dashi-voice-listen",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| "The microphone can't be opened: pw-record is not installed.".to_owned())?;
        let sound = child
            .stdout
            .take()
            .ok_or("The microphone can't be opened.")?;
        Ok(Box::new(Recording {
            child: Arc::new(Mutex::new(child)),
            sound,
            bytes: Vec::new(),
        }))
    }

    fn speaker(&self) -> Result<Box<dyn Speaker>, String> {
        let mut child = tool("pw-play", SPEAK_RATE, "Accessibility", "dashi-voice-speak")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .map_err(|_| "The speakers can't be opened: pw-play is not installed.".to_owned())?;
        let sound = child.stdin.take();
        Ok(Box::new(Playing {
            child: Arc::new(Mutex::new(child)),
            sound,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tools_are_asked_for_raw_sound_named_dashi() {
        let command = tool("pw-record", 16_000, "Communication", "dashi-voice-listen");
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args[..7],
            [
                "--raw",
                "--format",
                "s16",
                "--channels",
                "1",
                "--latency",
                "20ms"
            ]
        );
        assert!(args.contains(&"16000".to_owned()));
        assert!(
            args.iter()
                .any(|arg| arg.contains("application.name = \"Dashi\""))
        );
        // The pipe, last.
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }
}
