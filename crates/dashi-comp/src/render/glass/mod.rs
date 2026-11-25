//! Frosted glass (a spike, decisions.md D710 to D719): the compositor blurs
//! what is behind a pane of one of the shell's layer surfaces; the shell says
//! which panes, where, and how they look (IPC `glass`). Rust displays,
//! TypeScript decides: nothing here chooses whether there is glass.
//!
//! - params.rs: the IPC's params, range-checked.
//! - element.rs: a pane among a screen's elements, put behind its surface.
//! - frost.rs: once the screen's elements are known, what is behind each
//!   pane is drawn small and blurred, again only when it changed.
//! - kawase.rs, shaders.rs: the blur (the dual filter) and the pane's look.
//! - stats.rs: what it costs, in dashi.log with `DASHI_GLASS_STATS=1`.

mod element;
mod frost;
mod gl;
#[cfg(test)]
mod gpu_tests;
mod kawase;
mod params;
mod shaders;
mod stats;

use std::collections::HashMap;

use smithay::utils::{Logical, Physical, Point, Rectangle, Scale};

pub(crate) use element::GlassElement;
use element::PaneKey;
pub(crate) use frost::frost;
pub(crate) use params::{GlassParams, GlassReply};
use params::{Look, Pane};
pub(crate) use stats::Stats;

/// The panes of glass the shell asked for, by layer namespace.
#[derive(Default)]
pub(crate) struct Glass {
    panes: HashMap<String, Vec<Pane>>,
    /// False once a GPU could not compile the shaders.
    pub works: bool,
    tried: bool,
    pub stats: Stats,
}

impl Glass {
    /// IPC `glass {namespace, panes}`.
    pub(crate) fn set(&mut self, params: &GlassParams) -> Result<(), String> {
        let panes = params::parse(params)?;
        if panes.is_empty() {
            self.panes.remove(&params.namespace);
        } else {
            self.panes.insert(params.namespace.clone(), panes);
        }
        Ok(())
    }

    /// Whether frosting can be counted on, as far as is known (until a GPU tried, yes).
    pub(crate) fn can(&self) -> bool {
        !self.tried || self.works
    }

    /// A frosting went (or did not).
    pub(crate) fn tried(&mut self, worked: bool) {
        self.tried = true;
        self.works = worked;
    }

    /// The panes of a surface of `namespace` drawn at `at` (the screen's pixels), `size`
    /// big, at `scale`; `motion` is its entrance's alpha and scale about a point, if any.
    pub(crate) fn elements(
        &self,
        namespace: &str,
        at: Point<i32, Physical>,
        size: smithay::utils::Size<i32, Logical>,
        scale: Scale<f64>,
        motion: Option<(f32, Point<i32, Physical>, f64)>,
    ) -> Vec<GlassElement> {
        let Some(panes) = self.panes.get(namespace) else {
            return Vec::new();
        };
        panes
            .iter()
            .enumerate()
            .map(|(index, pane)| {
                let rect = pane
                    .rect
                    .unwrap_or_else(|| Rectangle::from_size(size.to_f64()));
                let (alpha, grow) = match motion {
                    Some((alpha, about, by)) => (alpha, Some((about, by))),
                    None => (1.0, None),
                };
                let by = grow.map_or(1.0, |(_, by)| by);
                let mut geometry = rect.to_physical_precise_round(scale);
                geometry.loc += at;
                if let Some((about, by)) = grow {
                    let from = (geometry.loc - about).to_f64().upscale(by);
                    geometry.loc = about + from.to_i32_round();
                    geometry.size = geometry.size.to_f64().upscale(by).to_i32_round();
                }
                let look = Look {
                    radius: pane.look.radius * scale.x * by,
                    // Not grown: a blur that changed each frame of an entrance would be drawn anew each.
                    blur: pane.look.blur * scale.x,
                    ..pane.look
                };
                let key = PaneKey {
                    namespace: namespace.to_owned(),
                    index,
                };
                GlassElement::new(key, geometry, look, alpha)
            })
            .collect()
    }
}

/// Frost the panes among `elements`, a screen's (frost.rs), counting what it costs (stats.rs).
/// `cache` names the textures kept for it: the screen's name for what it shows, another for a
/// picture of it drawn apart (a capture).
pub(crate) fn frost_screen<R>(
    state: &mut crate::state::Dashi,
    renderer: &mut R,
    output: &smithay::output::Output,
    cache: &str,
    elements: &mut [super::DashiElement<R>],
) where
    R: smithay::backend::renderer::Renderer
        + smithay::backend::renderer::ImportAll
        + smithay::backend::renderer::ImportMem
        + super::GlesAccess
        + smithay::backend::renderer::Offscreen<smithay::backend::renderer::gles::GlesTexture>
        + smithay::backend::renderer::Bind<smithay::backend::renderer::gles::GlesTexture>,
    R::TextureId: smithay::backend::renderer::Texture + Clone + Send + 'static,
{
    if !elements
        .iter()
        .any(|e| matches!(e, super::DashiElement::Glass(_)))
    {
        return;
    }
    let Some(size) = crate::outputs::drawn_size(output) else {
        return;
    };
    let scale = output.current_scale().fractional_scale();
    let timing = state.glass.stats.begin(renderer.gles());
    match frost(renderer, cache, size, scale, elements) {
        Ok(done) => {
            state.glass.tried(true);
            if let Some(timing) = timing {
                state.glass.stats.end(renderer.gles(), cache, timing, done);
            }
        }
        Err(error) => {
            if state.glass.can() {
                tracing::warn!(%error, "no glass on this GPU");
            }
            state.glass.tried(false);
        }
    }
}

/// Frost the panes among a capture's `elements` (`size` pixels at `scale`), with textures of its
/// own: a capture shows the glass as the screen does (decisions.md D714).
pub(crate) fn frost_capture<R>(
    renderer: &mut R,
    size: smithay::utils::Size<i32, Physical>,
    scale: f64,
    elements: &mut [super::DashiElement<R>],
) where
    R: smithay::backend::renderer::Renderer
        + smithay::backend::renderer::ImportAll
        + smithay::backend::renderer::ImportMem
        + super::GlesAccess
        + smithay::backend::renderer::Offscreen<smithay::backend::renderer::gles::GlesTexture>
        + smithay::backend::renderer::Bind<smithay::backend::renderer::gles::GlesTexture>,
    R::TextureId: smithay::backend::renderer::Texture + Clone + Send + 'static,
{
    if let Err(error) = frost(renderer, &format!("capture@{scale}"), size, scale, elements) {
        tracing::debug!(%error, "a capture's glass");
    }
}
