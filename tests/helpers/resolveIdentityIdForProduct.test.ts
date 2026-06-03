/**
 * Tests for the Phase I7 identity resolver.
 *
 * The resolver is the bridge between a product and the Amber identity:
 *   product.teamId → design_teams/{teamId}.generationDefaults.defaultIdentityId
 *
 * Mocks Firestore via a minimal fake db so the test doesn't need the emulator.
 * Behavior the tests guard:
 *   - explicit override wins, no team read at all
 *   - missing teamId returns null (no read)
 *   - team not found returns null + logs warn (no throw)
 *   - team without generationDefaults returns null
 *   - team with empty/whitespace-only defaultIdentityId returns null
 *   - thrown Firestore error swallowed, returns null + logs warn
 *   - whitespace trimmed on both teamId and identityId
 */
import { describe, it, expect, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveIdentityIdForProduct } = require("../../functions/lib/enqueueProductModelRealism") as {
  resolveIdentityIdForProduct: (
    db: unknown,
    product: unknown,
    opts?: { explicitOverride?: string }
  ) => Promise<string | null>;
};

/**
 * Tiny Firestore stub. `docs` is a map of "{collection}/{docId}" → data, with
 * a couple of switches for throw / not-found semantics.
 */
function makeDb(docs: Record<string, unknown> = {}, errors: Record<string, Error> = {}) {
  return {
    collection: (collectionName: string) => ({
      doc: (docId: string) => ({
        get: async () => {
          const key = `${collectionName}/${docId}`;
          if (errors[key]) throw errors[key];
          if (docs[key] !== undefined) {
            return { exists: true, data: () => docs[key] };
          }
          return { exists: false, data: () => undefined };
        },
      }),
    }),
  };
}

describe("resolveIdentityIdForProduct", () => {
  it("returns explicit override and skips the team read entirely", async () => {
    const db = makeDb(); // empty — would return null normally
    const id = await resolveIdentityIdForProduct(
      db,
      { teamId: "sf_giants" },
      { explicitOverride: "manual_amber" }
    );
    expect(id).toBe("manual_amber");
  });

  it("returns null when product has no teamId", async () => {
    const db = makeDb({
      "design_teams/sf_giants": {
        generationDefaults: { defaultIdentityId: "amber" },
      },
    });
    expect(await resolveIdentityIdForProduct(db, {})).toBeNull();
    expect(await resolveIdentityIdForProduct(db, { teamId: "" })).toBeNull();
    expect(await resolveIdentityIdForProduct(db, { teamId: "   " })).toBeNull();
    expect(await resolveIdentityIdForProduct(db, { teamId: null })).toBeNull();
  });

  it("returns the identityId from the team's generationDefaults", async () => {
    const db = makeDb({
      "design_teams/sf_giants": {
        generationDefaults: { defaultIdentityId: "amber" },
      },
    });
    expect(
      await resolveIdentityIdForProduct(db, { teamId: "sf_giants" })
    ).toBe("amber");
  });

  it("returns null when the team doc doesn't exist (warn, no throw)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeDb({}); // no doc at sf_giants
    expect(
      await resolveIdentityIdForProduct(db, { teamId: "sf_giants" })
    ).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null when team has no generationDefaults", async () => {
    const db = makeDb({
      "design_teams/sf_giants": { name: "SF Giants" }, // no generationDefaults
    });
    expect(
      await resolveIdentityIdForProduct(db, { teamId: "sf_giants" })
    ).toBeNull();
  });

  it("returns null when defaultIdentityId is empty / whitespace", async () => {
    const empty = makeDb({
      "design_teams/sf_giants": {
        generationDefaults: { defaultIdentityId: "" },
      },
    });
    const space = makeDb({
      "design_teams/sf_giants": {
        generationDefaults: { defaultIdentityId: "   " },
      },
    });
    expect(await resolveIdentityIdForProduct(empty, { teamId: "sf_giants" })).toBeNull();
    expect(await resolveIdentityIdForProduct(space, { teamId: "sf_giants" })).toBeNull();
  });

  it("trims whitespace from teamId and defaultIdentityId", async () => {
    const db = makeDb({
      "design_teams/sf_giants": {
        generationDefaults: { defaultIdentityId: "  amber  " },
      },
    });
    expect(
      await resolveIdentityIdForProduct(db, { teamId: "  sf_giants  " })
    ).toBe("amber");
  });

  it("swallows Firestore errors and returns null (warn, no throw)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = makeDb({}, {
      "design_teams/sf_giants": new Error("network blew up"),
    });
    /**
     * Why this matters: the resolver MUST be best-effort — a single broken
     * team doc shouldn't halt every product realism enqueue across the catalog.
     */
    expect(
      await resolveIdentityIdForProduct(db, { teamId: "sf_giants" })
    ).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("explicit override beats a broken team read (defense in depth)", async () => {
    const db = makeDb({}, {
      "design_teams/sf_giants": new Error("broken"),
    });
    /** Override should never trigger a Firestore read — guards against the
     *  case where a partially-broken team would otherwise prevent operator
     *  testing of a different identity. */
    const id = await resolveIdentityIdForProduct(
      db,
      { teamId: "sf_giants" },
      { explicitOverride: "amber_test" }
    );
    expect(id).toBe("amber_test");
  });
});
