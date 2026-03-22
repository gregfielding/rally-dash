import type { RpProduct } from "@/lib/types/firestore";

export type ProductDesignLink = {
  id: string;
  name: string;
  slug: string;
};

/** All design IDs referenced by a product (front/back/legacy paths). */
export function collectDesignIdsFromProduct(p: RpProduct): string[] {
  const ids = new Set<string>();
  const add = (x: string | null | undefined) => {
    if (x && typeof x === "string") ids.add(x);
  };
  add(p.designId);
  add(p.designIdFront);
  add(p.designIdBack);
  const rs = p.renderSetup;
  add(rs?.front?.designAssetId ?? undefined);
  add(rs?.back?.designAssetId ?? undefined);
  add(rs?.defaults?.designIdFront ?? undefined);
  add(rs?.defaults?.designIdBack ?? undefined);
  return [...ids];
}

/** Map designId → products that reference it (deduped per design). */
export function buildProductsByDesignMap(products: RpProduct[]): Map<string, ProductDesignLink[]> {
  const map = new Map<string, Map<string, ProductDesignLink>>();

  for (const p of products) {
    if (!p.id) continue;
    const link: ProductDesignLink = { id: p.id, name: p.name, slug: p.slug };
    for (const did of collectDesignIdsFromProduct(p)) {
      if (!map.has(did)) map.set(did, new Map());
      map.get(did)!.set(p.id, link);
    }
  }

  const out = new Map<string, ProductDesignLink[]>();
  for (const [did, m] of map) {
    out.set(did, [...m.values()]);
  }
  return out;
}
