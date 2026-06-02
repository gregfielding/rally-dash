"use client";

/**
 * Phase F (teams → design_teams merge, 2026-06-01) — this page is now a
 * deprecation notice that redirects to `/design-teams` (the canonical
 * team admin surface).
 *
 * History: the legacy `teams` collection served `/teams` for early team
 * CRUD before the canonical `design_teams` collection was established.
 * Phase F audit confirmed:
 *   - No cloud functions read `teams`.
 *   - No designs / products reference `teams` doc ids.
 *   - The bulk seeder (`npm run seed:design-teams`) writes to design_teams,
 *     not here — so this page only ever showed rows operators created
 *     manually via old tooling.
 *
 * Migration script: functions/scripts/migrate-teams-into-design-teams.js
 * (idempotent; dry-run safe). Run that before final removal of the
 * `teams` collection. After migration the `useTeams` hook stays exported
 * for one cycle in case anything imports it, then can be removed.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";

/** Soft auto-redirect after 5 seconds so the operator sees the deprecation
 *  notice before being moved. Long enough to read; short enough to not annoy.
 */
const AUTO_REDIRECT_MS = 5000;

function TeamsDeprecatedContent() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/design-teams"), AUTO_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
        <h1 className="text-2xl font-bold text-amber-900 mb-3">
          /teams is deprecated
        </h1>
        <p className="text-amber-900 mb-4">
          The legacy <code className="bg-amber-100 px-1 rounded">teams</code> collection has
          been merged into <strong>design_teams</strong>. All team management now lives at{" "}
          <Link href="/design-teams" className="underline font-semibold">
            /design-teams
          </Link>
          .
        </p>
        <p className="text-sm text-amber-800 mb-4">
          You&rsquo;ll be redirected automatically in a few seconds.
        </p>
        <ul className="text-sm text-amber-900 space-y-1 mb-5">
          <li>
            <strong>What changed:</strong> the simpler <code>teams</code> schema is now part of
            the richer <code>design_teams</code> schema (with CMYK colors, product catalog
            matrix, and team metadata).
          </li>
          <li>
            <strong>Your data:</strong> if you had custom rows in <code>teams</code>, the
            migration script copies them to <code>design_teams</code> under the canonical
            team slug. Re-run with <code>--dry-run</code> first to preview.
          </li>
          <li>
            <strong>Doc id:</strong> design_teams uses the canonical slug
            (<code>san_francisco_giants</code>), not the kebab-case (<code>sf-giants</code>)
            that <code>teams</code> used.
          </li>
        </ul>
        <div className="flex items-center gap-3">
          <Link
            href="/design-teams"
            className="px-4 py-2 bg-amber-700 text-white rounded font-semibold hover:bg-amber-800"
          >
            Go to /design-teams now
          </Link>
          <Link
            href="/catalog"
            className="px-4 py-2 border border-amber-300 text-amber-900 rounded hover:bg-amber-100"
          >
            Back to catalog
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function TeamsPage() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <TeamsDeprecatedContent />
    </ProtectedRoute>
  );
}
