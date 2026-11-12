# Fixtures for dashi-comp's tests

- `loop.webm`: eight frames of GStreamer's test pattern, 64 by 36, VP8 in WebM (3 KB), for
  `a_video_plays_as_the_wallpaper`. It is kept here so the test needs no encoder and never
  skips; playing it needs GStreamer's VP8 decoder and WebM demuxer (`gstreamer1-plugins-good`),
  as the session does. Made with:

  ```sh
  gst-launch-1.0 -q videotestsrc num-buffers=8 ! video/x-raw,width=64,height=36,framerate=8/1 \
    ! vp8enc ! webmmux ! filesink location=loop.webm
  ```
