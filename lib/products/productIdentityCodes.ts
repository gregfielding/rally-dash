/**
 * League/team code resolution for product identity keys.
 * Must stay in sync with `functions/lib/runCreateProductFromDesignBlankCore.js`
 * (`leagueCodeRaw` / `teamCodeRaw`).
 */

import type { DesignDoc, DesignTeam } from "@/lib/types/firestore";

export function resolveLeagueCodeRawForProductIdentity(
  design: DesignDoc,
  team: DesignTeam | null | undefined
): string {
  return design.leagueCode || (team && (team.leagueId || team.league)) || "";
}

export function resolveTeamCodeRawForProductIdentity(
  design: DesignDoc,
  team: DesignTeam | null | undefined
): string {
  return design.teamCode || (team && (team.teamCode || team.id)) || design.teamId || "";
}
