//! Drawing: a solid buffer on a surface.

use std::os::fd::AsFd;

use wayland_client::{
    QueueHandle,
    protocol::{wl_shm, wl_surface},
};

use super::State;

/// Attach a solid buffer `size` big to `surface` and commit it.
pub(super) fn fill(
    surface: &wl_surface::WlSurface,
    shm: &wl_shm::WlShm,
    (width, height): (i32, i32),
    qh: &QueueHandle<State>,
) {
    let file = tempfile::tempfile().expect("an shm file");
    file.set_len((width * height * 4) as u64)
        .expect("shm pixels");
    let pool = shm.create_pool(file.as_fd(), width * height * 4, qh, ());
    let buffer = pool.create_buffer(
        0,
        width,
        height,
        width * 4,
        wl_shm::Format::Argb8888,
        qh,
        (),
    );
    pool.destroy();
    surface.attach(Some(&buffer), 0, 0);
    surface.commit();
}
