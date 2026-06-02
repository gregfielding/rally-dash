"use strict";

/**
 * Phase C — Kontext scene template registry.
 *
 * Each template is a CURATED prompt + capability bag that drives Flux Kontext
 * (`fal-ai/flux-pro/kontext`) to produce a lifestyle / studio / gameday scene
 * variation of an existing product render. Kontext takes a source image +
 * edit prompt, returns the same product placed in a different setting with
 * matching color / pose / fabric — no actor, no photographer, no studio
 * booking required.
 *
 * Strategic context: Rally's PDP today shows the flat garment + a single
 * model shot. Apparel benchmarks (Outdoor Voices, Allbirds, Carhartt WIP)
 * show 4-6 lifestyle shots per product page. Kontext closes that gap at
 * ~$0.04 per scene — a 4-shot PDP is $0.16/product, $24 across 150 products
 * × 4 blanks. Cheap enough to regenerate seasonally.
 *
 * Architectural choices:
 *   - Prompts are HAND-TUNED per template, not parameterized. Lifestyle
 *     prompts are the highest-leverage tuning in the pipeline; generic
 *     "create a scene" prompts produce generic scenes. Each template's
 *     prompt is opinionated about lighting, mood, props, framing.
 *   - `recommendedSourceSlot` documents which existing render the operator
 *     should feed in (e.g. model_front_designed for lifestyle, flat_blended
 *     for hanger/studio). The trigger still accepts any source URL — the
 *     hint is just for the UI's default picker.
 *   - `category` groups templates in the UI ("Lifestyle", "Studio",
 *     "Gameday", "Editorial"). 4-shot PDP picks one from each category.
 *   - `experimental` flags templates that haven't been A/B-validated yet so
 *     the UI can warn before they get used in production batch fan-outs.
 *
 * Adding a template: implement carefully — a bad prompt produces $0.04 of
 * unusable output. Test on 2-3 representative source images before
 * registering. Don't add more than 12-15 templates; an operator picking
 * from a sea of options is worse than picking from a curated 8.
 */

/**
 * @typedef {Object} SceneTemplate
 * @property {string} id                    Stable identifier ("lifestyle_coffee", "studio_clean", etc).
 * @property {string} label                 Human-readable name for the UI.
 * @property {string} category              Group for the picker. One of: "Lifestyle", "Studio", "Gameday", "Editorial".
 * @property {string} description           One-liner shown under the label in the picker.
 * @property {string} prompt                The Kontext edit prompt. Should be opinionated about lighting/mood/props.
 * @property {"flat_front_designed"|"flat_back_designed"|"model_front_designed"|"model_back_designed"|"flat_blended"} recommendedSourceSlot
 *                                          UI default for which existing render to feed in.
 * @property {boolean} experimental         True until A/B-validated for Rally's brand.
 * @property {boolean} includedIn4ShotDefault Whether this template is in the default 4-shot PDP fan-out.
 */

/** @type {Record<string, SceneTemplate>} */
const SCENE_TEMPLATES = {
  /**
   * Stadium gameday — for sports apparel. Source: model_front_designed.
   * The "early evening" + "soft sunset light" framing keeps the print
   * readable; harsh midday light blows out screen-print colors.
   */
  gameday_stadium: {
    id: "gameday_stadium",
    label: "Gameday stadium",
    category: "Gameday",
    description: "Model in stadium concourse, soft early-evening light, blurred crowd background.",
    prompt:
      "Place this person in a baseball stadium concourse during early evening, golden hour lighting with soft warm tones, blurred crowd in the background, depth of field with the person sharp in focus, casual fan energy, preserve the garment color and print exactly as shown, maintain the same body pose and facial expression, photorealistic editorial photography style.",
    recommendedSourceSlot: "model_front_designed",
    experimental: false,
    includedIn4ShotDefault: true,
  },

  /**
   * Lifestyle coffee shop — the Instagram-ready shot. Bright but soft
   * lighting; minimal props so the garment stays the focus.
   */
  lifestyle_coffee: {
    id: "lifestyle_coffee",
    label: "Coffee shop lifestyle",
    category: "Lifestyle",
    description: "Cozy cafe interior, latte on a small wooden table, soft natural window light.",
    prompt:
      "Place this person in a cozy modern coffee shop interior, sitting at a small light-wood table near a window, holding a latte cup, soft natural window light, blurred coffee shop interior in the background, warm inviting mood, preserve the garment color, print design, body pose, and facial features exactly, photorealistic lifestyle photography.",
    recommendedSourceSlot: "model_front_designed",
    experimental: false,
    includedIn4ShotDefault: true,
  },

  /**
   * Outdoor park — for the "weekend casual" feel. Diffused outdoor light
   * (not direct sun) renders the print colors faithfully.
   */
  outdoor_park: {
    id: "outdoor_park",
    label: "Outdoor park",
    category: "Lifestyle",
    description: "Sunny park, green grass + soft tree blur, casual standing pose.",
    prompt:
      "Place this person standing in a sunny urban park, green grass and softly blurred trees in the background, casual weekend energy, diffused outdoor lighting (NOT harsh direct sunlight), preserve the garment color, print design, body pose, and facial features exactly, photorealistic lifestyle photography.",
    recommendedSourceSlot: "model_front_designed",
    experimental: false,
    includedIn4ShotDefault: false,
  },

  /**
   * Clean studio — the e-commerce default. Pure white background, even
   * lighting, like every Shopify catalog shot ever made. This is the
   * baseline shot a buyer expects from any apparel storefront.
   */
  studio_clean: {
    id: "studio_clean",
    label: "Clean studio",
    category: "Studio",
    description: "Pure white seamless background, even soft lighting, e-commerce default.",
    prompt:
      "Place this person against a pure white seamless studio background with even soft lighting from both sides, no shadows on the background, e-commerce catalog style, preserve the garment color, print design, body pose, and facial features exactly, professional studio photography.",
    recommendedSourceSlot: "model_front_designed",
    experimental: false,
    includedIn4ShotDefault: true,
  },

  /**
   * Editorial moody — high-contrast, magazine-style shot for hero PDP
   * placement. Deep colors and dramatic light differentiate it from the
   * other 3 shots in a 4-shot PDP.
   */
  editorial_moody: {
    id: "editorial_moody",
    label: "Editorial moody",
    category: "Editorial",
    description: "Dark moody background, dramatic side-light, magazine-cover energy.",
    prompt:
      "Place this person against a dark moody background with dramatic side-lighting from one direction, high contrast, magazine editorial photography style, deep saturated tones, preserve the garment color, print design, body pose, and facial features exactly, fashion photography aesthetic.",
    recommendedSourceSlot: "model_front_designed",
    experimental: true,
    includedIn4ShotDefault: true,
  },

  /**
   * Flatlay on table — props that imply lifestyle without a model. Good
   * fallback when there's no model photo, or for "shop the look" composites.
   */
  flatlay_table: {
    id: "flatlay_table",
    label: "Flatlay on table",
    category: "Studio",
    description: "Garment flat-laid on a light wood table with small lifestyle props.",
    prompt:
      "Place this flat garment on a light wood table from a top-down view, surrounded by a few minimal lifestyle props (a cup of coffee, a small succulent, a pair of sunglasses), soft natural lighting from above, preserve the garment shape, color, and print design exactly, lifestyle flatlay photography.",
    recommendedSourceSlot: "flat_blended",
    experimental: true,
    includedIn4ShotDefault: false,
  },

  /**
   * Hanging on rack — minimalist retail / closet vibe. Different from the
   * deterministic hanger template (productSceneRenderMvp) because Kontext
   * generates the entire scene from scratch including rack + lighting,
   * vs the deterministic version which composites onto a fixed template.
   */
  hanging_rack: {
    id: "hanging_rack",
    label: "Hanging on rack",
    category: "Studio",
    description: "Garment hanging on a minimal wood rack against a soft neutral wall.",
    prompt:
      "Place this garment hanging on a single wooden hanger on a minimal wood clothing rack, against a soft neutral wall (off-white or sage green), even diffused lighting, slight shadow on the wall behind, minimalist boutique retail style, preserve the garment shape, color, and print design exactly.",
    recommendedSourceSlot: "flat_blended",
    experimental: true,
    includedIn4ShotDefault: false,
  },

  /**
   * Detail crop — close-up on the print itself, intentionally tight crop
   * to show texture / fabric quality. Critical for screen-print verification
   * on the PDP ("does the ink really look like cotton fibers?").
   */
  detail_print_crop: {
    id: "detail_print_crop",
    label: "Print detail crop",
    category: "Editorial",
    description: "Tight crop on the print, showing fabric texture and ink details.",
    prompt:
      "Tight close-up macro photography of the screen-printed area on the garment, showing the ink texture pressed into the cotton fabric weave, soft natural lighting that brings out fabric fiber detail, preserve the print design, colors, and fabric texture exactly, no text overlay, no model, no background props, just the printed garment surface filling the frame.",
    recommendedSourceSlot: "model_front_designed",
    experimental: true,
    includedIn4ShotDefault: false,
  },
};

/** Lookup a template by id. Throws on miss — callers should validate upstream. */
function getSceneTemplate(id) {
  const t = SCENE_TEMPLATES[id];
  if (!t) {
    const known = Object.keys(SCENE_TEMPLATES).join(", ");
    throw new Error(`Unknown scene template "${id}". Known: ${known}`);
  }
  return t;
}

/** List all templates, optionally filtered by category. */
function listSceneTemplates(opts = {}) {
  const all = Object.values(SCENE_TEMPLATES);
  if (opts.category) return all.filter((t) => t.category === opts.category);
  return all;
}

/**
 * The 4-shot PDP default set. Curated to give one shot from each category
 * (gameday + lifestyle + studio + editorial) so a single batch produces
 * a varied PDP without operator decisions. Override per-product if needed.
 */
function getDefault4ShotTemplateIds() {
  return Object.values(SCENE_TEMPLATES)
    .filter((t) => t.includedIn4ShotDefault)
    .map((t) => t.id);
}

/**
 * Categories in display order — Lifestyle first because it's the most
 * impactful shot type for apparel PDPs. Editorial last because the moody
 * lighting can hide print details (use sparingly).
 */
const SCENE_CATEGORIES = ["Lifestyle", "Studio", "Gameday", "Editorial"];

module.exports = {
  SCENE_TEMPLATES,
  SCENE_CATEGORIES,
  getSceneTemplate,
  listSceneTemplates,
  getDefault4ShotTemplateIds,
};
