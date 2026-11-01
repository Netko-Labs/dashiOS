/**
 * The two pickers System Settings and the Setup Assistant share: the time
 * zone (an area, a search, and the zones in it) and the language and region
 * (two lists side by side under one search). Pure views over props: the
 * caller decides what a pick does.
 */

import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { Choices } from "../settings-app/ui.tsx";
import { useColors } from "../theme.ts";
import { formatsForRegion, isRegionOf, type LocaleEntry, regionRows, searchLocales } from "./locale.ts";
import { PickList, PickNote, PickRow, SearchField } from "./pick.tsx";
import { describeZone, searchZones, type Zone, zoneAreas } from "./timezones.ts";

/** A typed search shows at most this many zones; "Type more" says there are others. */
const MAX_ROWS = 80;

export function TimezonePicker({
  zones,
  current,
  height,
  onPick,
}: {
  zones: readonly Zone[];
  current: string;
  height: number;
  onPick: (zone: string) => void;
}) {
  const [query, setQuery] = useState("");
  const areas = zoneAreas(zones);
  const currentArea = zones.find((zone) => zone.id === current)?.area;
  const [chosenArea, setArea] = useState<string | undefined>(undefined);
  const area = chosenArea ?? currentArea ?? areas[0];
  const currentZone = zones.find((zone) => zone.id === current);
  const found = searchZones(zones, query, area);
  const searching = query.trim() !== "";
  // The zone the system has now sits on top, so it is never lost in a long area; the area lists the others.
  const rows = found.filter((zone) => searching || zone.id !== current);
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <View testID="timezone-picker" style={{ flexDirection: "column", gap: 8 }}>
      <SearchField testID="timezone-search" value={query} onChange={setQuery} placeholder="Search for a city or country" />
      {!searching && areas.length > 0 && (
        <Choices testID="timezone-area" value={area ?? ""} options={areas.map((each) => ({ value: each, label: each }))} onChange={setArea} />
      )}
      <PickList testID="timezone-list" height={height}>
        {zones.length === 0 && <PickNote testID="timezone-none">The list of time zones is not available on this system.</PickNote>}
        {searching && shown.length === 0 && <PickNote testID="timezone-no-match">No time zone matches.</PickNote>}
        {!searching && currentZone && (
          <PickRow testID={`timezone:${currentZone.id}`} label={`${currentZone.city}, ${currentZone.area}`} detail={describeZone(currentZone)} chosen onPress={() => onPick(currentZone.id)} />
        )}
        {shown.map((zone) => (
          <PickRow key={zone.id} testID={`timezone:${zone.id}`} label={searching ? `${zone.city}, ${zone.area}` : zone.city} detail={describeZone(zone)} chosen={zone.id === current} onPress={() => onPick(zone.id)} />
        ))}
        {rows.length > shown.length && <PickNote>{`${rows.length - shown.length} more: type to narrow the list.`}</PickNote>}
      </PickList>
    </View>
  );
}

export function LocalePickers({
  locales,
  language,
  formats,
  height,
  onLanguage,
  onFormats,
}: {
  locales: readonly LocaleEntry[];
  /** The system language (`LANG`), if it names a locale. */
  language: string | null;
  /** The person's region formats; undefined follows the language. */
  formats: string | undefined;
  height: number;
  onLanguage: (locale: string) => void;
  /** undefined puts the formats back to following the language. */
  onFormats: (locale: string | undefined) => void;
}) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  // What is chosen sits on top, so it is never lost in a list of hundreds; the lists below leave it out.
  const found = searchLocales(locales, query);
  const currentLanguage = searching ? undefined : locales.find((entry) => entry.id === language);
  const shown = currentLanguage ? found.filter((entry) => entry.id !== currentLanguage.id) : found;
  const allRegions = regionRows(found);
  const currentRegion = !searching && formats !== undefined ? allRegions.find((entry) => isRegionOf(locales, entry.region as string, formats)) : undefined;
  const regions = currentRegion ? allRegions.filter((entry) => entry !== currentRegion) : allRegions;
  const heading = (text: string) => <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{text}</Text>;
  return (
    <View testID="locale-pickers" style={{ flexDirection: "column", gap: 8 }}>
      <SearchField testID="locale-search" value={query} onChange={setQuery} placeholder="Search languages and regions" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>
          {heading("Language")}
          <PickList testID="locale-languages" height={height}>
            {locales.length === 0 && <PickNote testID="locale-none">No languages are installed on this system.</PickNote>}
            {searching && shown.length === 0 && <PickNote>No language matches.</PickNote>}
            {currentLanguage && <PickRow testID={`language:${currentLanguage.id}`} label={currentLanguage.label} chosen onPress={() => onLanguage(currentLanguage.id)} />}
            {shown.map((entry) => (
              <PickRow key={entry.id} testID={`language:${entry.id}`} label={entry.label} chosen={entry.id === language} onPress={() => onLanguage(entry.id)} />
            ))}
          </PickList>
        </View>
        <View style={{ flex: 1, flexDirection: "column", gap: 4, minWidth: 0 }}>
          {heading("Region formats")}
          <PickList testID="locale-regions" height={height}>
            {!searching && <PickRow testID="region:follow" label="Same as language" chosen={formats === undefined} onPress={() => onFormats(undefined)} />}
            {searching && regions.length === 0 && <PickNote>No region matches.</PickNote>}
            {currentRegion && <PickRow testID={`region:${currentRegion.id}`} label={currentRegion.region as string} chosen onPress={() => onFormats(formats)} />}
            {regions.map((entry) => (
              <PickRow
                key={entry.region}
                testID={`region:${entry.id}`}
                label={entry.region as string}
                chosen={formats !== undefined && isRegionOf(locales, entry.region as string, formats)}
                onPress={() => onFormats((formatsForRegion(locales, entry.region as string, formats ?? language)?.id ?? entry.id))}
              />
            ))}
          </PickList>
        </View>
      </View>
    </View>
  );
}
