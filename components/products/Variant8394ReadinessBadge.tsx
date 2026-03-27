"use client";

import type { Variant8394ReadinessState } from "@/lib/products/variantReadiness";
import { variant8394ReadinessLabel } from "@/lib/products/variantReadiness";

const styles: Record<
  Variant8394ReadinessState,
  { className: string; ring: string }
> = {
  not_started: {
    className: "bg-gray-100 text-gray-700 border-gray-200",
    ring: "ring-gray-200/80",
  },
  mock_only: {
    className: "bg-amber-50 text-amber-900 border-amber-200",
    ring: "ring-amber-200/80",
  },
  base_complete: {
    className: "bg-emerald-50 text-emerald-900 border-emerald-200",
    ring: "ring-emerald-200/80",
  },
  error: {
    className: "bg-red-50 text-red-900 border-red-200",
    ring: "ring-red-200/80",
  },
};

export function Variant8394ReadinessBadge({
  state,
  title,
  compact,
}: {
  state: Variant8394ReadinessState;
  /** Extra detail (e.g. error message). */
  title?: string | null;
  compact?: boolean;
}) {
  const s = styles[state];
  const label = variant8394ReadinessLabel(state);
  return (
    <span
      title={title || (state === "error" ? undefined : label)}
      className={[
        "inline-flex items-center rounded-md border font-medium tabular-nums",
        compact ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
        "ring-1",
        s.ring,
        s.className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
