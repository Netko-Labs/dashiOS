//! One module per Wayland protocol: each turns a client's requests into state
//! changes; none decides policy (docs/conventions.md, "The Rule").

mod activation;
mod compositor;
mod decoration;
mod dmabuf;
mod layer_shell;
mod seat;
mod xdg_shell;
