/**
 * Client-side canvas / getImageData requires CORS on cross-origin images when using
 * `crossOrigin = "anonymous"`. Firebase Storage often omits ACAO for localhost.
 * Route handler `app/api/storage-proxy` fetches the asset server-side (no browser CORS)
 * and serves it same-origin.
 */
const ALLOWED_CANVAS_IMAGE_HOSTS = new Set(["firebasestorage.googleapis.com", "storage.googleapis.com"]);

export function proxiedImageUrlForCanvas(url: string): string {
  if (typeof window === "undefined") return url;
  const t = url.trim();
  if (!t.startsWith("http://") && !t.startsWith("https://")) return url;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return url;
    if (!ALLOWED_CANVAS_IMAGE_HOSTS.has(u.hostname)) return url;
    return `/api/storage-proxy?url=${encodeURIComponent(t)}`;
  } catch {
    return url;
  }
}
