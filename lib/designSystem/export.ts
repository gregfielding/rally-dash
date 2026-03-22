import type { DesignSystemLeague } from "@/lib/types/firestore";

/** Illustrator-oriented export: league → teamCode → hex list (palette order). */
export function buildIllustratorSwatchExport(
  leagues: DesignSystemLeague[]
): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const league of leagues) {
    const code = league.leagueCode || league.id;
    out[code] = {};
    for (const team of league.teams || []) {
      if (!team.teamCode) continue;
      out[code][team.teamCode] = (team.colors || []).map((c) => c.hex).filter(Boolean);
    }
  }
  return out;
}

export function buildIllustratorSwatchExportForLeague(
  league: DesignSystemLeague
): Record<string, Record<string, string[]>> {
  return buildIllustratorSwatchExport([league]);
}

/** Single-team snippet for clipboard (same shape as full export, one team). */
export function buildTeamSwatchJsonObject(
  league: DesignSystemLeague,
  teamCode: string
): Record<string, Record<string, string[]>> | null {
  const team = (league.teams || []).find((t) => t.teamCode === teamCode);
  if (!team) return null;
  const code = league.leagueCode || league.id;
  return {
    [code]: {
      [team.teamCode]: (team.colors || []).map((c) => c.hex).filter(Boolean),
    },
  };
}
