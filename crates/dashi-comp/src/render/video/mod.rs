//! Live video the shell places inside a window (`video-views`): a PipeWire
//! stream (dashi-camera's preview) drawn over a rect of the window's content,
//! in the window's own place among the windows (a window in front covers it,
//! its popups and lights are over it), with rounded corners and holes where
//! the app's controls over the picture show through. mirin can't show live
//! video, so the Camera app leaves the rect for this, as the launcher leaves
//! rects for `window-thumbnails`; the shell decides which window shows which
//! stream (docs/camera.md), the compositor only plays and draws it.
//!
//! A stream plays while a view names it and stops when none does (its
//! pipeline set to Null), so the preview is not read by anyone once the
//! Camera window closes. `video-source {source, ok, error?}` says when one
//! began to play or failed.

mod element;
mod player;

use std::collections::HashMap;

use serde_json::{Map, Value, json};
use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            ImportMem, Renderer,
            element::{
                Kind,
                memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement},
            },
        },
    },
    reexports::calloop::{RegistrationToken, channel},
    utils::{Logical, Physical, Point, Rectangle, Scale, Size, Transform},
};

pub(crate) use element::VideoElement;

use crate::{render::GlesAccess, state::Dashi, wallpaper::VideoFrame, wm::WindowId};

/// Views in one request, and holes in one view.
const MOST: usize = 8;
pub(crate) const HOLES: usize = 8;

/// A hole in a view, logical pixels from the view's top-left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Hole {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub radius: f32,
}

/// One view: a stream in a rect of a window's content (logical, from the content's top-left).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct View {
    pub window: WindowId,
    pub source: String,
    pub rect: Rectangle<i32, Logical>,
    /// Radii: top-left, top-right, bottom-right, bottom-left.
    pub corners: [f32; 4],
    pub holes: Vec<Hole>,
    pub mirror: bool,
}

/// A stream being played and its latest frame.
struct Source {
    _player: player::Player,
    tokens: Vec<RegistrationToken>,
    shown: Option<(MemoryRenderBuffer, (i32, i32))>,
}

#[derive(Default)]
pub(crate) struct VideoViews {
    views: Vec<View>,
    sources: HashMap<String, Source>,
}

fn number(value: Option<&Value>, what: &str, min: f64, max: f64) -> Result<f64, String> {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && *v >= min && *v <= max)
        .ok_or(format!("`{what}` must be a number from {min} to {max}"))
}

const LIMIT: f64 = 16384.0;

fn parse_hole(value: &Value) -> Result<Hole, String> {
    let hole = value.as_object().ok_or("each hole must be an object")?;
    let w = number(hole.get("w"), "w", 0.0, LIMIT)?;
    let h = number(hole.get("h"), "h", 0.0, LIMIT)?;
    let radius = match hole.get("radius") {
        None => 0.0,
        some => number(some, "radius", 0.0, LIMIT)?,
    };
    Ok(Hole {
        x: number(hole.get("x"), "x", -LIMIT, LIMIT)? as f32,
        y: number(hole.get("y"), "y", -LIMIT, LIMIT)? as f32,
        w: w as f32,
        h: h as f32,
        radius: radius.min(w / 2.0).min(h / 2.0) as f32,
    })
}

fn parse_view(value: &Value) -> Result<View, String> {
    let view = value.as_object().ok_or("each view must be an object")?;
    let window = view
        .get("window")
        .and_then(Value::as_u64)
        .ok_or("`window` must be a window id")?;
    let source = view
        .get("source")
        .and_then(Value::as_str)
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 128
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-:@/".contains(c))
        })
        .ok_or("`source` must be a PipeWire node name")?
        .to_string();
    let x = number(view.get("x"), "x", -LIMIT, LIMIT)?.round() as i32;
    let y = number(view.get("y"), "y", -LIMIT, LIMIT)?.round() as i32;
    let w = number(view.get("w"), "w", 1.0, LIMIT)?.round() as i32;
    let h = number(view.get("h"), "h", 1.0, LIMIT)?.round() as i32;
    let corners =
        match view.get("radius") {
            None => [0.0; 4],
            Some(Value::Array(list)) if list.len() == 4 => {
                let mut corners = [0.0f32; 4];
                for (corner, value) in corners.iter_mut().zip(list) {
                    *corner = number(Some(value), "radius", 0.0, 256.0)? as f32;
                }
                corners
            }
            Some(_) => return Err(
                "`radius` must be four numbers (top-left, top-right, bottom-right, bottom-left)"
                    .into(),
            ),
        };
    let holes = match view.get("holes") {
        None => Vec::new(),
        Some(Value::Array(list)) if list.len() <= HOLES => {
            list.iter().map(parse_hole).collect::<Result<_, _>>()?
        }
        Some(_) => return Err(format!("`holes` must be a list of at most {HOLES}")),
    };
    let mirror = match view.get("mirror") {
        None => false,
        Some(value) => value.as_bool().ok_or("`mirror` must be true or false")?,
    };
    Ok(View {
        window,
        source,
        rect: Rectangle::new((x, y).into(), (w.max(1), h.max(1)).into()),
        corners,
        holes,
        mirror,
    })
}

/// `video-views {views: [...]}`, checked whole: any bad view refuses the request.
pub(crate) fn parse_views(params: &Map<String, Value>) -> Result<Vec<View>, String> {
    let list = params
        .get("views")
        .and_then(Value::as_array)
        .ok_or("`views` must be a list")?;
    if list.len() > MOST {
        return Err(format!("at most {MOST} views"));
    }
    list.iter().map(parse_view).collect()
}

/// The part of a `buffer`-sized frame that fills a `rect`-shaped view (cut to its shape, centered),
/// in buffer pixels.
pub(crate) fn cover(buffer: (i32, i32), rect: Size<i32, Logical>) -> Rectangle<f64, Logical> {
    let (bw, bh) = (f64::from(buffer.0.max(1)), f64::from(buffer.1.max(1)));
    let (w, h) = (f64::from(rect.w.max(1)), f64::from(rect.h.max(1)));
    let by = (w / bw).max(h / bh);
    let (sw, sh) = (w / by, h / by);
    Rectangle::new(((bw - sw) / 2.0, (bh - sh) / 2.0).into(), (sw, sh).into())
}

impl Dashi {
    /// `video-views {views}`: replaces every view; streams no view names stop.
    pub(crate) fn set_video_views(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let views = parse_views(params)?;
        for view in &views {
            if !self.video_views.sources.contains_key(&view.source) {
                self.play_source(&view.source)?;
            }
        }
        self.video_views.views = views;
        self.drop_unviewed_sources();
        Ok(())
    }

    /// A window closed: its views go, and the streams only they showed stop.
    pub(crate) fn forget_video_views(&mut self, window: WindowId) {
        let before = self.video_views.views.len();
        self.video_views.views.retain(|view| view.window != window);
        if self.video_views.views.len() != before {
            self.drop_unviewed_sources();
        }
    }

    fn drop_unviewed_sources(&mut self) {
        let named: Vec<String> = self
            .video_views
            .views
            .iter()
            .map(|v| v.source.clone())
            .collect();
        let gone: Vec<String> = self
            .video_views
            .sources
            .keys()
            .filter(|name| !named.contains(name))
            .cloned()
            .collect();
        for name in gone {
            if let Some(source) = self.video_views.sources.remove(&name) {
                for token in source.tokens {
                    self.loop_handle.remove(token);
                }
            }
        }
    }

    fn play_source(&mut self, name: &str) -> Result<(), String> {
        let (frames, frame_source) = channel::sync_channel::<VideoFrame>(1);
        let (status, status_source) = channel::channel::<player::Status>();
        let player = player::Player::start(name, frames, status)?;
        let key = name.to_string();
        let frame_token = self.loop_handle.insert_source(frame_source, {
            let key = key.clone();
            move |event, _, state| {
                let channel::Event::Msg(frame) = event else {
                    return;
                };
                if let Some(source) = state.video_views.sources.get_mut(&key) {
                    show(&mut source.shown, frame);
                }
            }
        });
        let status_token = self.loop_handle.insert_source(status_source, {
            let key = key.clone();
            move |event, _, state| {
                let channel::Event::Msg(status) = event else {
                    return;
                };
                match status {
                    player::Status::Playing => state
                        .ipc
                        .emit("video-source", json!({ "source": key, "ok": true })),
                    player::Status::Failed(error) => {
                        tracing::warn!(source = key, error, "a video view's stream stopped");
                        state.ipc.emit(
                            "video-source",
                            json!({ "source": key, "ok": false, "error": error }),
                        );
                    }
                }
            }
        });
        let tokens = [frame_token.ok(), status_token.ok()]
            .into_iter()
            .flatten()
            .collect();
        self.video_views.sources.insert(
            key,
            Source {
                _player: player,
                tokens,
                shown: None,
            },
        );
        Ok(())
    }

    /// The views on `window` with a frame to show, front to back, for a window
    /// whose content's top-left is at `content` (physical, on the view being drawn).
    pub(crate) fn video_elements<R>(
        &self,
        renderer: &mut R,
        window: WindowId,
        content: Point<f64, Physical>,
        scale: Scale<f64>,
    ) -> Vec<VideoElement<R>>
    where
        R: Renderer + ImportMem + GlesAccess,
        R::TextureId: Clone + Send + 'static,
    {
        if !self
            .video_views
            .views
            .iter()
            .any(|view| view.window == window)
        {
            return Vec::new();
        }
        let Some(program) = element::program(renderer.gles()) else {
            return Vec::new();
        };
        let mut drawn = Vec::new();
        for view in self
            .video_views
            .views
            .iter()
            .filter(|view| view.window == window)
            .rev()
        {
            let Some((buffer, size)) = self
                .video_views
                .sources
                .get(&view.source)
                .and_then(|source| source.shown.as_ref())
            else {
                continue;
            };
            let src = cover(*size, view.rect.size);
            let crop = [
                (src.loc.x / f64::from(size.0.max(1))) as f32,
                (src.loc.y / f64::from(size.1.max(1))) as f32,
                (src.size.w / f64::from(size.0.max(1))) as f32,
                (src.size.h / f64::from(size.1.max(1))) as f32,
            ];
            let at = content + view.rect.loc.to_f64().to_physical(scale);
            let Ok(inner) = MemoryRenderBufferRenderElement::from_buffer(
                renderer,
                at,
                buffer,
                None,
                Some(Rectangle::new(
                    Point::from((src.loc.x, src.loc.y)),
                    Size::from((src.size.w, src.size.h)),
                )),
                Some(view.rect.size),
                Kind::Unspecified,
            ) else {
                continue;
            };
            drawn.push(VideoElement {
                inner,
                program: program.clone(),
                width: f64::from(view.rect.size.w),
                corners: view.corners,
                holes: view.holes.clone(),
                mirror: view.mirror,
                crop,
            });
        }
        drawn
    }
}

/// A frame into the source's buffer: drawn in place when the size is the same.
fn show(shown: &mut Option<(MemoryRenderBuffer, (i32, i32))>, frame: VideoFrame) {
    let size = (frame.width, frame.height);
    if let Some((buffer, at)) = shown.as_mut()
        && *at == size
    {
        let _ = buffer.render().draw(|pixels| {
            let n = pixels.len().min(frame.rgba.len());
            pixels[..n].copy_from_slice(&frame.rgba[..n]);
            Ok::<_, ()>(vec![Rectangle::from_size(size.into())])
        });
        return;
    }
    let buffer = MemoryRenderBuffer::from_slice(
        &frame.rgba,
        Fourcc::Abgr8888,
        size,
        1,
        Transform::Normal,
        None,
    );
    *shown = Some((buffer, size));
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn views_are_checked() {
        let ok = params(json!({ "views": [{
            "window": 4, "source": "dashi-camera-preview", "x": 0, "y": 52, "w": 960, "h": 540,
            "radius": [0, 0, 10, 10], "mirror": true,
            "holes": [{ "x": 448, "y": 460, "w": 64, "h": 64, "radius": 40 }]
        }] }));
        let views = parse_views(&ok).expect("a view");
        assert_eq!(views[0].window, 4);
        assert_eq!(
            views[0].rect,
            Rectangle::new((0, 52).into(), (960, 540).into())
        );
        assert_eq!(views[0].corners, [0.0, 0.0, 10.0, 10.0]);
        assert!(views[0].mirror);
        assert_eq!(
            views[0].holes[0].radius, 32.0,
            "a radius no more than half the hole"
        );
        assert_eq!(parse_views(&params(json!({ "views": [] }))), Ok(vec![]));
        for bad in [
            json!({}),
            json!({ "views": [{ "window": 4, "source": "a b", "x": 0, "y": 0, "w": 9, "h": 9 }] }),
            json!({ "views": [{ "window": -4, "source": "s", "x": 0, "y": 0, "w": 9, "h": 9 }] }),
            json!({ "views": [{ "window": 4, "source": "s", "x": 0, "y": 0, "w": 0, "h": 9 }] }),
            json!({ "views": [{ "window": 4, "source": "s", "x": 0, "y": 0, "w": 9, "h": 9, "radius": [1, 2] }] }),
            json!({ "views": [{ "window": 4, "source": "s", "x": 0, "y": 0, "w": 9, "h": 9, "holes": [{ "x": 0, "y": 0, "w": -1, "h": 1 }] }] }),
            json!({ "views": [{ "window": 4, "source": "s", "x": 0, "y": 0, "w": 9, "h": 9, "mirror": "yes" }] }),
            json!({ "views": (0..9).map(|_| json!({ "window": 4, "source": "s", "x": 0, "y": 0, "w": 9, "h": 9 })).collect::<Vec<_>>() }),
        ] {
            assert!(parse_views(&params(bad.clone())).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_frame_covers_its_view() {
        // A 16:9 frame in a 4:3 view: the sides are cut.
        let wide = cover((1280, 720), Size::from((960, 720)));
        assert_eq!((wide.size.w, wide.size.h), (960.0, 720.0));
        assert_eq!((wide.loc.x, wide.loc.y), (160.0, 0.0));
        // A 16:9 frame in a wider view: top and bottom are cut.
        let tall = cover((1280, 720), Size::from((1280, 540)));
        assert_eq!((tall.size.w, tall.size.h), (1280.0, 540.0));
        assert_eq!(tall.loc.y, 90.0);
    }
}
