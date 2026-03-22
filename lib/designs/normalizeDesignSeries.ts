/**
 * Normalize optional "design series" / campaign slug: lowercase snake_case.
 * Used on blur when saving to Firestore (not a strict enum).
 */
export function normalizeDesignSeriesInput(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const out = s
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return out || null;
}
