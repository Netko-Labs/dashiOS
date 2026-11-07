/**
 * Components (dev.dashi.components): `bun apps/components/main.tsx [host]`.
 * The @dashi/ui gallery, a developer's tool: in the launcher, not in a new
 * Dock (src/apps.ts). The pages are pages.ts, the exhibits exhibits/.
 */

import { runApp } from "../kit/index.ts";
import { GALLERY_SIZE, GalleryWindow } from "./view.tsx";

runApp({ id: "dev.dashi.components", title: "Components", size: GALLERY_SIZE }, <GalleryWindow />);
