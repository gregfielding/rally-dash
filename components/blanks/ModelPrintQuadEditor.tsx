"use client";

/**
 * Phase L — 4-corner chest-quad editor for model photos.
 *
 * The operator drags 4 handles to bound the chest-print plane on a fixed,
 * angled model photo. The design preview warps live (CSS matrix3d computed
 * from the same homography the server uses) so you can see exactly where the
 * print lands as you drag. Saving persists normalized 0..1 corners to the
 * blank variant; the server renderer (composeStageA) then warps every design
 * onto that quad deterministically — identical geometry every render.
 *
 * Self-contained: takes the model photo URL + an optional design preview URL +
 * the current quad, and calls the saveModelPrintQuad callable. Mountable as a
 * modal from the blank render-profile editor for model_front / model_back.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions as firebaseFunctions } from "@/lib/firebase/config";
import type { RPModelPrintQuad } from "@/lib/types/firestore";

type CornerKey = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
const CORNER_ORDER: CornerKey[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

interface NormQuad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/** Sensible default quad — a centered upright rectangle over the upper torso. */
const DEFAULT_QUAD: NormQuad = {
  topLeft: { x: 0.36, y: 0.28 },
  topRight: { x: 0.64, y: 0.28 },
  bottomRight: { x: 0.64, y: 0.55 },
  bottomLeft: { x: 0.36, y: 0.55 },
};

interface ModelPrintQuadEditorProps {
  open: boolean;
  onClose: () => void;
  blankId: string;
  variantId: string;
  side: "front" | "back";
  modelPhotoUrl: string;
  /** Optional design PNG to preview warped inside the quad. */
  designPreviewUrl?: string | null;
  /** Existing saved quad, if any. */
  initialQuad?: RPModelPrintQuad | null;
  onSaved?: () => void;
}

export default function ModelPrintQuadEditor({
  open,
  onClose,
  blankId,
  variantId,
  side,
  modelPhotoUrl,
  designPreviewUrl,
  initialQuad,
  onSaved,
}: ModelPrintQuadEditorProps) {
  const [quad, setQuad] = useState<NormQuad>(DEFAULT_QUAD);
  const [dragging, setDragging] = useState<CornerKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  /** Seed from the saved quad when the modal opens. */
  useEffect(() => {
    if (!open) return;
    if (initialQuad && initialQuad.topLeft) {
      setQuad({
        topLeft: { x: initialQuad.topLeft.x, y: initialQuad.topLeft.y },
        topRight: { x: initialQuad.topRight.x, y: initialQuad.topRight.y },
        bottomRight: { x: initialQuad.bottomRight.x, y: initialQuad.bottomRight.y },
        bottomLeft: { x: initialQuad.bottomLeft.x, y: initialQuad.bottomLeft.y },
      });
    } else {
      setQuad(DEFAULT_QUAD);
    }
    setError(null);
  }, [open, initialQuad]);

  /** Pointer-move → update the dragged corner (clamped with small overscan). */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const nx = clamp((e.clientX - rect.left) / rect.width, -0.1, 1.1);
      const ny = clamp((e.clientY - rect.top) / rect.height, -0.1, 1.1);
      setQuad((prev) => ({ ...prev, [dragging]: { x: nx, y: ny } }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  /** Live CSS matrix3d for the design preview, derived from the 4 corners. */
  const designMatrix = useMemo(() => {
    const stage = stageRef.current;
    if (!stage || !designPreviewUrl) return null;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const dst: Array<[number, number]> = CORNER_ORDER.map((k) => [quad[k].x * w, quad[k].y * h]);
    // Unit square (1×1) → dst corners. The preview <img> is sized 1×1px then
    // transformed; matrix3d maps it onto the quad.
    const m = matrix3dForQuad(dst);
    return m;
    // Recompute when corners change or the stage resizes (open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quad, designPreviewUrl, open]);

  const handleSave = async () => {
    if (!firebaseFunctions) {
      setError("Firebase not initialized");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { blankId: string; variantId: string; side: string; quad: NormQuad },
        { ok: boolean }
      >(firebaseFunctions, "saveModelPrintQuad");
      await fn({ blankId, variantId, side, quad });
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!firebaseFunctions) return;
    if (!confirm("Clear the saved quad? Renders will fall back to flat placement.")) return;
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable<
        { blankId: string; variantId: string; side: string; clear: boolean },
        { ok: boolean }
      >(firebaseFunctions, "saveModelPrintQuad");
      await fn({ blankId, variantId, side, clear: true });
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Chest print quad — {side === "front" ? "Model Front" : "Model Back"}
            </h3>
            <p className="text-xs text-gray-500">
              Drag the 4 corners to bound the chest. The design warps to this shape every render.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="p-5">
          {/* Stage: model photo + draggable quad + live design preview. */}
          <div
            ref={stageRef}
            className="relative w-full bg-gray-100 rounded overflow-hidden select-none"
            style={{ aspectRatio: "2 / 3" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={modelPhotoUrl}
              alt="Model"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              draggable={false}
            />

            {/* Live warped design preview (CSS matrix3d). */}
            {designPreviewUrl && designMatrix ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={designPreviewUrl}
                alt="Design preview"
                className="absolute top-0 left-0 pointer-events-none"
                style={{
                  width: "1px",
                  height: "1px",
                  transformOrigin: "0 0",
                  transform: designMatrix,
                  opacity: 0.9,
                }}
                draggable={false}
              />
            ) : null}

            {/* Quad outline. */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
              <polygon
                points={CORNER_ORDER.map((k) => `${quad[k].x * 100}%,${quad[k].y * 100}%`).join(" ")}
                fill="rgba(59,130,246,0.12)"
                stroke="rgba(59,130,246,0.9)"
                strokeWidth={2}
              />
            </svg>

            {/* Draggable handles. */}
            {CORNER_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDragging(k);
                }}
                className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-white border-2 border-blue-600 shadow cursor-grab active:cursor-grabbing"
                style={{ left: `${quad[k].x * 100}%`, top: `${quad[k].y * 100}%` }}
                title={k}
              />
            ))}
          </div>

          {error ? (
            <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</p>
          ) : null}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-red-700 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
            >
              Clear quad (flat fallback)
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuad(DEFAULT_QUAD)}
                disabled={saving}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save quad"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Tip: align the top edge with the shoulders/collar and the bottom edge where the print should
            end. The side edges follow the body angle — pull the far-side corners inward for a 3/4 turn.
          </p>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute a CSS matrix3d string that maps the unit square (0,0)-(1,1) onto the
 * 4 destination corners (in container px, order TL,TR,BR,BL). Standard
 * "general 2D projection" technique: solve the source→dest homography, emit
 * the 4×4 column-major matrix CSS expects (z row identity).
 */
function matrix3dForQuad(dst: Array<[number, number]>): string | null {
  const src: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const H = general2DProjection(src, dst);
  if (!H) return null;
  // Normalize so H[8] = 1.
  for (let i = 0; i < 9; i++) H[i] /= H[8];
  // CSS matrix3d is column-major 4×4. Map the 3×3 homography
  // [a b c; d e f; g h i] into the 4×4 (x,y,1) projective form.
  const m = [
    H[0], H[3], 0, H[6],
    H[1], H[4], 0, H[7],
    0, 0, 1, 0,
    H[2], H[5], 0, H[8],
  ];
  return `matrix3d(${m.map((v) => round(v)).join(",")})`;
}

function round(v: number) {
  return Math.abs(v) < 1e-6 ? 0 : Number(v.toFixed(8));
}

/** Solve the 3×3 projective transform mapping 4 src → 4 dst points. */
function general2DProjection(
  src: Array<[number, number]>,
  dst: Array<[number, number]>
): number[] | null {
  // Build the basis-to-quad transforms for src and dst, then compose:
  // H = dstBasis · inverse(srcBasis).
  const s = basisToPoints(src);
  const d = basisToPoints(dst);
  if (!s || !d) return null;
  const sInv = adj3(s);
  return multmm(d, sInv);
}

function basisToPoints(p: Array<[number, number]>): number[] | null {
  const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
  const v = multmv(adj3(m), [p[3][0], p[3][1], 1]);
  return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

function multmm(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[3 * i + k] * b[3 * k + j];
      r[3 * i + j] = sum;
    }
  }
  return r;
}

function multmv(m: number[], v: number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function adj3(m: number[]): number[] {
  return [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3],
  ];
}
