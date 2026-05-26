#!/usr/bin/env node
/**
 * One-off Shopify OAuth install handshake — captures the admin API access token
 * for a single-store custom app without needing to deploy a real OAuth handler.
 *
 * Why this exists:
 *   The Shopify Dev Dashboard (the modern replacement for Admin → Develop apps)
 *   doesn't expose admin API access tokens directly — it requires every app to
 *   go through the OAuth install handshake even for single-store custom use.
 *   The handshake sends a `?code=...` callback to the app's configured App URL,
 *   which is supposed to be a real backend that exchanges the code for an
 *   access token via POST /admin/oauth/access_token.
 *
 *   For a single store like Rally Panties, we don't actually need a permanent
 *   OAuth handler. This script spins up an HTTP server on localhost:3456 just
 *   long enough to catch the callback, swaps the code for the access token,
 *   prints it, and exits. The token then goes into Firebase Secret Manager.
 *
 * Prereqs in the Dev Dashboard (one-time, before running this):
 *   1. App URL = http://localhost:3456
 *   2. Redirect URLs = http://localhost:3456/callback
 *   3. "Use legacy install flow" checkbox = checked
 *   4. Embed app in Shopify admin = unchecked
 *   5. Release a new version (the Dev Dashboard requires re-release when
 *      URLs / scopes change)
 *
 * Usage:
 *   node scripts/shopify-oauth-localhost.js \
 *     --client-id=<from Dev Dashboard Settings → Credentials → Client ID> \
 *     --client-secret=<from Dev Dashboard Settings → Credentials → Secret (revealed)> \
 *     --shop=0c1d2c-80.myshopify.com
 *
 *   Or set as env vars:
 *     SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... SHOPIFY_SHOP=...
 *     node scripts/shopify-oauth-localhost.js
 *
 * After running, you'll see:
 *   1. An install URL printed in the terminal
 *   2. Paste it into your browser, click "Install app" on Shopify's screen
 *   3. The script catches the callback, exchanges code → token, prints token + exits
 *   4. The terminal shows the token and HOW to wire it up
 *
 * No external dependencies — uses only Node's built-in http + crypto + fetch.
 */

"use strict";

const http = require("http");
const crypto = require("crypto");

const PORT = 3456;

function parseFlag(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const CLIENT_ID = parseFlag("client-id", process.env.SHOPIFY_CLIENT_ID);
const CLIENT_SECRET = parseFlag("client-secret", process.env.SHOPIFY_CLIENT_SECRET);
const SHOP = parseFlag("shop", process.env.SHOPIFY_SHOP);

if (!CLIENT_ID || !CLIENT_SECRET || !SHOP) {
  console.error("\n[fatal] Missing required input. Pass via --flags or env vars:");
  console.error("  --client-id        (Dev Dashboard → Settings → Credentials → Client ID)");
  console.error("  --client-secret    (Dev Dashboard → Settings → Credentials → Secret reveal)");
  console.error("  --shop             (e.g. 0c1d2c-80.myshopify.com)");
  console.error("\nExample:");
  console.error("  node scripts/shopify-oauth-localhost.js \\");
  console.error("    --client-id=1cdcce87... \\");
  console.error("    --client-secret=shpss_... \\");
  console.error("    --shop=0c1d2c-80.myshopify.com\n");
  process.exit(2);
}

/**
 * Scopes the Rally Panties sync needs. Must match what's set in the Dev
 * Dashboard Settings → Access → Scopes field, otherwise the OAuth handshake
 * silently downgrades and certain mutations will 403 later.
 */
const SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_publications",
  "write_publications",
  "read_files",
  "write_files",
  "read_orders",
  "read_fulfillments",
  "write_fulfillments",
].join(",");

const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const STATE_NONCE = crypto.randomBytes(16).toString("hex");

const INSTALL_URL =
  `https://${SHOP}/admin/oauth/authorize` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&state=${STATE_NONCE}` +
  `&grant_options[]=`;

let server;

async function exchangeCodeForToken(code) {
  const url = `https://${SHOP}/admin/oauth/access_token`;
  const body = JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body,
  });
  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(
      `Shopify access_token exchange failed (HTTP ${resp.status}): ${JSON.stringify(json)}`
    );
  }
  return json;
}

server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const shopParam = url.searchParams.get("shop");

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h2>Missing code</h2><p>Shopify didn't include a code param. Did you click Install?</p>");
      return;
    }
    if (state !== STATE_NONCE) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h2>State mismatch</h2><p>Expected ${STATE_NONCE}, got ${state}. Re-run the script.</p>`);
      return;
    }
    if (shopParam && shopParam !== SHOP) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h2>Shop mismatch</h2><p>Expected ${SHOP}, got ${shopParam}. Re-run with the right --shop.</p>`);
      return;
    }

    try {
      const tokenResp = await exchangeCodeForToken(code);
      const token = tokenResp.access_token;
      const scope = tokenResp.scope;
      console.log("\n┌──────────────────────────────────────────────────────────────────");
      console.log("│ ✓ Admin API access token captured");
      console.log("└──────────────────────────────────────────────────────────────────");
      console.log(`\n  shop:   ${SHOP}`);
      console.log(`  scope:  ${scope}`);
      console.log(`  token:  ${token}\n`);
      console.log("Next steps:");
      console.log("  1. Copy the token above (treat like a password).");
      console.log("  2. Paste it in the Claude Code chat — parent agent will set it");
      console.log("     in Firebase Secret Manager + run the connection smoke test.");
      console.log("  3. (Recommended) After it's working, uninstall + reinstall the app");
      console.log("     to invalidate this token, then redo the flow to get a fresh one");
      console.log("     that hasn't appeared in chat history.\n");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 4em auto; padding: 0 1em;">
          <h1 style="color: #1f883d;">✓ Token captured</h1>
          <p>The admin API access token has been printed to your terminal. You can close this tab.</p>
          <p style="color: #57606a; font-size: 13px;">Shop: <code>${SHOP}</code><br/>Scopes: <code>${scope}</code></p>
        </body></html>
      `);

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 500);
    } catch (err) {
      console.error("\n[fatal] Token exchange failed:", err && err.message ? err.message : err);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h2>Token exchange failed</h2><pre>${err && err.message ? err.message : err}</pre>`);
    }
  } else if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="font-family: -apple-system, sans-serif; max-width: 640px; margin: 4em auto; padding: 0 1em;">
        <h1>Rally Panties Shopify OAuth installer</h1>
        <p>Click below to start the Shopify install handshake. After approving in Shopify, you'll land back here and the access token will print to your terminal.</p>
        <p><a href="${INSTALL_URL}" style="display: inline-block; padding: 10px 18px; background: #1f883d; color: white; text-decoration: none; border-radius: 6px;">Install on ${SHOP}</a></p>
      </body></html>
    `);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log("\n┌──────────────────────────────────────────────────────────────────");
  console.log("│ Rally Panties Shopify OAuth installer — localhost handshake");
  console.log("└──────────────────────────────────────────────────────────────────\n");
  console.log(`  Server listening at http://localhost:${PORT}`);
  console.log(`  Shop:    ${SHOP}`);
  console.log(`  Scopes:  ${SCOPES}\n`);
  console.log("Open this URL in your browser to start the install:\n");
  console.log(`  http://localhost:${PORT}\n`);
  console.log("(Or paste the direct install URL straight into Shopify if you prefer:)\n");
  console.log(`  ${INSTALL_URL}\n`);
  console.log("Waiting for Shopify to call back at /callback…\n");
});
