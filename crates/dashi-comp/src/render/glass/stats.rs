//! What the glass costs, per screen, with `DASHI_GLASS_STATS=1`: a `glass`
//! line in dashi.log every 10 s with the frames that had glass, the panes
//! frosted, how many were blurred again, and the time frosting took on the
//! event loop (`cpu`) and on the GPU (`gpu`: GL timer queries where the GPU
//! has them, `GL_EXT_disjoint_timer_query`; else the GPU's queue is finished
//! before and after, which costs a stall, and the line says `finish`). Off,
//! it costs nothing.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use smithay::backend::renderer::gles::{GlesRenderer, ffi};

use super::frost::Frosting;

const WINDOW: Duration = Duration::from_secs(10);
/// GL's `TIME_ELAPSED_EXT` (GL_EXT_disjoint_timer_query; core in desktop GL 3.3).
const TIME_ELAPSED: ffi::types::GLenum = 0x88BF;
/// Queries in flight at most; a result not read by then is dropped.
const IN_FLIGHT: usize = 16;

#[derive(Default, Clone, Copy)]
struct Spread {
    count: u32,
    total: f64,
    max: f64,
}

impl Spread {
    fn add(&mut self, ms: f64) {
        self.count += 1;
        self.total += ms;
        self.max = self.max.max(ms);
    }

    fn text(&self) -> String {
        let mean = if self.count == 0 {
            0.0
        } else {
            self.total / f64::from(self.count)
        };
        format!("{mean:.3}/{:.3} ms", self.max)
    }
}

#[derive(Default)]
struct Screen {
    began: Option<Instant>,
    frames: u32,
    panes: u32,
    blurred: u32,
    cpu: Spread,
    gpu: Spread,
    pending: Vec<ffi::types::GLuint>,
}

/// How the GPU's time is read.
#[derive(Clone, Copy, PartialEq)]
enum Clock {
    Queries,
    Finish,
}

#[derive(Default)]
pub(crate) struct Stats {
    on: Option<bool>,
    clock: Option<Clock>,
    screens: HashMap<String, Screen>,
}

/// A frosting being timed.
pub(crate) struct Timing {
    started: Instant,
    query: Option<ffi::types::GLuint>,
}

impl Stats {
    fn on(&mut self) -> bool {
        *self
            .on
            .get_or_insert_with(|| std::env::var("DASHI_GLASS_STATS").is_ok_and(|v| v == "1"))
    }

    /// Start timing a frosting (none when the stats are off).
    pub(crate) fn begin(&mut self, gles: &mut GlesRenderer) -> Option<Timing> {
        if !self.on() {
            return None;
        }
        let clock = *self.clock.get_or_insert_with(|| clock(gles));
        let query = gles
            .with_context(|gl| match clock {
                // SAFETY: the context is current (with_context); one query, begun on it.
                Clock::Queries => unsafe {
                    let mut query = 0;
                    gl.GenQueries(1, &mut query);
                    gl.BeginQuery(TIME_ELAPSED, query);
                    Some(query)
                },
                // SAFETY: the context is current (with_context).
                Clock::Finish => unsafe {
                    gl.Finish();
                    None
                },
            })
            .ok()
            .flatten();
        Some(Timing {
            started: Instant::now(),
            query,
        })
    }

    /// The frosting on `output` ended; `done` says what it did.
    pub(crate) fn end(
        &mut self,
        gles: &mut GlesRenderer,
        output: &str,
        timing: Timing,
        done: Frosting,
    ) {
        let screen = self.screens.entry(output.to_owned()).or_default();
        let finished = gles
            .with_context(|gl| match timing.query {
                // SAFETY: the context is current; the query was begun on it and is ended once.
                Some(query) => unsafe {
                    gl.EndQuery(TIME_ELAPSED);
                    screen.pending.push(query);
                    None
                },
                // SAFETY: the context is current.
                None => unsafe {
                    gl.Finish();
                    Some(timing.started.elapsed())
                },
            })
            .ok()
            .flatten();
        let cpu = timing.started.elapsed();
        screen.cpu.add(cpu.as_secs_f64() * 1000.0);
        if let Some(took) = finished {
            screen.gpu.add(took.as_secs_f64() * 1000.0);
        }
        screen.frames += 1;
        screen.panes += done.panes;
        screen.blurred += done.blurred;
        read_queries(gles, screen);
        let clock = self.clock;
        let began = *screen.began.get_or_insert_with(Instant::now);
        if began.elapsed() >= WINDOW {
            let how = if clock == Some(Clock::Queries) {
                "queries"
            } else {
                "finish"
            };
            tracing::info!(
                target: "glass",
                output,
                frames = screen.frames,
                panes = screen.panes,
                blurred = screen.blurred,
                cpu = screen.cpu.text(),
                gpu = screen.gpu.text(),
                clock = how,
                "glass"
            );
            let pending = std::mem::take(&mut screen.pending);
            *screen = Screen {
                pending,
                ..Screen::default()
            };
        }
    }
}

/// Timer queries where the context has them (GLES 3 and the extension), else finishing.
fn clock(gles: &mut GlesRenderer) -> Clock {
    let has = gles
        .with_context(|gl| {
            // SAFETY: the context is current; GetString returns a static, NUL-ended string or null.
            let text = |name| unsafe {
                let at = gl.GetString(name);
                if at.is_null() {
                    String::new()
                } else {
                    std::ffi::CStr::from_ptr(at.cast())
                        .to_string_lossy()
                        .into_owned()
                }
            };
            let version = text(ffi::VERSION);
            let extensions = text(ffi::EXTENSIONS);
            version.starts_with("OpenGL ES 3")
                && extensions.contains("GL_EXT_disjoint_timer_query")
                && gl.BeginQuery.is_loaded()
        })
        .unwrap_or(false);
    let clock = if has { Clock::Queries } else { Clock::Finish };
    tracing::info!(target: "glass", queries = has, "glass: timing the GPU");
    clock
}

/// Read the queries whose results are in; drop the oldest past `IN_FLIGHT`.
fn read_queries(gles: &mut GlesRenderer, screen: &mut Screen) {
    let pending = std::mem::take(&mut screen.pending);
    let _ = gles.with_context(|gl| {
        for (at, query) in pending.iter().enumerate() {
            let mut ready = 0;
            // SAFETY: the context is current; `query` is one of ours, ended.
            unsafe { gl.GetQueryObjectuiv(*query, ffi::QUERY_RESULT_AVAILABLE, &mut ready) };
            let late = pending.len() - at > IN_FLIGHT;
            if ready == 0 && !late {
                screen.pending.push(*query);
                continue;
            }
            if ready != 0 {
                let mut nanos = 0;
                // SAFETY: as above, and its result is available.
                unsafe { gl.GetQueryObjectuiv(*query, ffi::QUERY_RESULT, &mut nanos) };
                screen.gpu.add(f64::from(nanos) / 1e6);
            }
            // SAFETY: as above; the query is ours and read (or given up).
            unsafe { gl.DeleteQueries(1, query) };
        }
    });
}
