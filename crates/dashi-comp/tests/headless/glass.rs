//! Glass from a client's side (crates/dashi-comp/protocols/PROTOCOL.md): both
//! globals are there, each object hears whether its glass is drawn (never,
//! headless: nothing frosts without a GPU of its own), and a surface asked
//! twice is a protocol error.

use std::path::Path;

use serde_json::json;
use wayland_client::{
    Connection, Dispatch, EventQueue, QueueHandle, delegate_noop,
    globals::{GlobalListContents, registry_queue_init},
    protocol::{wl_compositor, wl_registry, wl_surface},
};
use wayland_protocols::ext::background_effect::v1::client::{
    ext_background_effect_manager_v1 as manager, ext_background_effect_surface_v1 as effect,
};

use crate::support::compositor::Compositor;

#[allow(
    dead_code,
    non_camel_case_types,
    non_upper_case_globals,
    unused_imports
)]
#[allow(clippy::all)]
mod chrome {
    use wayland_client;
    use wayland_client::protocol::*;
    use wayland_protocols::xdg::shell::client::*;

    pub mod __interfaces {
        use wayland_client::protocol::__interfaces::*;
        use wayland_protocols::xdg::shell::client::__interfaces::*;
        wayland_scanner::generate_interfaces!("protocols/dashi-chrome-v1.xml");
    }
    use self::__interfaces::*;

    wayland_scanner::generate_client_code!("protocols/dashi-chrome-v1.xml");
}

use chrome::{dashi_chrome_manager_v1 as chrome_manager, dashi_glass_v1 as glass};

#[derive(Default)]
struct Heard {
    capabilities: Vec<u32>,
    drawing: Vec<u32>,
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for Heard {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<manager::ExtBackgroundEffectManagerV1, ()> for Heard {
    fn event(
        heard: &mut Self,
        _: &manager::ExtBackgroundEffectManagerV1,
        event: manager::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let manager::Event::Capabilities { flags } = event {
            heard.capabilities.push(flags.into());
        }
    }
}

impl Dispatch<glass::DashiGlassV1, ()> for Heard {
    fn event(
        heard: &mut Self,
        _: &glass::DashiGlassV1,
        event: glass::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let glass::Event::Drawing { drawing } = event {
            heard.drawing.push(drawing.into());
        }
    }
}

delegate_noop!(Heard: ignore wl_compositor::WlCompositor);
delegate_noop!(Heard: ignore wl_surface::WlSurface);
delegate_noop!(Heard: ignore effect::ExtBackgroundEffectSurfaceV1);
delegate_noop!(Heard: ignore chrome_manager::DashiChromeManagerV1);

struct Glassy {
    queue: EventQueue<Heard>,
    heard: Heard,
    surface: wl_surface::WlSurface,
    effects: manager::ExtBackgroundEffectManagerV1,
    chrome: chrome_manager::DashiChromeManagerV1,
}

impl Glassy {
    fn connect(runtime_dir: &Path, display: &str) -> Self {
        let stream = std::os::unix::net::UnixStream::connect(runtime_dir.join(display)).unwrap();
        let connection = Connection::from_socket(stream).unwrap();
        let (globals, queue) = registry_queue_init::<Heard>(&connection).unwrap();
        let qh = queue.handle();
        let compositor: wl_compositor::WlCompositor = globals.bind(&qh, 1..=6, ()).unwrap();
        let effects = globals.bind(&qh, 1..=1, ()).unwrap();
        let chrome = globals.bind(&qh, 2..=2, ()).unwrap();
        let surface = compositor.create_surface(&qh, ());
        let mut glassy = Self {
            queue,
            heard: Heard::default(),
            surface,
            effects,
            chrome,
        };
        glassy.roundtrip().unwrap();
        glassy
    }

    fn roundtrip(&mut self) -> Result<usize, wayland_client::DispatchError> {
        self.queue.roundtrip(&mut self.heard)
    }
}

fn display(compositor: &Compositor) -> String {
    let mut ipc = compositor.connect();
    let session = ipc.request("session", json!({}))["result"].clone();
    session["waylandDisplay"].as_str().unwrap().to_owned()
}

#[test]
fn a_client_hears_its_glass_is_not_drawn_where_nothing_frosts() {
    let compositor = Compositor::start(&[]);
    let display = display(&compositor);
    let mut client = Glassy::connect(compositor.dir.path(), &display);
    assert_eq!(client.heard.capabilities, vec![0]);
    let qh = client.queue.handle();
    let glass = client.chrome.get_glass(&client.surface, &qh, ());
    let _effect = client
        .effects
        .get_background_effect(&client.surface, &qh, ());
    glass.add_pane(0, 0, 200, 40, 10, glass::Level::Thin);
    client.surface.commit();
    client.roundtrip().unwrap();
    assert_eq!(client.heard.drawing, vec![glass::Drawing::None as u32]);
    // A style arrives: still nothing frosts headless, and nothing is said again.
    let mut ipc = compositor.connect();
    let style = ipc.request("glass-style", style());
    assert_eq!(style["result"], json!({ "frosted": false }));
    client.roundtrip().unwrap();
    assert_eq!(client.heard.drawing.len(), 1);
    assert_eq!(client.heard.capabilities, vec![0]);
}

#[test]
fn a_surface_has_one_glass_and_one_effect() {
    let compositor = Compositor::start(&[]);
    let display = display(&compositor);
    let mut client = Glassy::connect(compositor.dir.path(), &display);
    let qh = client.queue.handle();
    client.chrome.get_glass(&client.surface, &qh, ());
    client.chrome.get_glass(&client.surface, &qh, ());
    assert!(client.roundtrip().is_err(), "glass_exists");

    let mut client = Glassy::connect(compositor.dir.path(), &display);
    let qh = client.queue.handle();
    let _first = client
        .effects
        .get_background_effect(&client.surface, &qh, ());
    let _second = client
        .effects
        .get_background_effect(&client.surface, &qh, ());
    assert!(client.roundtrip().is_err(), "background_effect_exists");

    let mut client = Glassy::connect(compositor.dir.path(), &display);
    let qh = client.queue.handle();
    let glass = client.chrome.get_glass(&client.surface, &qh, ());
    glass.add_pane(0, 0, -5, 40, 10, glass::Level::Thin);
    assert!(client.roundtrip().is_err(), "invalid_pane");
}

fn style() -> serde_json::Value {
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test/fixtures/ipc/methods.json");
    let methods: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(fixtures).unwrap()).unwrap();
    methods["glass-style"]["params"].clone()
}
