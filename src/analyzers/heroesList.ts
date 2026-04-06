export const validHeroes = [
  "Abathur",
  "Alarak",
  "Alexstrasza",
  "Ana",
  "Anduin",
  "Anubarak",
  "Artanis",
  "Arthas",
  "Auriel",
  "Azmodan",
  "Blaze",
  "Brightwing",
  "Cassia",
  "Chen",
  "Cho",
  "Chromie",
  "Deathwing",
  "Deckard",
  "Dehaka",
  "Diablo",
  "DVa",
  "ETC",
  "Falstad",
  "Fenix",
  "Gall",
  "Garrosh",
  "Gazlowe",
  "Genji",
  "Greymane",
  "Guldan",
  "Hanzo",
  "Hogger",
  "Illidan",
  "Imperius",
  "Jaina",
  "Johanna",
  "Junkrat",
  "Kaelthas",
  "KelThuzad",
  "Kerrigan",
  "Kharazim",
  "Leoric",
  "LiLi",
  "LiMing",
  "LtMorales",
  "Lunara",
  "Maiev",
  "Malfurion",
  "MalGanis",
  "Malthael",
  "Medivh",
  "Mei",
  "Mephisto",
  "Muradin",
  "Murky",
  "Nazeebo",
  "Nova",
  "Orphea",
  "Probius",
  "Qhira",
  "Ragnaros",
  "Raynor",
  "Rehgar",
  "Rexxar",
  "Samuro",
  "SgtHammer",
  "Sonya",
  "Stitches",
  "Stukov",
  "Sylvanas",
  "Tassadar",
  "TheButcher",
  "TheLostVikings",
  "Thrall",
  "Tracer",
  "Tychus",
  "Tyrael",
  "Tyrande",
  "Uther",
  "Valeera",
  "Valla",
  "Varian",
  "Whitemane",
  "Xul",
  "Yrel",
  "Zagara",
  "Zarya",
  "Zeratul",
  "Zuljin",
];

// Mapping from internal replay engine names to our valid UI keys
export const heroNameMap: Record<string, string> = {
  FaerieDragon: "Brightwing",
  Amazon: "Cassia",
  Barbarian: "Sonya",
  Crusader: "Johanna",
  DemonHunter: "Valla",
  WitchDoctor: "Nazeebo",
  Monk: "Kharazim",
  Wizard: "LiMing",
  Tinker: "Gazlowe",
  Medic: "LtMorales",
  L90ETC: "ETC",
  Butcher: "TheButcher",
  LostVikings: "TheLostVikings",
  Necromancer: "Xul",
  Dryad: "Lunara",
  Shapeshifter: "Greymane",
  ChoGall: "Cho", // Could be Cho or Gall
};

export function normalizeHeroName(rawName: string): string | null {
  if (!rawName) return null;
  // Check exact
  if (validHeroes.includes(rawName)) return rawName;
  // Check mapped
  if (heroNameMap[rawName]) return heroNameMap[rawName];

  // Strip non-alphas and check case insensitive
  const clean = rawName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  // Try stripping "hero" prefix from internal names (e.g. HeroAbathur)
  if (clean.startsWith("hero") && clean.length > 4) {
    const stripped = clean.substring(4);
    const matched = validHeroes.find((h) => h.toLowerCase() === stripped);
    if (matched) return matched;
  }

  const matched = validHeroes.find((h) => h.toLowerCase() === clean);
  if (matched) return matched;

  // We only return heroes that exist in our frontend definition list
  return null;
}
