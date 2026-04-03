/**
 * Client read mapping for `rp_blanks` documents (field normalization on fetch).
 */

import type { RPBlank } from "@/lib/types/firestore";
import { normalizeRPBlankRenderProfile } from "./renderProfileNormalize";

export function mapRpBlankFromFirestore(docId: string, raw: Record<string, unknown>): RPBlank {
  const blank = { ...raw, blankId: docId } as RPBlank;
  return {
    ...blank,
    renderProfile: normalizeRPBlankRenderProfile(raw.renderProfile),
  };
}
