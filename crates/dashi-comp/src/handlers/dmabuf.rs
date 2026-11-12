//! linux-dmabuf: GPU clients' buffers, imported by the backend's renderer.

use smithay::{
    backend::allocator::dmabuf::Dmabuf,
    delegate_dmabuf,
    wayland::dmabuf::{DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier},
};

use crate::state::Dashi;

impl DmabufHandler for Dashi {
    fn dmabuf_state(&mut self) -> &mut DmabufState {
        &mut self.dmabuf_state
    }

    fn dmabuf_imported(
        &mut self,
        _global: &DmabufGlobal,
        dmabuf: Dmabuf,
        notifier: ImportNotifier,
    ) {
        crate::backend::import_dmabuf(self, dmabuf, notifier);
    }
}

delegate_dmabuf!(Dashi);
