import type {
  MatchStat,
  PlayerStat,
  TeamStat,
  TeamStats,
  TeamTotals,
  StructureStats,
  LevelAdvSegment,
  UptimeEntry,
} from "../types/index.js";

// ── Totals stat keys to aggregate ───────────────────────────────────────────
const TOTAL_KEYS: (keyof TeamTotals)[] = [
  "DamageTaken",
  "CreepDamage",
  "Healing",
  "HeroDamage",
  "MinionDamage",
  "SelfHealing",
  "SiegeDamage",
  "ProtectionGivenToAllies",
  "TeamfightDamageTaken",
  "TeamfightHealingDone",
  "TeamfightHeroDamage",
  "TimeCCdEnemyHeroes",
  "TimeRootingEnemyHeroes",
  "TimeSpentDead",
  "TimeStunningEnemyHeroes",
  "TimeSilencingEnemyHeroes",
];

function emptyTotals(): TeamTotals {
  return {
    DamageTaken: 0,
    CreepDamage: 0,
    Healing: 0,
    HeroDamage: 0,
    MinionDamage: 0,
    SelfHealing: 0,
    SiegeDamage: 0,
    ProtectionGivenToAllies: 0,
    TeamfightDamageTaken: 0,
    TeamfightHealingDone: 0,
    TeamfightHeroDamage: 0,
    TimeCCdEnemyHeroes: 0,
    TimeRootingEnemyHeroes: 0,
    TimeSpentDead: 0,
    TimeStunningEnemyHeroes: 0,
    TimeSilencingEnemyHeroes: 0,
    avgTimeSpentDead: 0,
    timeDeadPct: 0,
  };
}

function emptyTeamStats(): TeamStats {
  return {
    mercCaptures: 0,
    mercUptime: 0,
    mercUptimePercent: 0,
    structures: {},
    KDA: 0,
    PPK: 0,
    timeTo10: 0,
    totals: emptyTotals(),
    levelAdvTime: 0,
    maxLevelAdv: 0,
    avgLevelAdv: 0,
    levelAdvPct: 0,
    uptime: [],
    uptimeHistogram: {},
    wipes: 0,
    avgHeroesAlive: 0,
    aces: 0,
    timeWithHeroAdv: 0,
    pctWithHeroAdv: 0,
    passiveXPRate: 0,
    passiveXPDiff: 0,
    passiveXPGain: 0,
  };
}

export function computeAnalytics(
  match: MatchStat,
  players: Record<string, PlayerStat>,
): void {
  computeTakedownCounts(match);
  computeTeamData(match, players);
  computePlayerComputedStats(match, players);
  computeLevelAdvTimeline(match);
  computeTeamAnalytics(match, players);
  computeFirstEvents(match);
}

// ── Team data (names, heroes, tags, stats) ──────────────────────────────────
function computeTeamData(
  match: MatchStat,
  players: Record<string, PlayerStat>,
): void {
  for (const teamKey of ["0", "1"]) {
    const team = match.teams[teamKey];
    if (!team) continue;
    team.names = [];
    team.heroes = [];
    team.tags = [];
    team.stats = emptyTeamStats();

    for (const toon of team.ids) {
      const p = players[toon];
      if (!p) continue;
      team.names.push(p.name);
      team.heroes.push(p.hero);
      team.tags.push(p.tag);
    }

    // Aggregate totals
    for (const toon of team.ids) {
      const p = players[toon];
      if (!p) continue;
      for (const key of TOTAL_KEYS) {
        const val = p.gameStats[key];
        if (typeof val === "number") {
          team.stats.totals[key] += val;
        }
      }
    }

    // avgTimeSpentDead & timeDeadPct
    const deaths = team.ids.reduce(
      (s, t) => s + (players[t]?.gameStats["Deaths"] ?? 0),
      0,
    );
    if (deaths > 0) {
      team.stats.totals.avgTimeSpentDead =
        team.stats.totals.TimeSpentDead / deaths;
    }
    if (match.length > 0) {
      team.stats.totals.timeDeadPct =
        team.stats.totals.TimeSpentDead / (match.length * team.ids.length);
    }

    // KDA
    const tkd = team.takedowns;
    const tDeaths = deaths;
    team.stats.KDA = tDeaths > 0 ? tkd / tDeaths : tkd;

    // PPK (players per kill)
    team.stats.PPK =
      tkd > 0
        ? match.takedowns
            .filter((td) => team.ids.includes(td.killers[0]?.player))
            .reduce((s, td) => s + td.killers.length, 0) / tkd
        : 0;

    // timeTo10
    const lt = match.levelTimes[teamKey];
    if (lt?.["10"]) {
      team.stats.timeTo10 = lt["10"].time;
    }

    // Merc stats
    const teamNum = parseInt(teamKey, 10);
    const teamCaptures = match.mercs.captures.filter((c) => c.team === teamNum);
    team.stats.mercCaptures = teamCaptures.length;
    let mercUptime = 0;
    for (const unit of Object.values(match.mercs.units)) {
      if (unit.team === teamNum && unit.duration > 0) {
        mercUptime += unit.duration;
      }
    }
    team.stats.mercUptime = mercUptime;
    team.stats.mercUptimePercent =
      match.length > 0 ? mercUptime / match.length : 0;

    // Structure stats
    computeStructureStats(match, team, teamKey);
  }
}

function computeStructureStats(
  match: MatchStat,
  team: TeamStat,
  teamKey: string,
): void {
  const teamNum = parseInt(teamKey, 10);
  const opponentNum = teamNum === 0 ? 1 : 0;
  const structStats: Record<string, StructureStats> = {};

  for (const s of Object.values(match.structures)) {
    const name = s.name;
    if (!structStats[name]) {
      structStats[name] = { lost: 0, destroyed: 0, first: match.length };
    }
    // Structures belonging to opponent that we destroyed
    if (s.team === opponentNum && s.destroyed !== undefined) {
      structStats[name].destroyed++;
      structStats[name].first = Math.min(structStats[name].first, s.destroyed);
    }
    // Structures belonging to us that were destroyed
    if (s.team === teamNum && s.destroyed !== undefined) {
      structStats[name].lost++;
    }
  }

  team.stats.structures = structStats;
}

// ── Player computed stats ───────────────────────────────────────────────────
function computePlayerComputedStats(
  match: MatchStat,
  players: Record<string, PlayerStat>,
): void {
  const minutes = match.length / 60;
  for (const p of Object.values(players)) {
    const gs = p.gameStats;
    const deaths = gs["Deaths"] ?? 0;
    const teamTakedowns = gs["TeamTakedowns"] ?? 0;

    // DPM, HPM, XPM
    if (minutes > 0) {
      gs["DPM"] = (gs["HeroDamage"] ?? 0) / minutes;
      gs["HPM"] = ((gs["Healing"] ?? 0) + (gs["SelfHealing"] ?? 0)) / minutes;
      gs["XPM"] = (gs["ExperienceContribution"] ?? 0) / minutes;
    }

    // KDA
    gs["KDA"] =
      deaths > 0 ? (gs["Takedowns"] ?? 0) / deaths : (gs["Takedowns"] ?? 0);

    // KillParticipation
    gs["KillParticipation"] =
      teamTakedowns > 0 ? (gs["Takedowns"] ?? 0) / teamTakedowns : 0;

    // Per-death stats
    gs["damageDonePerDeath"] =
      deaths > 0 ? (gs["HeroDamage"] ?? 0) / deaths : (gs["HeroDamage"] ?? 0);
    gs["damageTakenPerDeath"] =
      deaths > 0 ? (gs["DamageTaken"] ?? 0) / deaths : (gs["DamageTaken"] ?? 0);
    gs["healingDonePerDeath"] =
      deaths > 0
        ? ((gs["Healing"] ?? 0) + (gs["SelfHealing"] ?? 0)) / deaths
        : (gs["Healing"] ?? 0) + (gs["SelfHealing"] ?? 0);

    // Length
    gs["length"] = match.length;
  }
}

// ── Takedown counts ─────────────────────────────────────────────────────────
function computeTakedownCounts(match: MatchStat): void {
  let t0 = 0,
    t1 = 0;
  const team0Ids = new Set(match.teams["0"]?.ids || []);
  for (const td of match.takedowns) {
    if (team0Ids.has(td.victim.player)) t1++;
    else t0++;
  }
  match.team0Takedowns = t0;
  match.team1Takedowns = t1;
  if (match.teams["0"]) match.teams["0"].takedowns = t0;
  if (match.teams["1"]) match.teams["1"].takedowns = t1;
}

// ── Level advantage timeline ────────────────────────────────────────────────
function computeLevelAdvTimeline(match: MatchStat): void {
  const lt0 = match.levelTimes["0"] || {};
  const lt1 = match.levelTimes["1"] || {};

  // Build sorted level change events
  const events: { time: number; team: number; level: number }[] = [];
  for (const lt of Object.values(lt0))
    events.push({ time: lt.time, team: 0, level: lt.level });
  for (const lt of Object.values(lt1))
    events.push({ time: lt.time, team: 1, level: lt.level });
  events.sort((a, b) => a.time - b.time);

  if (events.length === 0) {
    match.levelAdvTimeline = [];
    return;
  }

  const segments: LevelAdvSegment[] = [];
  let team0Level = 0;
  let team1Level = 0;
  let lastTime = events[0].time;

  for (const evt of events) {
    const diff = team0Level - team1Level;
    if (evt.time > lastTime) {
      segments.push({
        start: lastTime,
        end: evt.time,
        levelDiff: diff,
        length: evt.time - lastTime,
      });
    }
    if (evt.team === 0) team0Level = evt.level;
    else team1Level = evt.level;
    lastTime = evt.time;
  }

  // Final segment to end
  const finalDiff = team0Level - team1Level;
  if (match.length > lastTime) {
    segments.push({
      start: lastTime,
      end: match.length,
      levelDiff: finalDiff,
      length: match.length - lastTime,
    });
  }

  match.levelAdvTimeline = segments;

  // Compute level advantage stats per team
  for (const teamKey of ["0", "1"]) {
    const team = match.teams[teamKey];
    if (!team) continue;
    const sign = teamKey === "0" ? 1 : -1;

    let advTime = 0,
      maxAdv = 0,
      weightedAdv = 0,
      totalTime = 0;
    for (const seg of segments) {
      const diff = seg.levelDiff * sign;
      if (diff > 0) advTime += seg.length;
      maxAdv = Math.max(maxAdv, diff);
      weightedAdv += diff * seg.length;
      totalTime += seg.length;
    }
    team.stats.levelAdvTime = advTime;
    team.stats.maxLevelAdv = maxAdv;
    team.stats.avgLevelAdv = totalTime > 0 ? weightedAdv / totalTime : 0;
    team.stats.levelAdvPct = match.length > 0 ? advTime / match.length : 0;
  }
}

// ── Team hero uptime & advantage ────────────────────────────────────────────
function computeTeamAnalytics(
  match: MatchStat,
  players: Record<string, PlayerStat>,
): void {
  for (const teamKey of ["0", "1"]) {
    const team = match.teams[teamKey];
    if (!team) continue;

    // Build death/respawn timeline
    const deathEvents: { time: number; delta: number }[] = [];
    for (const toon of team.ids) {
      const p = players[toon];
      if (!p) continue;
      for (const d of p.deaths) {
        deathEvents.push({ time: d.time, delta: -1 });
        const respawnTime = d.time + estimateRespawn(p.gameStats["Level"] ?? 1);
        if (respawnTime < match.length) {
          deathEvents.push({ time: respawnTime, delta: 1 });
        }
      }
    }
    deathEvents.sort((a, b) => a.time - b.time);

    const uptime: UptimeEntry[] = [{ time: 0, heroes: team.ids.length }];
    let alive = team.ids.length;
    for (const de of deathEvents) {
      alive += de.delta;
      alive = Math.max(0, Math.min(team.ids.length, alive));
      uptime.push({ time: de.time, heroes: alive });
    }
    team.stats.uptime = uptime;

    // Histogram
    const hist: Record<string, number> = {};
    for (let i = 0; i < uptime.length; i++) {
      const end = i < uptime.length - 1 ? uptime[i + 1].time : match.length;
      const dur = end - uptime[i].time;
      const key = String(uptime[i].heroes);
      hist[key] = (hist[key] || 0) + dur;
    }
    team.stats.uptimeHistogram = hist;

    // avgHeroesAlive
    let weighted = 0,
      total = 0;
    for (let i = 0; i < uptime.length; i++) {
      const end = i < uptime.length - 1 ? uptime[i + 1].time : match.length;
      const dur = end - uptime[i].time;
      weighted += uptime[i].heroes * dur;
      total += dur;
    }
    team.stats.avgHeroesAlive = total > 0 ? weighted / total : team.ids.length;

    // Wipes (0 heroes alive) and aces
    team.stats.wipes = uptime.filter((u) => u.heroes === 0).length;
    team.stats.aces = 0; // opponent wipes
    const oppKey = teamKey === "0" ? "1" : "0";
    const oppTeam = match.teams[oppKey];
    if (oppTeam?.stats?.uptime) {
      team.stats.aces = oppTeam.stats.uptime.filter(
        (u) => u.heroes === 0,
      ).length;
    }

    // PassiveXP
    const xpEntries = match.XPBreakdown.filter(
      (e) => e.team === parseInt(teamKey, 10),
    );
    if (xpEntries.length > 0) {
      const lastXP = xpEntries[xpEntries.length - 1];
      const trickle = lastXP.breakdown.TrickleXP;
      team.stats.passiveXPGain = trickle;
      team.stats.passiveXPRate =
        match.length > 0 ? trickle / (match.length / 60) : 0;
    }
  }

  // Hero advantage time
  for (const teamKey of ["0", "1"]) {
    const team = match.teams[teamKey];
    const oppKey = teamKey === "0" ? "1" : "0";
    const oppTeam = match.teams[oppKey];
    if (!team || !oppTeam) continue;

    const teamUp = team.stats.uptime;
    const oppUp = oppTeam.stats.uptime;
    if (!teamUp.length || !oppUp.length) continue;

    // Merge timelines and calculate hero advantage time
    const allTimes = new Set<number>();
    for (const u of teamUp) allTimes.add(u.time);
    for (const u of oppUp) allTimes.add(u.time);
    const sorted = Array.from(allTimes).sort((a, b) => a - b);

    let advTime = 0;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const end = i < sorted.length - 1 ? sorted[i + 1] : match.length;
      const dur = end - t;
      const myH = getHeroesAtTime(teamUp, t);
      const thH = getHeroesAtTime(oppUp, t);
      if (myH > thH) advTime += dur;
    }
    team.stats.timeWithHeroAdv = advTime;
    team.stats.pctWithHeroAdv = match.length > 0 ? advTime / match.length : 0;
  }

  // PassiveXP diff
  const rate0 = match.teams["0"]?.stats.passiveXPRate ?? 0;
  const rate1 = match.teams["1"]?.stats.passiveXPRate ?? 0;
  const avg = (rate0 + rate1) / 2;
  if (match.teams["0"])
    match.teams["0"].stats.passiveXPDiff = avg > 0 ? rate0 / avg : 0;
  if (match.teams["1"])
    match.teams["1"].stats.passiveXPDiff = avg > 0 ? rate1 / avg : 0;
}

function getHeroesAtTime(uptime: UptimeEntry[], time: number): number {
  let heroes = 0;
  for (const u of uptime) {
    if (u.time <= time) heroes = u.heroes;
    else break;
  }
  return heroes;
}

function estimateRespawn(level: number): number {
  // Simplified respawn timer estimation based on level
  if (level <= 1) return 15;
  if (level <= 5) return 15 + (level - 1) * 2;
  if (level <= 10) return 23 + (level - 5) * 3;
  if (level <= 15) return 38 + (level - 10) * 4;
  return 58 + (level - 15) * 5;
}

// ── First events ────────────────────────────────────────────────────────────
function computeFirstEvents(match: MatchStat): void {
  // First fort
  let firstFortTime = Infinity;
  let firstFortTeam = -1;
  let firstKeepTime = Infinity;
  let firstKeepTeam = -1;

  for (const s of Object.values(match.structures)) {
    if (s.destroyed === undefined) continue;
    if (s.name === "Fort" && s.destroyed < firstFortTime) {
      firstFortTime = s.destroyed;
      firstFortTeam = s.team === 0 ? 1 : 0; // Team that destroyed it
    }
    if (s.name === "Keep" && s.destroyed < firstKeepTime) {
      firstKeepTime = s.destroyed;
      firstKeepTeam = s.team === 0 ? 1 : 0;
    }
  }

  if (firstFortTeam >= 0) {
    match.firstFort = firstFortTeam;
    match.firstFortWin = firstFortTeam === match.winner;
  }
  if (firstKeepTeam >= 0) {
    match.firstKeep = firstKeepTeam;
    match.firstKeepWin = firstKeepTeam === match.winner;
  }

  // First objective
  const allObjEvents = [
    ...match.objective[0].events.map((e) => ({ ...e, assignedTeam: 0 })),
    ...match.objective[1].events.map((e) => ({ ...e, assignedTeam: 1 })),
  ].sort((a, b) => a.loop - b.loop);

  if (allObjEvents.length > 0) {
    match.firstObjective = allObjEvents[0].assignedTeam;
    match.firstObjectiveWin = allObjEvents[0].assignedTeam === match.winner;
  }

  // First pick win
  match.firstPickWin = match.picks.first === match.winner;
}
