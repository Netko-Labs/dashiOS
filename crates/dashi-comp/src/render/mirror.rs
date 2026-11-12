//! A screen that mirrors another (outputs/mirror.rs): the source's picture,
//! drawn as the source shows it (its windows, layers, wallpaper and
//! pointer), scaled to fit and centered, with black bars where the shapes
//! differ. The bars are in front, so nothing beside the source in the space
//! shows through them.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{Kind, solid::SolidColorRenderElement},
    },
    output::{Output, Scale},
    utils::{Physical, Point, Rectangle, Size},
};

use super::{
    DashiElement, GlesAccess,
    scene::{View, view_elements},
};
use crate::{
    outputs::{MIRROR_BAR, drawn_size, letterbox, mirror_bars},
    state::Dashi,
};

pub(crate) fn mirror_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    target: &Output,
    with_cursor: bool,
) -> Vec<DashiElement<R>>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let Some(name) = state.mirrors.source_of(target).map(str::to_owned) else {
        return Vec::new();
    };
    let Some(source) = state.space.outputs().find(|o| o.name() == name).cloned() else {
        return Vec::new();
    };
    let (Some(screen), Some(size)) = (state.space.output_geometry(&source), drawn_size(target))
    else {
        return Vec::new();
    };
    let (scale, at) = letterbox(screen.size, size);
    // The renderer sizes elements by the screen's scale: while it mirrors, that is the picture's.
    if (target.current_scale().fractional_scale() - scale).abs() > 1e-9 {
        target.change_current_state(None, None, Some(Scale::Fractional(scale)), None);
    }
    // The area of the space the target shows: the source's, widened by the
    // bars (whole points; the bars cover what lies past the source).
    let before = Point::from(((at.x / scale).floor() as i32, (at.y / scale).floor() as i32));
    let area = Rectangle::new(
        screen.loc - before,
        (
            (f64::from(size.w) / scale).ceil() as i32,
            (f64::from(size.h) / scale).ceil() as i32,
        )
            .into(),
    );
    let view = View {
        area,
        scale: scale.into(),
        output: &source,
        cursor: with_cursor,
        only: None,
        // Title bars as the source draws them, not again at this scale each frame.
        decor_scale: Some(source.current_scale().fractional_scale().ceil() as i32),
    };
    let mut elements = view_elements(state, renderer, &view);
    let picture: Rectangle<i32, Physical> = Rectangle::new(
        Point::<f64, Physical>::from((f64::from(before.x) * scale, f64::from(before.y) * scale))
            .to_i32_round(),
        Size::<f64, Physical>::from((
            f64::from(screen.size.w) * scale,
            f64::from(screen.size.h) * scale,
        ))
        .to_i32_round(),
    );
    let Some(mirror) = state.mirrors.of_mut(target) else {
        return elements;
    };
    let bars: Vec<DashiElement<R>> = mirror
        .bars
        .iter_mut()
        .zip(mirror_bars(picture, size))
        .filter(|(_, rect)| rect.size.w > 0 && rect.size.h > 0)
        .map(|(buffer, rect)| {
            // A solid element is sized where it is made (scale 1: its pixels), not by the screen's scale.
            buffer.update(rect.size.to_logical(1), MIRROR_BAR);
            DashiElement::Solid(SolidColorRenderElement::from_buffer(
                buffer,
                rect.loc,
                1.0,
                1.0,
                Kind::Unspecified,
            ))
        })
        .collect();
    elements.splice(0..0, bars);
    elements
}
