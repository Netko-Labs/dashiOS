//! The pointer's pictures: the agent's pointer, the app's cursor and a drag's icon.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            Kind,
            memory::MemoryRenderBufferRenderElement,
            surface::{WaylandSurfaceRenderElement, render_elements_from_surface_tree},
        },
    },
    input::pointer::{CursorImageStatus, CursorImageSurfaceData},
    utils::{Logical, Point, Rectangle, Scale},
    wayland::compositor::with_states,
};

use crate::{
    render::{DashiElement, rounded::GlesAccess},
    state::Dashi,
};

pub(super) fn cursor_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output_geo: Rectangle<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    // The agent's pointer, over everything, while it acts.
    if let Some((at, label)) = state.agent.pointer.clone()
        && output_geo.to_f64().contains(at)
    {
        let s = scale.x.ceil() as i32;
        let fresh = state
            .agent_cursor
            .as_ref()
            .is_none_or(|(l, sc, _)| l != &label || *sc != s);
        if fresh {
            let image = crate::render::cursor::agent_pointer(&label, s, &mut state.text);
            state.agent_cursor = Some((label, s, image));
        }
        if let Some((_, _, image)) = &state.agent_cursor {
            let tip = crate::render::cursor::AGENT_TIP;
            let origin =
                (at - output_geo.loc.to_f64() - Point::from((tip, tip))).to_physical(scale);
            if let Ok(element) = MemoryRenderBufferRenderElement::from_buffer(
                renderer,
                origin,
                image,
                None,
                None,
                None,
                Kind::Cursor,
            ) {
                elements.push(DashiElement::Memory(element));
            }
        }
    }
    let Some(pointer) = state.seat.get_pointer() else {
        return;
    };
    let at = pointer.current_location();
    if !output_geo.to_f64().contains(at) {
        return;
    }
    // An agent acting on the person's seat moves its pointer too: one pointer
    // is drawn there, the agent's, not the app's cursor stacked on it.
    let agent_there = state
        .agent
        .pointer
        .as_ref()
        .is_some_and(|(agent, _)| (agent.x - at.x).abs() < 1.0 && (agent.y - at.y).abs() < 1.0);
    if agent_there {
        return;
    }
    let local = at - output_geo.loc.to_f64();
    let shown = match state.resize_cursor {
        Some(icon) => CursorImageStatus::Named(icon),
        None => state.cursor_status.clone(),
    };
    match &shown {
        CursorImageStatus::Hidden => {}
        CursorImageStatus::Surface(surface) => {
            let hotspot = with_states(surface, |states| {
                states
                    .data_map
                    .get::<CursorImageSurfaceData>()
                    .and_then(|data| data.lock().ok().map(|data| data.hotspot))
                    .unwrap_or_default()
            });
            let origin = (local - hotspot.to_f64()).to_physical(scale).to_i32_round();
            elements.extend(
                render_elements_from_surface_tree::<_, WaylandSurfaceRenderElement<R>>(
                    renderer,
                    surface,
                    origin,
                    scale,
                    1.0,
                    Kind::Cursor,
                )
                .into_iter()
                .map(DashiElement::Surface),
            );
        }
        CursorImageStatus::Named(icon) => {
            let image = state.cursors.get(icon.name(), scale.x.ceil() as i32);
            let origin = (local - image.hotspot.to_f64()).to_physical(scale);
            if let Ok(element) = MemoryRenderBufferRenderElement::from_buffer(
                renderer,
                origin,
                &image.buffer,
                None,
                None,
                None,
                Kind::Cursor,
            ) {
                elements.push(DashiElement::Memory(element));
            }
        }
    }
    // A drag's icon, under the pointer (the client placed it with its attach offsets).
    if let Some((icon, offset)) = &state.dnd_icon
        && smithay::reexports::wayland_server::Resource::is_alive(icon)
    {
        let origin = (local + offset.to_f64()).to_physical(scale).to_i32_round();
        elements.extend(
            render_elements_from_surface_tree::<_, WaylandSurfaceRenderElement<R>>(
                renderer,
                icon,
                origin,
                scale,
                1.0,
                Kind::Unspecified,
            )
            .into_iter()
            .map(DashiElement::Surface),
        );
    }
}
