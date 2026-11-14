//! `capture`: a screen, a rectangle of it, or one window, rendered offscreen
//! the way it is shown and saved as a PNG for the shell (⇧❖3, ⇧❖4, an agent's
//! look at the screen). Only the session's own client may ask
//! (ipc/table.rs); the file must be new, absolute, and end in `.png`.

use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            Bind, ExportMem, ImportAll, ImportMem, Offscreen, Renderer, TextureMapping,
            damage::OutputDamageTracker, gles::GlesTexture,
        },
    },
    utils::{Rectangle, Transform},
};

use super::{
    GlesAccess,
    scene::{View, view_elements},
};
use crate::state::Dashi;

/// Pixels, straight RGBA, row by row from the top.
pub(crate) struct Picture {
    pub width: i32,
    pub height: i32,
    pub rgba: Vec<u8>,
}

/// Render `view` offscreen and read it back.
pub(crate) fn render_view<R>(
    state: &mut Dashi,
    renderer: &mut R,
    view: &View<'_>,
) -> Result<Picture, String>
where
    R: Renderer
        + ImportAll
        + ImportMem
        + GlesAccess
        + ExportMem
        + Offscreen<GlesTexture>
        + Bind<GlesTexture>,
    R::TextureId: Clone + Send + 'static,
{
    let size = view
        .area
        .size
        .to_f64()
        .to_physical(view.scale)
        .to_i32_round();
    let elements = view_elements(state, renderer, view);
    let clear = if view.only.is_some() {
        [0.0; 4]
    } else {
        crate::backend::BACKGROUND
    };
    render_offscreen(renderer, size, view.scale, &elements, clear)
}

/// A screen that mirrors another, as it shows now (its source's picture and
/// the bars), at its own pixels.
pub(crate) fn render_mirror<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output: &smithay::output::Output,
    cursor: bool,
) -> Result<Picture, String>
where
    R: Renderer
        + ImportAll
        + ImportMem
        + GlesAccess
        + ExportMem
        + Offscreen<GlesTexture>
        + Bind<GlesTexture>,
    R::TextureId: Clone + Send + 'static,
{
    let size = crate::outputs::drawn_size(output).ok_or("that screen has no mode")?;
    let elements = super::output_elements(state, renderer, output, cursor);
    // Its scale is the picture's while it mirrors (render/mirror.rs).
    let scale = output.current_scale().fractional_scale();
    render_offscreen(
        renderer,
        size,
        scale.into(),
        &elements,
        crate::backend::BACKGROUND,
    )
}

/// Draw `elements` into a new texture `size` pixels across and read it back.
fn render_offscreen<R>(
    renderer: &mut R,
    size: smithay::utils::Size<i32, smithay::utils::Physical>,
    scale: smithay::utils::Scale<f64>,
    elements: &[super::DashiElement<R>],
    clear: [f32; 4],
) -> Result<Picture, String>
where
    R: Renderer
        + ImportAll
        + ImportMem
        + GlesAccess
        + ExportMem
        + Offscreen<GlesTexture>
        + Bind<GlesTexture>,
    R::TextureId: Clone + Send + 'static,
{
    if size.w <= 0 || size.h <= 0 || size.w > 16384 || size.h > 16384 {
        return Err("nothing to capture there".into());
    }
    let buffer_size = size.to_logical(1).to_buffer(1, Transform::Normal);
    let mut texture: GlesTexture = renderer
        .create_buffer(Fourcc::Abgr8888, buffer_size)
        .map_err(|error| format!("no offscreen buffer: {error:?}"))?;
    let mut framebuffer = renderer
        .bind(&mut texture)
        .map_err(|error| format!("{error:?}"))?;
    let mut damage = OutputDamageTracker::new(size, scale, Transform::Normal);
    damage
        .render_output(renderer, &mut framebuffer, 0, elements, clear)
        .map_err(|error| format!("rendering the capture: {error:?}"))?;
    let mapping = renderer
        .copy_framebuffer(
            &framebuffer,
            Rectangle::from_size(buffer_size),
            Fourcc::Abgr8888,
        )
        .map_err(|error| format!("reading the capture back: {error:?}"))?;
    // GL stores an offscreen texture bottom-up; the mapping says when it is not.
    let flipped = !mapping.flipped();
    let bytes = renderer
        .map_texture(&mapping)
        .map_err(|error| format!("{error:?}"))?
        .to_vec();
    Ok(Picture {
        width: size.w,
        height: size.h,
        rgba: straighten(&bytes, size.w as usize, flipped),
    })
}

/// Premultiplied, maybe bottom-up rows to straight alpha, top-down.
fn straighten(bytes: &[u8], width: usize, flipped: bool) -> Vec<u8> {
    let stride = width * 4;
    let rows: Vec<&[u8]> = bytes.chunks_exact(stride).collect();
    let ordered: Box<dyn Iterator<Item = &&[u8]>> = if flipped {
        Box::new(rows.iter().rev())
    } else {
        Box::new(rows.iter())
    };
    let mut out = Vec::with_capacity(bytes.len());
    for row in ordered {
        for px in row.as_chunks::<4>().0 {
            let alpha = px[3];
            if alpha == 0 || alpha == 255 {
                out.extend_from_slice(px);
            } else {
                let un = |c: u8| {
                    ((u16::from(c) * 255 + u16::from(alpha) / 2) / u16::from(alpha)).min(255) as u8
                };
                out.extend_from_slice(&[un(px[0]), un(px[1]), un(px[2]), alpha]);
            }
        }
    }
    out
}

/// Copy `picture` into a client's shm buffer (Xrgb8888 or Argb8888, which is
/// B, G, R, A in memory); false when the buffer does not fit it.
pub(crate) fn copy_to_shm(
    picture: &Picture,
    buffer: &smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer,
) -> bool {
    use smithay::{
        reexports::wayland_server::protocol::wl_shm, wayland::shm::with_buffer_contents_mut,
    };
    let copied = with_buffer_contents_mut(buffer, |ptr, len, info| {
        let (w, h, stride) = (info.width, info.height, info.stride);
        if w != picture.width
            || h != picture.height
            || info.format != wl_shm::Format::Xrgb8888 && info.format != wl_shm::Format::Argb8888
            || w <= 0
            || h <= 0
            || stride < w * 4
        {
            return false;
        }
        let needed = (info.offset + stride * (h - 1) + w * 4) as usize;
        if needed > len {
            return false;
        }
        // SAFETY: the pool is mapped for `len` bytes and only written within `needed`.
        let pool = unsafe { std::slice::from_raw_parts_mut(ptr, len) };
        for y in 0..h as usize {
            let row = info.offset as usize + y * stride as usize;
            for x in 0..w as usize {
                let src = (y * w as usize + x) * 4;
                let rgba = &picture.rgba[src..src + 4];
                pool[row + x * 4..row + x * 4 + 4]
                    .copy_from_slice(&[rgba[2], rgba[1], rgba[0], rgba[3]]);
            }
        }
        true
    });
    matches!(copied, Ok(true))
}

/// Where a window is (its outer frame) and the screen whose scale it is drawn at.
pub(crate) fn window_area(
    state: &Dashi,
    window: &smithay::desktop::Window,
) -> Result<
    (
        smithay::utils::Rectangle<i32, smithay::utils::Logical>,
        smithay::output::Output,
    ),
    String,
> {
    // On a Space that does not show, it is pictured where it waits there.
    let frame = crate::wm::frame_of(state, window)
        .or_else(|| crate::wm::away_frame(state, window))
        .ok_or("that window is not on screen")?;
    let center = frame.loc.to_f64() + frame.size.to_f64().downscale(2.0).to_point();
    let output = state
        .space
        .output_under(center)
        .next()
        .or_else(|| state.space.outputs().next())
        .cloned()
        .ok_or("no screen")?;
    Ok((frame, output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_come_out_top_down_and_straight() {
        // Two rows of one pixel: top red (opaque), bottom half-transparent white (premultiplied).
        let bottom_up = [128, 128, 128, 128, 255, 0, 0, 255];
        assert_eq!(
            straighten(&bottom_up, 1, true),
            vec![255, 0, 0, 255, 255, 255, 255, 128]
        );
        assert_eq!(straighten(&bottom_up, 1, false)[..4], [255, 255, 255, 128]);
    }
}
