/**
 * Tests for the deterministic parent-product doc id.
 *
 * Background: auto-launch occasionally created DUPLICATE parent `rp_products` docs for
 * the same (design, blank) — two concurrent `onDesignCreated` deliveries both read
 * "no parent" and both `.add()`-ed a random-id parent (a check-then-act race). The fix
 * routes new parents through a deterministic doc id derived from parentProductIdentityKey
 * so the create can be an atomic `.create()`: concurrent runs land on the SAME id and the
 * loser collides instead of duplicating.
 *
 * The whole fix hinges on this id being a *stable, collision-resistant function of the
 * identity key* — so that's what we lock down here. The function is pure, so these run
 * without the Firestore emulator (same convention as resolveSpawnBlanks.test.ts).
 */
import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parentProductDocId } = require("../../functions/lib/parentProductDocId") as {
  parentProductDocId: (parentProductIdentityKey: string) => string;
};

const KEY = "MLB_GIANTS_gih51OS7cD5lswKQMcln_LkZFIxcRGtiATyDKHndQ";

describe("parentProductDocId — deterministic parent dedupe id", () => {
  it("is deterministic — same identity key → same id (the whole point)", () => {
    expect(parentProductDocId(KEY)).toBe(parentProductDocId(KEY));
  });

  it("differs for different identity keys (no collisions on near-identical keys)", () => {
    // Same league/team/design, different blank → must be a different parent.
    const a = parentProductDocId("MLB_GIANTS_DESIGN1_BLANK_A");
    const b = parentProductDocId("MLB_GIANTS_DESIGN1_BLANK_B");
    expect(a).not.toBe(b);
  });

  it("is stable across processes (regression anchor — changing this re-keys all new parents)", () => {
    // If this value ever changes, parents created before the change can no longer be
    // found by their deterministic id — concurrent launches would resume duplicating.
    expect(parentProductDocId(KEY)).toBe(
      "p_b8d62965c4455b5e08b06e480320faf772f267d7c4073b37b816a62901f9d722"
    );
  });

  it("produces a Firestore-safe id (no '/', not a reserved __.*__ id, bounded length)", () => {
    const id = parentProductDocId(KEY);
    expect(id.startsWith("p_")).toBe(true);
    expect(id).not.toContain("/");
    expect(id).not.toMatch(/^__.*__$/);
    expect(id).not.toBe(".");
    expect(id).not.toBe("..");
    // sha256 hex (64) + "p_" prefix → fixed 66 chars, well under Firestore's 1500-byte cap
    // regardless of how long the identity key is.
    expect(id.length).toBe(66);
  });

  it("trims surrounding whitespace so the id is insensitive to incidental padding", () => {
    expect(parentProductDocId(`  ${KEY}  `)).toBe(parentProductDocId(KEY));
  });

  it("is case-sensitive on the key (keys are already UPPER_SNAKE-normalized upstream)", () => {
    // designId/blankId segments are raw Firestore ids and are NOT uppercased by
    // buildParentProductIdentityKey, so distinct-case keys are genuinely distinct.
    expect(parentProductDocId("MLB_X_aBc_def")).not.toBe(parentProductDocId("MLB_X_ABC_DEF"));
  });

  it("throws on an empty/missing identity key (never silently mint a shared parent id)", () => {
    expect(() => parentProductDocId("")).toThrow(/required/i);
    expect(() => parentProductDocId("   ")).toThrow(/required/i);
    // @ts-expect-error — exercising the defensive null guard
    expect(() => parentProductDocId(null)).toThrow(/required/i);
    // @ts-expect-error — exercising the defensive undefined guard
    expect(() => parentProductDocId(undefined)).toThrow(/required/i);
  });
});
