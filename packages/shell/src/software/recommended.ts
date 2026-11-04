/**
 * The Flathub apps Dashi recommends: offered in the Setup Assistant (Extras)
 * and on Software's Discover page ("Recommended for Dashi"), from this one
 * list. The browser is not here: Dashi ships Helium.
 */

export interface RecommendedApp {
  /** The Flatpak application id. */
  id: string;
  name: string;
  /** What it is, in a few words. */
  summary: string;
}

export const RECOMMENDED_APPS: readonly RecommendedApp[] = [
  { id: "org.videolan.VLC", name: "VLC", summary: "Plays almost any video or music file" },
  { id: "io.mpv.Mpv", name: "mpv", summary: "A light, fast video player" },
  { id: "org.libreoffice.LibreOffice", name: "LibreOffice", summary: "Documents, spreadsheets, and presentations" },
  { id: "com.discordapp.Discord", name: "Discord", summary: "Voice, video, and text chat" },
  { id: "com.spotify.Client", name: "Spotify", summary: "Music and podcasts" },
  { id: "com.obsproject.Studio", name: "OBS Studio", summary: "Record and stream your screen" },
  { id: "net.lutris.Lutris", name: "Lutris", summary: "One place for all your games" },
  { id: "com.heroicgameslauncher.hgl", name: "Heroic", summary: "Games from Epic, GOG, and Amazon" },
  { id: "com.usebottles.bottles", name: "Bottles", summary: "Run Windows apps" },
];

/** The ones ticked at first in the Setup Assistant: the everyday ones, not the specialist tools. */
export const RECOMMENDED_DEFAULTS: ReadonlySet<string> = new Set(["org.videolan.VLC", "org.libreoffice.LibreOffice"]);
