//! A screen's frosting (and a capture's), counted (stats.rs), its tones sent
//! where they go: the shell hears `glass-tone` for its own panes, a client's
//! dashi_glass_v1 hears `tone` for its surface's first pane.

use std::time::Instant;

use smithay::backend::renderer::{
    Bind, ImportAll, ImportMem, Offscreen, Renderer, Texture, gles::GlesTexture,
};

use super::{
    element::{Owner, PaneKey},
    frost,
    frost::Frame,
    tone,
};
use crate::{
    ipc::protocol::Event,
    render::{DashiElement, GlesAccess},
};

/// Frost the panes among `elements`, a screen's (frost.rs), counting what it costs (stats.rs).
/// `cache` names the textures kept for it: the screen's name for what it shows, another for a
/// picture of it drawn apart (a capture).
pub(crate) fn frost_screen<R>(
    state: &mut crate::state::Dashi,
    renderer: &mut R,
    output: &smithay::output::Output,
    cache: &str,
    elements: &mut [DashiElement<R>],
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    if !elements.iter().any(|e| matches!(e, DashiElement::Glass(_))) {
        return;
    }
    let Some(size) = crate::outputs::drawn_size(output) else {
        return;
    };
    let scale = output.current_scale().fractional_scale();
    let deepest = state.glass.deepest();
    let timing = state.glass.stats.begin(renderer.gles());
    let frame = Frame {
        scale,
        deepest: Some(deepest),
        now: Instant::now(),
    };
    match frost(renderer, cache, size, frame, elements) {
        Ok(done) => {
            let was = state.glass.can();
            state.glass.tried(true);
            if !was {
                state.announce_glass();
            }
            if let Some(timing) = timing {
                state.glass.stats.end(renderer.gles(), cache, timing, &done);
            }
            for (key, rgb) in &done.tones {
                send_tone(state, key, *rgb);
            }
            // A tone still due (read at most every 120 ms): every screen keeps looking until
            // it is read, so a still screen never leaves it unsaid (wakes.rs).
            if done.tone_due {
                state.wakes.poke();
            }
        }
        Err(error) => {
            let was = state.glass.can();
            state.glass.tried(false);
            if was {
                tracing::warn!(%error, "no glass on this GPU");
                state.announce_glass();
            }
        }
    }
}

/// The most surfaces whose last tone is kept.
const MOST_TONES: usize = 256;

/// Where a pane's tone goes: only a surface's first pane speaks for it.
fn send_tone(state: &mut crate::state::Dashi, key: &PaneKey, rgb: [u8; 3]) {
    if key.index != 0 {
        return;
    }
    match &key.owner {
        Owner::Shell(namespace) => state.ipc.emit(Event::GlassTone {
            namespace: namespace.clone(),
            tone: tone::hex(rgb),
        }),
        Owner::TilePreview => {}
        Owner::Surface(id) => {
            let object = state
                .glass
                .objects
                .iter()
                .find(|(surface, _)| surface.id() == *id);
            tracing::debug!(target: "glass", surface = ?id, ?rgb, heard = object.is_some(), "tone");
            if let Some((_, object)) = object {
                object.tone(tone::wire(rgb));
            }
            // Bounded: a surface that went without its glass object leaves its entry behind.
            if state.glass.tones.len() >= MOST_TONES {
                state.glass.tones.clear();
            }
            state.glass.tones.insert(id.clone(), tone::wire(rgb));
        }
    }
}

/// Frost the panes among a capture's `elements` (`size` pixels at `scale`), with textures of its
/// own: a capture shows the glass as the screen does (decisions.md D714). Its tones go nowhere.
pub(crate) fn frost_capture<R>(
    renderer: &mut R,
    size: smithay::utils::Size<i32, smithay::utils::Physical>,
    scale: f64,
    elements: &mut [DashiElement<R>],
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    let cache = format!("capture@{scale}");
    // As deep as the screens' glass was last allowed (frost.rs keeps it).
    let frame = Frame {
        scale,
        deepest: None,
        now: Instant::now(),
    };
    if let Err(error) = frost(renderer, &cache, size, frame, elements) {
        tracing::debug!(%error, "a capture's glass");
    }
}
