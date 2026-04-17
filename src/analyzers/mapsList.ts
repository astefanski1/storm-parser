// ── Canonical Map Names ─────────────────────────────────────────────────────
// The single source of truth for all HotS battleground names.
// Everything downstream (DB, UI, analytics) should use these exact strings.

export const validMaps = [
  "Alterac Pass",
  "Battlefield of Eternity",
  "Blackheart's Bay",
  "Braxis Holdout",
  "Cursed Hollow",
  "Dragon Shire",
  "Garden of Terror",
  "Hanamura Temple",
  "Haunted Mines",
  "Industrial District",
  "Infernal Shrines",
  "Lost Cavern",
  "Silver City",
  "Sky Temple",
  "Tomb of the Spider Queen",
  "Towers of Doom",
  "Volskaya Foundry",
  "Warhead Junction",
] as const;

export type MapName = (typeof validMaps)[number];

// ── Internal m_mapFileName → Canonical Name ─────────────────────────────────
// m_mapFileName contains the internal .StormMap file identifier which is
// always the same regardless of the client language. This is the most reliable
// way to identify a map.
//
// Keys are normalised to lowercase with path segments and extensions stripped
// so matching is resilient to minor format variations.

export const mapFileNameMap: Record<string, MapName> = {
  // Standard battlegrounds
  alteracpass: "Alterac Pass",
  battlefieldofeternity: "Battlefield of Eternity",
  blackheartsbay: "Blackheart's Bay",
  braxisholdout: "Braxis Holdout",
  cursedhollowv3: "Cursed Hollow",
  cursedhollowv2: "Cursed Hollow",
  cursedhollow: "Cursed Hollow",
  dragonshire: "Dragon Shire",
  gardenofterror: "Garden of Terror",
  hanamura: "Hanamura Temple",
  hanamurapayloadpush: "Hanamura Temple",
  hanamuratemple: "Hanamura Temple",
  hauntedmines: "Haunted Mines",
  infernalshrines: "Infernal Shrines",
  skytemple: "Sky Temple",
  tombofthespiderqueen: "Tomb of the Spider Queen",
  towersofdoom: "Towers of Doom",
  volskayafoundry: "Volskaya Foundry",
  conveyorbelt: "Volskaya Foundry", // Internal codename
  warheadjunction: "Warhead Junction",
};

// ── Normalizer ──────────────────────────────────────────────────────────────

/**
 * Extracts the map identifier from an m_mapFileName path.
 * Strips directory prefixes and file extensions, returning
 * a lowercase slug like "conveyorbelt" or "cursedhollowv3".
 */
function extractMapSlug(mapFileName: string): string {
  // Strip path segments (e.g. "Mods/HeroesData/ConveyorBelt.StormMap" → "ConveyorBelt.StormMap")
  const lastSlash = Math.max(
    mapFileName.lastIndexOf("/"),
    mapFileName.lastIndexOf("\\"),
  );
  let slug =
    lastSlash >= 0 ? mapFileName.substring(lastSlash + 1) : mapFileName;

  // Strip extension (e.g. ".StormMap", ".stormmap")
  const dotIdx = slug.lastIndexOf(".");
  if (dotIdx > 0) slug = slug.substring(0, dotIdx);

  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalizes a map name to its canonical English form.
 *
 * Uses the language-independent m_mapFileName as the primary source,
 * falling back to checking if rawTitle is already an English map name.
 *
 * @param rawTitle    - The localized m_title from the replay details
 * @param mapFileName - The language-independent m_mapFileName (optional but preferred)
 * @returns The canonical English map name, or the rawTitle if no mapping is found
 */
export function normalizeMapName(
  rawTitle: string,
  mapFileName?: string,
): string {
  if (!rawTitle && !mapFileName) return "";

  // ── 1. Try m_mapFileName first (most reliable, language-independent) ───
  if (mapFileName) {
    const slug = extractMapSlug(mapFileName);
    if (slug && mapFileNameMap[slug]) {
      return mapFileNameMap[slug];
    }
  }

  // ── 2. Check if rawTitle is already a valid canonical English name ─────
  if (validMaps.includes(rawTitle as MapName)) {
    return rawTitle;
  }

  // ── 3. Case-insensitive match against English names ───────────────────
  const lowerTitle = rawTitle.toLowerCase().trim();
  const matchedEnglish = validMaps.find((m) => m.toLowerCase() === lowerTitle);
  if (matchedEnglish) return matchedEnglish;

  // ── 4. Graceful fallback — return the raw title unchanged ─────────────
  return rawTitle;
}
