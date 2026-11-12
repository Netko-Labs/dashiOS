import { afterEach, describe, expect, test } from "bun:test";
import { dashiWords } from "../src/launcher/ranking/lib/words.ts";
import { parseDesktopEntry } from "../src/shared/apps/index.ts";
import { languagesOf, localeKeys, localizedDesktop, messageLocales } from "../src/shared/locale/messages.ts";

const FILES = `[Desktop Entry]
Type=Application
Name=Files
Name[de]=Dateien
Name[fr]=Fichiers
Name[pt]=Ficheiros
Name[pt_BR]=Arquivos
GenericName=File Manager
GenericName[de]=Dateiverwaltung
Keywords=folder;manager;
Keywords[de]=Ordner;Verwaltung;Semi\\;colon;
Keywords[fr]=dossier;gestionnaire;
Exec=nautilus --new-window %U
Icon=org.gnome.Nautilus

[Desktop Action new-window]
Name=New Window
Name[de]=Neues Fenster
`;

describe("the person's locales", () => {
  test("a locale's lookup keys, as the Desktop Entry Specification orders them", () => {
    expect(localeKeys("de_DE.UTF-8@euro")).toEqual(["de_DE@euro", "de_DE", "de@euro", "de"]);
    expect(localeKeys("pt_BR.UTF-8")).toEqual(["pt_BR", "pt"]);
    expect(localeKeys("fr")).toEqual(["fr"]);
    expect(localeKeys("C")).toEqual([]);
    expect(localeKeys("../../etc")).toEqual([]);
  });

  test("LANGUAGE's list first, then LC_ALL, LC_MESSAGES, LANG; nothing under C", () => {
    expect(messageLocales({ LANG: "de_DE.UTF-8" })).toEqual(["de_DE", "de"]);
    expect(messageLocales({ LANG: "en_US.UTF-8", LC_MESSAGES: "fr_FR.UTF-8" })).toEqual(["fr_FR", "fr"]);
    expect(messageLocales({ LANG: "de_DE.UTF-8", LANGUAGE: "pt_BR:pt" })).toEqual(["pt_BR", "pt", "de_DE", "de"]);
    expect(messageLocales({ LANG: "C", LANGUAGE: "de" })).toEqual([]);
    expect(messageLocales({ LANG: "C.UTF-8" })).toEqual([]);
    expect(messageLocales({})).toEqual([]);
    expect(languagesOf(["pt_BR", "pt", "de@euro"])).toEqual(["pt", "de"]);
  });
});

describe("a desktop entry's localized keys", () => {
  test("the best locale's value, from the [Desktop Entry] group only", () => {
    expect(localizedDesktop(FILES, ["de_DE", "de"])).toEqual({
      name: "Dateien",
      genericName: "Dateiverwaltung",
      keywords: ["Ordner", "Verwaltung", "Semi;colon"],
    });
    expect(localizedDesktop(FILES, ["pt_BR", "pt"])).toEqual({ name: "Arquivos", keywords: [] });
    expect(localizedDesktop(FILES, ["pt_PT", "pt"])).toEqual({ name: "Ficheiros", keywords: [] });
    expect(localizedDesktop(FILES, ["fr_FR", "fr"])).toEqual({ name: "Fichiers", keywords: ["dossier", "gestionnaire"] });
  });

  test("a language the file doesn't have, or none, leaves the defaults", () => {
    expect(localizedDesktop(FILES, ["ja_JP", "ja"])).toEqual({ keywords: [] });
    expect(localizedDesktop(FILES, [])).toEqual({ keywords: [] });
  });

  describe("parseDesktopEntry keeps them for the ranking", () => {
    const saved = { ...process.env };
    afterEach(() => {
      for (const key of ["LANG", "LC_ALL", "LC_MESSAGES", "LANGUAGE"]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    test("in German, Files is Dateien too; its English name is kept as the name", () => {
      process.env.LC_ALL = "de_DE.UTF-8";
      delete process.env.LANGUAGE;
      const entry = parseDesktopEntry("org.gnome.Nautilus", FILES);
      expect(entry?.name).toBe("Files");
      expect(entry?.localized).toEqual({ name: "Dateien", genericName: "Dateiverwaltung", keywords: ["Ordner", "Verwaltung", "Semi;colon"] });
    });

    test("in English, nothing is added", () => {
      process.env.LC_ALL = "en_US.UTF-8";
      delete process.env.LANGUAGE;
      expect(parseDesktopEntry("org.gnome.Nautilus", FILES)).not.toHaveProperty("localized");
    });
  });
});

describe("Dashi's own words", () => {
  test("in the person's languages, best first; none for English", () => {
    expect(dashiWords("dev.dashi.settings/displays", ["fr"])).toContain("Écran");
    expect(dashiWords("dev.dashi.files", ["de", "fr"])).toEqual(["Dateien", "Dateimanager", "Ordner", "Fichiers", "gestionnaire de fichiers", "dossier"]);
    expect(dashiWords("dev.dashi.files", ["en"])).toEqual([]);
  });
});
