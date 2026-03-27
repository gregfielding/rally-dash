/**
 * Match `design_teams` row from filename-derived team slug.
 */

import type { DesignTeam } from "@/lib/types/firestore";

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Prefer exact id match, then slug, then teamCode, then substring / tag overlap.
 */
export function matchDesignTeam(
  teamSlugCandidate: string,
  teams: DesignTeam[]
): { team: DesignTeam | null; warnings: string[] } {
  const warnings: string[] = [];
  const cand = teamSlugCandidate.trim();
  if (!cand) {
    return { team: null, warnings: ["Missing team slug in identity"] };
  }

  const candNorm = normKey(cand);

  for (const t of teams) {
    if (t.id === cand || t.id.toLowerCase() === cand.toLowerCase()) {
      return { team: t, warnings };
    }
  }

  for (const t of teams) {
    if (t.slug && normKey(t.slug) === candNorm) return { team: t, warnings };
    if (t.teamCode && normKey(t.teamCode) === candNorm) return { team: t, warnings };
  }

  for (const t of teams) {
    if (normKey(t.id).includes(candNorm) || candNorm.includes(normKey(t.id))) {
      warnings.push(`Team matched loosely by id overlap: ${t.id}`);
      return { team: t, warnings };
    }
  }

  const candParts = cand.split("_").filter(Boolean);
  for (const t of teams) {
    const nameNorm = normKey(t.name || "");
    const hit = candParts.every((p) => p.length > 2 && nameNorm.includes(normKey(p)));
    if (hit) {
      warnings.push(`Team matched by name tokens: ${t.name}`);
      return { team: t, warnings };
    }
  }

  warnings.push(`No design_teams match for slug "${teamSlugCandidate}"`);
  return { team: null, warnings };
}
