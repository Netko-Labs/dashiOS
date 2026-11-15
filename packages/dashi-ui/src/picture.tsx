/**
 * A picture Dashi did not make (an app's icon by path, an account picture, an
 * applet's icon): an `<Image>` that shows `fallback` instead when the host
 * says it cannot draw the file (it is not there, or not a format it decodes:
 * a TIFF, an AVIF, an XPM, whatever its name says). The host tries first, so
 * the picture's place is empty for a frame before the fallback shows. On a
 * host that does not say (one from before mirin's `imageError`) the place
 * stays empty.
 */

import { Image, type ImageProps } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";

export interface PictureProps extends Omit<ImageProps, "onError"> {
  /** What stands in for a file the host cannot draw; nothing unless said. */
  fallback?: ReactNode;
}

export function Picture({ fallback = null, ...image }: PictureProps): ReactNode {
  // The source that failed: another source is tried afresh.
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === image.source) return fallback;
  return <Image {...image} onError={() => setFailed(image.source)} />;
}
