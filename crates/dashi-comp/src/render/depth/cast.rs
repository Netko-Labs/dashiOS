//! What one window casts where it is drawn now: its frame on the screen,
//! small in the overview or a flight, or sliding with its Space. Each window
//! keeps a steady element id per side and a look; the commit moves only when
//! the look does (a resize, a focus fade, a new style), so a still window
//! costs no damage, and a moving one damages where it was and where it is.

use std::time::{Duration, Instant};

use smithay::{
    backend::renderer::{element::Id, gles::GlesRenderer, utils::CommitCounter},
    utils::{Logical, Physical, Rectangle, Scale, Size},
};

use super::{
    element::{self, DepthElement, Shape, Side},
    geometry::{self, Facts, Focus, Role},
    style::{Line, Shadow, Style},
};
use crate::{
    render::titlebar::Decor,
    state::Dashi,
    wm::{WindowId, toplevel_surface},
};

/// How a window is drawn, for its depth.
pub(crate) struct Placement {
    /// Its outer frame (title bar included) as drawn now, global logical.
    pub frame: Rectangle<f64, Logical>,
    /// How small it is drawn (1: its own size).
    pub small: f64,
    /// The ring may show (not in the overview: its highlight is its own).
    pub ring: bool,
}

/// A window's depth on one view: the edge in front of it, the shadow behind.
#[derive(Default)]
pub(crate) struct Sides {
    pub front: Option<DepthElement>,
    pub back: Option<DepthElement>,
}

/// What a side last drew, to know when its picture changed.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Look {
    area: Size<i32, Physical>,
    frame: Rectangle<f64, Physical>,
    radius: f64,
    shadow: Shadow,
    line: Line,
}

struct Slot {
    id: Id,
    commit: CommitCounter,
    look: Option<Look>,
}

impl Default for Slot {
    fn default() -> Self {
        Self {
            id: Id::new(),
            commit: CommitCounter::default(),
            look: None,
        }
    }
}

impl Slot {
    fn element(
        &mut self,
        program: &smithay::backend::renderer::gles::GlesPixelProgram,
        shape: &Shape,
    ) -> DepthElement {
        let look = Look {
            area: shape.area.size,
            frame: shape.frame,
            radius: shape.radius,
            shadow: shape.shadow,
            line: shape.line,
        };
        if self.look != Some(look) {
            self.commit.increment();
            self.look = Some(look);
        }
        DepthElement::new(self.id.clone(), self.commit, program.clone(), shape)
    }
}

/// Per window: its two sides and its focus fade.
#[derive(Default)]
pub(crate) struct Cache {
    front: Slot,
    back: Slot,
    focus: Option<Focus>,
}

impl Dashi {
    /// The window has the keyboard, or its sheet has.
    fn depth_focused(&self, id: WindowId) -> bool {
        let Some(focus) = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
        else {
            return false;
        };
        self.windows.entries().any(|entry| {
            (entry.id == id || entry.sheet_of == Some(id))
                && toplevel_surface(&entry.window).as_ref() == Some(&focus)
        })
    }
}

/// The view's whole-pixel rect for a global logical one.
fn on_view(
    rect: Rectangle<f64, Logical>,
    view: Rectangle<i32, Logical>,
    scale: Scale<f64>,
) -> Rectangle<f64, Physical> {
    let loc = (rect.loc - view.loc.to_f64()).to_physical(scale);
    let size = rect.size.to_physical(scale);
    Rectangle::new(
        (loc.x.round(), loc.y.round()).into(),
        (size.w.round(), size.h.round()).into(),
    )
}

/// Window `id`'s depth as `placed`, on a view of `view` (global logical) at `scale`.
pub(crate) fn window_depth(
    state: &mut Dashi,
    gles: &mut GlesRenderer,
    id: WindowId,
    placed: &Placement,
    view: Rectangle<i32, Logical>,
    scale: Scale<f64>,
) -> Sides {
    let style = state.window_style;
    if style == Style::default() {
        return Sides::default();
    }
    let Some(entry) = state.windows.get(id) else {
        return Sides::default();
    };
    let geometry_now = entry.window.geometry();
    let bbox = entry.window.bbox();
    let role = geometry::role(Facts {
        fullscreen: entry.fullscreen.is_some(),
        own_shadow: bbox.size.w > geometry_now.size.w || bbox.size.h > geometry_now.size.h,
        sheet: entry.sheet_of.is_some(),
        tiled: entry.tiled,
        filled: entry.maximized,
    });
    if role == Role::Bare {
        return Sides::default();
    }
    let framed = matches!(entry.decor, Decor::Standard | Decor::Unified);
    let radius = if framed {
        f64::from(state.chrome_style.radius.max(0))
    } else {
        0.0
    };
    let length = if state.chrome_style.reduce_motion {
        Duration::ZERO
    } else {
        style.fade
    };
    let focused = state.depth_focused(id);
    // A shadow stays on its window's own screen.
    let middle = placed.frame.loc + placed.frame.size.downscale(2.0).to_point();
    let own_screen = state
        .space
        .output_under(middle)
        .next()
        .and_then(|output| state.space.output_geometry(output));
    let Some(program) = element::program(gles) else {
        return Sides::default();
    };
    let Some(entry) = state.windows.get_mut(id) else {
        return Sides::default();
    };
    let cache = &mut entry.depth;
    let now = Instant::now();
    let focus = cache
        .focus
        .get_or_insert_with(|| Focus::settled(focused, now));
    focus.follow(focused, now, length);
    let lit = focus.value(now, length);

    let view_px = Rectangle::from_size(view.size.to_f64().to_physical(scale).to_i32_round());
    let frame_px = on_view(placed.frame, view, scale);
    let s = placed.small * scale.x;
    let radius_px = radius * s;
    let shadow = geometry::scaled(&geometry::shadow_for(&style, role, lit), s);
    let line = |line: Line, strength: f64| Line {
        color: {
            let [r, g, b, a] = line.color;
            [r, g, b, a * strength as f32]
        },
        width: line.width * scale.x,
    };
    // The ring takes the edge's place on the focused window, fading in as the edge fades out.
    let ringed = style.ring.shows() && placed.ring && role != Role::Sheet;
    let ring = ringed.then(|| line(style.ring, lit)).filter(|_| lit > 0.0);
    let edge = (style.edge.shows() && (role != Role::Filled || style.edge_filled))
        .then(|| line(style.edge, if ringed { 1.0 - lit } else { 1.0 }))
        .filter(Line::shows);

    let mut sides = Sides::default();
    if geometry::casts(&shadow) || ring.is_some() {
        let ring_width = ring.map_or(0.0, |ring| ring.width);
        let reach = geometry::outward(geometry::extent(frame_px, &shadow, ring_width));
        let screen = own_screen.map_or(Some(view_px), |own| {
            let own = Rectangle::new(
                (own.loc - view.loc).to_physical_precise_round(scale),
                own.size.to_physical_precise_round(scale),
            );
            own.intersection(view_px)
        });
        if let Some(area) = screen.and_then(|screen| reach.intersection(screen)) {
            let shape = Shape {
                side: Side::Back,
                area,
                frame: relative(frame_px, area),
                radius: radius_px,
                shadow,
                line: ring.unwrap_or_default(),
            };
            sides.back = Some(cache.back.element(&program, &shape));
        }
    }
    if let Some(edge) = edge
        && let Some(area) = geometry::outward(frame_px).intersection(view_px)
    {
        let shape = Shape {
            side: Side::Front,
            area,
            frame: relative(frame_px, area),
            radius: radius_px,
            shadow: Shadow::default(),
            line: edge,
        };
        sides.front = Some(cache.front.element(&program, &shape));
    }
    sides
}

fn relative(
    frame: Rectangle<f64, Physical>,
    area: Rectangle<i32, Physical>,
) -> Rectangle<f64, Physical> {
    Rectangle::new(frame.loc - area.loc.to_f64(), frame.size)
}
