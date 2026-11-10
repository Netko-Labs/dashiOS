//! A seat of its own: DRM/KMS screens on GBM and GLES, input from libinput,
//! and the session from libseat (so VT switching and suspend work). Adapted
//! from smithay's anvil example (MIT, github.com/Smithay/smithay, v0.7.0),
//! without leasing, explicit sync, and presentation feedback (C4).
//!
//! The GPU is `DASHI_DRM_DEVICE` when set (dashi-session picks the one that
//! drives a screen, packages/shell/bin/dashi-gpu.ts), else the seat's primary.
//! Every other GPU is open only while something needs it (sleep.rs), and
//! probed off the event loop before each opening (probe.rs).

mod controls;
mod devices;
mod edid;
mod feedback;
mod flip;
mod frame;
mod gone;
mod holds;
mod imports;
mod input_devices;
mod lifecycle;
mod pace;
mod probe;
mod screens;
mod sleep;
mod start;
mod state;
mod vrr;
mod watchdog;

pub(crate) use controls::power;
pub(crate) use frame::wake_screens;
pub(crate) use holds::describe_gpus;
pub(crate) use imports::import_dmabuf;
pub(crate) use pace::agent_acted;
pub(crate) use sleep::keep_gpu;
pub(crate) use start::init;
pub(crate) use state::{Serial, UdevData};
pub(crate) use vrr::VrrReport;

use devices::{
    advertise_formats, device_added, device_removed, is_drawing_gpu, offer_explicit_sync,
};
use frame::{frame_finished, render_device, render_screen};
use screens::{apply_gamma, connector_disconnected, scan_connectors};
use state::{Device, Gpus, SCANOUT_FORMATS, Screen, ScreenId, UdevRenderer, with_udev};

// What the modules here share: each takes it with `use super::*`.
use std::{
    collections::{HashMap, HashSet},
    os::fd::OwnedFd,
    path::Path,
    time::Duration,
};

use smithay::{
    backend::{
        allocator::{
            dmabuf::Dmabuf,
            format::FormatSet,
            gbm::{GbmAllocator, GbmBufferFlags, GbmDevice},
        },
        drm::{
            DrmDevice, DrmDeviceFd, DrmEvent, DrmEventMetadata, DrmEventTime, DrmNode, NodeType,
            compositor::FrameFlags,
            exporter::gbm::GbmFramebufferExporter,
            output::{DrmOutputManager, DrmOutputRenderElements},
        },
        egl::{EGLDevice, EGLDisplay},
        input::InputEvent,
        libinput::{LibinputInputBackend, LibinputSessionInterface},
        renderer::{
            ImportDma, ImportMemWl,
            gles::GlesRenderer,
            multigpu::{GpuManager, gbm::GbmGlesBackend},
        },
        session::{Event as SessionEvent, Session, libseat::LibSeatSession},
        udev::{UdevBackend, UdevEvent, all_gpus, primary_gpu},
    },
    output::{Mode as WlMode, Output, PhysicalProperties},
    reexports::{
        calloop::{
            LoopHandle,
            timer::{TimeoutAction, Timer},
        },
        drm::control::{Device as ControlDevice, ModeTypeFlags, connector, crtc},
        input::Libinput,
        rustix::fs::OFlags,
        wayland_protocols::wp::presentation_time::server::wp_presentation_feedback,
    },
    utils::{Clock, DeviceFd, Monotonic},
    wayland::{dmabuf::DmabufFeedbackBuilder, presentation::Refresh},
};
use smithay_drm_extras::drm_scanner::{DrmScanEvent, DrmScanner};

use super::{BACKGROUND, Backend};
use crate::{render, state::Dashi};
