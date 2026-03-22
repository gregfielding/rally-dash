"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function DesignGuidePage() {
  return (
    <ProtectedRoute requiredRole="viewer">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <p className="text-sm text-gray-500 mb-4">
          <Link href="/design-system" className="text-blue-600 hover:text-blue-800 underline">
            ← Design system
          </Link>
        </p>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Design guide</h1>
        <p className="text-gray-600 mb-10">
          Illustrator workflow, naming, and how Rally stores league / team colors in Firestore.
        </p>

        <section className="mb-10 rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Team data: three different places</h2>
          <p className="text-sm text-gray-800 mb-3">
            It is easy to seed one place and look at another in the UI. They are separate collections:
          </p>
          <ul className="list-disc pl-5 text-gray-800 space-y-2 text-sm">
            <li>
              <strong>design_teams</strong> — Canonical roster for DesignOps (Phase 1 seed:{" "}
              <code className="bg-amber-100 px-1 rounded text-xs">functions/</code>{" "}
              <code className="bg-amber-100 px-1 rounded text-xs">npm run seed:design-teams</code>
              ). Browse all rows (colors + metadata) on{" "}
              <Link href="/design-teams" className="text-blue-700 underline">Team roster</Link>
              . Used by <Link href="/designs" className="text-blue-700 underline">Designs</Link> and related flows. The
              legacy Cloud Function <code className="bg-amber-100 px-1 rounded text-xs">seedDesignTeams</code> still
              exists for emergencies but is not linked from the app.
            </li>
            <li>
              <strong>teams</strong> — Legacy CRUD list on <Link href="/teams" className="text-blue-700 underline">/teams</Link>{" "}
              (Catalog-era). Not populated by the Phase 1 script.
            </li>
            <li>
              <strong>leagues</strong> — Powers the league dropdown on <Link href="/teams" className="text-blue-700 underline">/teams</Link>{" "}
              and <Link href="/leagues" className="text-blue-700 underline">/leagues</Link>. Separate from{" "}
              <code className="bg-amber-100 px-1 rounded">design_system</code> league docs.
            </li>
            <li>
              <strong>design_system</strong> — Per-league color libraries for Illustrator / export (
              <Link href="/design-system" className="text-blue-700 underline">/design-system</Link>
              ). Not the same shape as <code className="bg-amber-100 px-1 rounded">design_teams</code>.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Firestore structure (design_system)</h2>
          <ul className="list-disc pl-5 text-gray-700 space-y-2 text-sm">
            <li>
              <strong>Collection:</strong> <code className="bg-gray-100 px-1 rounded">design_system</code>
            </li>
            <li>
              <strong>Document ID:</strong> league code (e.g. <code className="bg-gray-100 px-1 rounded">MLB</code>
              , <code className="bg-gray-100 px-1 rounded">NFL</code>)
            </li>
            <li>
              <strong>Fields:</strong> <code className="bg-gray-100 px-1 rounded">leagueCode</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">leagueName</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">teams</code> (array)
            </li>
            <li>
              Each team: <code className="bg-gray-100 px-1 rounded">teamCode</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">teamName</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">colors[]</code> with{" "}
              <code className="bg-gray-100 px-1 rounded">role</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">name</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">hex</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">cmyk</code>{" "}
              <code className="bg-gray-100 px-1 rounded">{"{ c, m, y, k }"}</code>
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-600">
            Example seed file:{" "}
            <code className="bg-gray-100 px-1 rounded text-xs">
              data/firestore-seeds/design-system-mlb.example.json
            </code>{" "}
            — paste fields into a new document in the Firebase console, or use a future importer.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Illustrator workflow (manual)</h2>
          <ol className="list-decimal pl-5 text-gray-700 space-y-2 text-sm">
            <li>Open <Link href="/design-system" className="text-blue-600 underline">Design system</Link> and select the league.</li>
            <li>Use <strong>Copy HEX</strong> or <strong>Copy CMYK</strong> per team, or <strong>Copy swatch JSON</strong> for a structured snippet.</li>
            <li>
              Use <strong>Export Illustrator swatches</strong> to download JSON for all leagues in the project:{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">
                {"{ \"MLB\": { \"SFGIANTS\": [\"#FD5A1E\", \"#27251F\"] } }"}
              </code>
            </li>
            <li>In Illustrator, create swatches from hex (or convert via script). ASE export is planned for a later step.</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Naming conventions</h2>
          <ul className="list-disc pl-5 text-gray-700 space-y-2 text-sm">
            <li>
              <strong>League code:</strong> short uppercase token matching the document ID (e.g.{" "}
              <code className="bg-gray-100 px-1 rounded">MLB</code>).
            </li>
            <li>
              <strong>Team code:</strong> stable, unique per league (e.g.{" "}
              <code className="bg-gray-100 px-1 rounded">SFGIANTS</code>) — used in export keys and future filename / import mapping.
            </li>
            <li>
              <strong>Color role:</strong> <code className="bg-gray-100 px-1 rounded">primary</code>,{" "}
              <code className="bg-gray-100 px-1 rounded">secondary</code>, or other labels as needed; order in the array is the export order for swatch lists.
            </li>
            <li>
              <strong>Display name:</strong> human-readable swatch name (e.g. &quot;Giants Orange&quot;).
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Export format</h2>
          <p className="text-gray-700 text-sm mb-2">
            The JSON export groups hex values by league, then team code:
          </p>
          <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-x-auto">
{`{
  "MLB": {
    "SFGIANTS": ["#FD5A1E", "#27251F"]
  }
}`}
          </pre>
          <p className="text-gray-600 text-sm mt-3">
            This is the bridge format before ASE (Adobe Swatch Exchange) generation.
          </p>
        </section>

        <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Future (not built yet)</h2>
          <p className="text-gray-600 text-sm">
            Filename parser, bulk importer, and design auto-mapping will consume this same Firestore model and export shape — keep codes consistent so automation can join on{" "}
            <code className="bg-gray-100 px-1 rounded">leagueCode</code> /{" "}
            <code className="bg-gray-100 px-1 rounded">teamCode</code>.
          </p>
        </section>
      </div>
    </ProtectedRoute>
  );
}
