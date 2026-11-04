//! One module per Wayland protocol: each turns a client's requests into state
//! changes; none decides policy (docs/conventions.md, "The Rule").

mod activation;
mod compositor;
mod decoration;
mod dmabuf;
pub(crate) mod inhibit;
pub(crate) mod layer_regions;
mod layer_shell;
pub(crate) mod pointer;
mod seat;
pub(crate) mod security;
pub(crate) mod surface;
pub(crate) mod sync;
pub(crate) mod text;
pub(crate) mod toplevel_meta;
mod xdg_shell;
