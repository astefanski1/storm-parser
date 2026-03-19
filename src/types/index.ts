// ── Version ──────────────────────────────────────────────────────────────────
export interface ReplayVersion {
  m_flags: number;
  m_major: number;
  m_minor: number;
  m_revision: number;
  m_build: number;
  m_baseBuild: number;
}

// ── Kill / Takedown Events ───────────────────────────────────────────────────
export interface KillParticipant {
  player: string;
  hero: string;
}

export interface TakedownEvent {
  loop: number;
  time: number;
  x: number;
  y: number;
  killers: KillParticipant[];
  victim: KillParticipant;
}

// ── Level Times ──────────────────────────────────────────────────────────────
export interface LevelTime {
  loop: number;
  level: number;
  team: string;
  time: number;
}

// ── Draft: Bans & Picks ─────────────────────────────────────────────────────
export interface BanEntry {
  hero: string;
  order: number;
  absolute: number;
}

export interface PickData {
  0: string[];
  1: string[];
  first: number;
}

// ── XP Breakdown ────────────────────────────────────────────────────────────
export interface XPValues {
  GameTime: number;
  PreviousGameTime: number;
  MinionXP: number;
  CreepXP: number;
  StructureXP: number;
  HeroXP: number;
  TrickleXP: number;
}

export interface XPBreakdownEntry {
  loop: number;
  time: number;
  team: number;
  teamLevel?: number;
  breakdown: XPValues;
  theoreticalMinionXP: number;
}

// ── Mercenaries ─────────────────────────────────────────────────────────────
export interface MercCapture {
  loop: number;
  type: string;
  team: number;
  time: number;
}

export interface MercUnitLocation {
  x: number;
  y: number;
}

export interface MercUnit {
  loop: number;
  team: number;
  type: string;
  locations: MercUnitLocation[];
  time: number;
  duration: number;
}

export interface MercsData {
  captures: MercCapture[];
  units: Record<string, MercUnit>;
}

// ── Structures ──────────────────────────────────────────────────────────────
export interface StructureInfo {
  type: string;
  name: string;
  tag: number;
  rtag: number;
  x: number;
  y: number;
  team: number;
  destroyedLoop?: number;
  destroyed?: number;
}

// ── Objectives ──────────────────────────────────────────────────────────────
export interface ObjectiveEvent {
  team: number;
  score?: number;
  loop: number;
  time: number;
  duration?: number;
  endLoop?: number;
  end?: number;
}

export interface TeamObjective {
  count: number;
  events: ObjectiveEvent[];
}

export interface ObjectiveData {
  0: TeamObjective;
  1: TeamObjective;
  type: string;
}

// ── Team Stats ──────────────────────────────────────────────────────────────
export interface StructureStats {
  lost: number;
  destroyed: number;
  first: number;
}

export interface UptimeEntry {
  time: number;
  heroes: number;
}

export interface TeamTotals {
  DamageTaken: number;
  CreepDamage: number;
  Healing: number;
  HeroDamage: number;
  MinionDamage: number;
  SelfHealing: number;
  SiegeDamage: number;
  ProtectionGivenToAllies: number;
  TeamfightDamageTaken: number;
  TeamfightHealingDone: number;
  TeamfightHeroDamage: number;
  TimeCCdEnemyHeroes: number;
  TimeRootingEnemyHeroes: number;
  TimeSpentDead: number;
  TimeStunningEnemyHeroes: number;
  TimeSilencingEnemyHeroes: number;
  avgTimeSpentDead: number;
  timeDeadPct: number;
}

export interface TeamStats {
  mercCaptures: number;
  mercUptime: number;
  mercUptimePercent: number;
  structures: Record<string, StructureStats>;
  KDA: number;
  PPK: number;
  timeTo10: number;
  totals: TeamTotals;
  levelAdvTime: number;
  maxLevelAdv: number;
  avgLevelAdv: number;
  levelAdvPct: number;
  uptime: UptimeEntry[];
  uptimeHistogram: Record<string, number>;
  wipes: number;
  avgHeroesAlive: number;
  aces: number;
  timeWithHeroAdv: number;
  pctWithHeroAdv: number;
  passiveXPRate: number;
  passiveXPDiff: number;
  passiveXPGain: number;
}

export interface TeamStat {
  level: number;
  takedowns: number;
  ids: string[];
  names: string[];
  heroes: string[];
  tags: number[];
  stats: TeamStats;
}

// ── Level Advantage ─────────────────────────────────────────────────────────
export interface LevelAdvSegment {
  start: number;
  end: number;
  levelDiff: number;
  length: number;
}

// ── Player Talents ──────────────────────────────────────────────────────────
export interface TalentChoices {
  Tier1Choice?: string;
  Tier2Choice?: string;
  Tier3Choice?: string;
  Tier4Choice?: string;
  Tier5Choice?: string;
  Tier6Choice?: string;
  Tier7Choice?: string;
}

// ── Player Position Tracking ────────────────────────────────────────────────
export interface UnitPosition {
  x: number;
  y: number;
  time: number;
}

export interface UnitLife {
  born: number;
  locations: UnitPosition[];
  died?: number;
  duration: number;
}

export interface PlayerUnit {
  lives: UnitLife[];
}

// ── Player Stat ─────────────────────────────────────────────────────────────
export interface PlayerStat {
  hero: string;
  name: string;
  uuid: number;
  region: number;
  realm: number;
  ToonHandle: string;
  tag: number;
  team: number;
  win: boolean;
  skin: string;
  mount: string;
  banner?: string;
  spray?: string;
  clanTag?: string;
  highestLeague?: number;
  combinedRaceLevels?: number;
  randomSeed?: number;
  announcer: string;
  silenced: boolean;
  voiceSilenced: boolean;
  gameStats: Record<string, number>;
  awards: string[];
  talents: TalentChoices;
  takedowns: TakedownEvent[];
  deaths: TakedownEvent[];
  units: Record<string, PlayerUnit>;
}

// ── Match Stat ──────────────────────────────────────────────────────────────
export interface MatchStat {
  version: ReplayVersion;
  type?: number;
  mode?: string;
  map?: string;
  isBlizzardMap?: boolean;
  timeLocalOffset?: number;
  gameSpeed?: number;
  randomValue?: number;
  gameOptions?: Record<string, boolean | number>;
  date: string;
  rawDate: number;
  length: number;
  winner: number;
  region?: number;
  loopLength?: number;
  loopGameStart?: number;
  playerIDs: string[];
  heroes: string[];
  levelTimes: Record<string, Record<string, LevelTime>>;
  bans: Record<string, BanEntry[]>;
  picks: PickData;
  XPBreakdown: XPBreakdownEntry[];
  takedowns: TakedownEvent[];
  mercs: MercsData;
  team0Takedowns: number;
  team1Takedowns: number;
  structures: Record<string, StructureInfo>;
  objective: ObjectiveData;
  teams: Record<string, TeamStat>;
  winningPlayers: string[];
  levelAdvTimeline: LevelAdvSegment[];
  firstPickWin: boolean;
  firstObjective?: number;
  firstObjectiveWin?: boolean;
  firstFort?: number;
  firstKeep?: number;
  firstFortWin?: boolean;
  firstKeepWin?: boolean;
}

// ── Analysis Result ─────────────────────────────────────────────────────────
export interface AnalysisResult {
  status: number;
  match?: MatchStat;
  players?: Record<string, PlayerStat>;
  error?: string;
}

// ── Raw Data Structures ─────────────────────────────────────────────────────
export interface RawHeader {
  m_version: ReplayVersion;
  m_type: number;
  m_elapsedGameLoops: number;
  m_useScaledTime: boolean;
  m_ngdpRootKey: { m_data: string | Buffer };
  m_dataBuildNum: number;
  m_replayCompatibilityMac: { m_data: string | Buffer };
}

export interface RawToon {
  m_region: number;
  m_programId: string | Buffer;
  m_realm: number;
  m_id: number;
}

export interface RawColor {
  m_a: number;
  m_r: number;
  m_g: number;
  m_b: number;
}

export interface RawPlayerDetails {
  m_name: string | Buffer;
  m_toon: RawToon;
  m_race: string | Buffer;
  m_color: RawColor;
  m_control: number;
  m_teamId: number;
  m_handicap: number;
  m_observe: number;
  m_result: number;
  m_workingSetSlotId: number;
  m_hero: string | Buffer;
}

export interface RawDetails {
  m_playerList: RawPlayerDetails[];
  m_title: string | Buffer;
  m_difficulty: string | Buffer;
  m_thumbnail: { m_file: string | Buffer };
  m_isBlizzardMap: boolean;
  m_timeUTC: bigint | number;
  m_timeLocalOffset: bigint | number;
  m_mapFileName: string | Buffer;
  m_cacheHandles: (string | Buffer)[];
  m_miniSave: boolean;
  m_gameSpeed: number;
  m_defaultDifficulty: number;
  m_modPaths: (string | Buffer)[] | null;
  m_restartAsTransitionMap: boolean;
}

export interface RawRacePreference {
  m_race: number | null;
}
export interface RawTeamPreference {
  m_team: number | null;
}

export interface RawUserInitialData {
  m_name: string | Buffer;
  m_clanTag: string | Buffer;
  m_clanLogo: { m_data: string | Buffer } | null;
  m_highestLeague: number;
  m_combinedRaceLevels: number;
  m_randomSeed: number;
  m_racePreference: RawRacePreference;
  m_teamPreference: RawTeamPreference;
  m_testMap: boolean;
  m_testAuto: boolean;
  m_examine: boolean;
  m_customInterface: boolean;
  m_testType: number;
  m_observe: number;
  m_hero: string | Buffer;
  m_skin: string | Buffer;
  m_mount: string | Buffer;
  m_banner: string | Buffer;
  m_spray: string | Buffer;
  m_toonHandle: string | Buffer;
}

export interface RawGameOptions {
  m_lockTeams: boolean;
  m_teamsTogether: boolean;
  m_advancedSharedControl: boolean;
  m_randomRaces: boolean;
  m_battleNet: boolean;
  m_amm: boolean;
  m_competitive: boolean;
  m_practice: boolean;
  m_cooperative: boolean;
  m_noVictoryOrDefeat: boolean;
  m_heroDuplicatesAllowed: boolean;
  m_fog: number;
  m_observers: number;
  m_userDifficulty: number;
  m_clientDebugFlags: number;
  m_ammId?: number;
}

export interface RawSlot {
  m_control: number;
  m_userId: number;
  m_teamId: number;
  m_colorPref: number;
  m_racePref: number;
  m_difficulty: number;
  m_aiBuild: number;
  m_handicap: number;
  m_observe: number;
  m_logoIndex: number;
  m_hero: string | Buffer;
  m_skin: string | Buffer;
  m_mount: string | Buffer;
  m_artifacts: (string | Buffer)[];
  m_workingSetSlotId: number;
  m_rewards: number[];
  m_toonHandle: string | Buffer;
  m_licenses: number[];
  m_tandemLeaderUserId: number;
  m_commander: string | Buffer;
  m_commanderLevel: number;
  m_hasSilencePenalty: boolean;
  m_hasVoiceSilencePenalty: boolean;
  m_isBlizzardMap: boolean;
  m_heroMasteryTiers: { m_tier: number }[];
  m_mountAdornment: string | Buffer;
  m_spray: string | Buffer;
  m_announcerPack: string | Buffer;
  m_voiceLine: string | Buffer;
  m_heroStatue: string | Buffer;
  m_banner: string | Buffer;
}

export interface RawGameDescription {
  m_randomValue: number;
  m_gameCacheName: string | Buffer;
  m_gameOptions: RawGameOptions;
  m_gameSpeed: number;
  m_gameType: number;
  m_maxUsers: number;
  m_maxObservers: number;
  m_maxPlayers: number;
  m_maxTeams: number;
  m_maxColors: number;
  m_maxRaces: number;
  m_maxControls: number;
  m_mapSizeX: number;
  m_mapSizeY: number;
  m_mapFileSyncChecksum: number;
  m_mapFileName: string | Buffer;
  m_mapAuthorName: string | Buffer;
  m_modFileSyncChecksum: number;
  m_slotDescriptions: { m_allowedColors: number[] }[];
  m_defaultDifficulty: number;
  m_defaultAIBuild: number;
  m_cacheHandles: (string | Buffer)[];
  m_isBlizzardMap: boolean;
  m_isPremadeFFA: boolean;
  m_isCoopMode: boolean;
  m_isRealtimeMode: boolean;
}

export interface RawLobbyState {
  m_userInitialData: RawUserInitialData[];
  m_gameDescription: RawGameDescription;
  m_lobbyState: {
    m_maxUsers: number;
    m_maxObservers: number;
    m_slots: RawSlot[];
    m_randomSeed: number;
    m_hostUserId: number;
    m_isSinglePlayer: boolean;
    m_pickedMapTag: number;
    m_gameDuration: number;
    m_defaultDifficulty: number;
    m_defaultAIBuild: number;
    m_gameMode?: number;
    m_gameType?: number;
    m_firstPickTeam?: number;
    m_heroBans?: (string | Buffer)[];
  };
}

export interface RawInitData {
  m_syncLobbyState: RawLobbyState;
}
