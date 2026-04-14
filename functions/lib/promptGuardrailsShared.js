"use strict";

/**
 * Shared prompt resolver (moved from index.js for reuse by createGenerationJob + HTTPS handlers).
 */

function joinPos(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(", ");
}

function joinNeg(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(", ");
}

function normalizePrompt(text) {
  if (!text) return "";
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/^,|,$/g, "");
}

function clamp01(n) {
  if (typeof n !== "number" || isNaN(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function resolvePromptWithGuardrails(input) {
  const trace = [];
  const loras = [];

  const {
    product,
    preset,
    identity,
    faceArtifact,
    bodyArtifact,
    productArtifact,
    faceScale,
    bodyScale,
    productScale,
    additionalPrompt,
    additionalNegativePrompt,
  } = input;

  let prompt = preset.promptTemplate || "";
  let negative = preset.negativePromptTemplate || "";

  const mode = preset.mode || (input.generationType === "product_only" ? "productOnly" : "onModel");

  if (mode === "productOnly") {
    trace.push("preset.mode=productOnly → stripped identity + face/body artifacts");
    prompt = joinPos("clean ecommerce packshot, product only", prompt);
    negative = joinNeg(negative, "person, model, mannequin, body, hands, legs, torso, wearing");
  } else {
    trace.push("preset.mode=onModel → enforced female subject constraints");
    prompt = joinPos("adult woman, female model", prompt);
    negative = joinNeg(negative, "man, male, boy");
  }

  if (mode === "onModel") {
    if (preset.requireIdentity !== false && !identity) {
      throw new Error("Identity required for this preset");
    }
    if (identity) {
      const trigger = identity.token || identity.defaultTriggerPhrase || identity.triggerPhrase || "";
      if (trigger) {
        const identityDescriptor = identity.description || "blonde hair, blue-green eyes";
        prompt = joinPos(trigger, identityDescriptor, prompt);
        trace.push("identity trigger front-loaded");
      }
    }
  }

  const isUnderwear = ["panties", "underwear", "lingerie"].includes(product.category);
  const strict = preset.safetyProfile === "underwear_strict" || (isUnderwear && mode === "onModel");
  if (strict) {
    prompt = joinPos(prompt, "wearing matching bra or bralette and panties, fully covered, no nudity");
    negative = joinNeg(negative, "nude, topless, nipples, areola, exposed breasts, naked, explicit");
    trace.push("underwear_strict clamp applied (wardrobe + nudity negative)");
  }

  if (mode === "onModel") {
    if (preset.allowFaceArtifact !== false && faceArtifact) {
      const weight = clamp01(faceScale ?? preset.defaultFaceScale ?? preset.defaults?.faceScale ?? 0.8);
      if (weight !== null) {
        loras.push({
          artifactId: faceArtifact.id,
          type: "face",
          weight,
          trigger: faceArtifact.trigger || null,
        });
        trace.push(`face artifact added (weight: ${weight})`);
      }
    }
    if (preset.allowBodyArtifact !== false && bodyArtifact) {
      const weight = clamp01(bodyScale ?? preset.defaultBodyScale ?? preset.defaults?.bodyScale ?? 0.6);
      if (weight !== null) {
        loras.push({
          artifactId: bodyArtifact.id,
          type: "body",
          weight,
          trigger: bodyArtifact.trigger || null,
        });
        trace.push(`body artifact added (weight: ${weight})`);
      }
    }
  }

  if (preset.allowProductArtifact !== false && productArtifact) {
    const weight = clamp01(productScale ?? preset.defaultProductScale ?? preset.defaults?.productScale ?? 0.9);
    if (weight !== null) {
      loras.push({
        artifactId: productArtifact.id,
        type: "product",
        weight,
        trigger: productArtifact.trigger || null,
      });
      trace.push(`product artifact added (weight: ${weight})`);
    }
  }

  if (additionalPrompt) {
    prompt = joinPos(prompt, additionalPrompt);
    trace.push("additional prompt override applied");
  }
  if (additionalNegativePrompt) {
    negative = joinNeg(negative, additionalNegativePrompt);
    trace.push("additional negative prompt override applied");
  }

  prompt = prompt
    .replace(/{productName}/g, product.name || "")
    .replace(/{productColorway}/g, product.colorway?.name || "")
    .replace(/{productCategory}/g, product.category || "")
    .replace(/{identityTrigger}/g, identity?.token || identity?.defaultTriggerPhrase || identity?.triggerPhrase || "")
    .replace(/{identityDescriptor}/g, identity?.description || "")
    .replace(/{PRODUCT_TRIGGER}/g, product.ai?.productTrigger || product.baseProductKey || "")
    .replace(/{COLORWAY_NAME}/g, product.colorway?.name || "");

  prompt = normalizePrompt(prompt);
  negative = normalizePrompt(negative);

  return {
    prompt,
    negativePrompt: negative,
    loras,
    trace,
  };
}

function resolvePrompt(args) {
  const { generationType, product, scenePreset, identity } = args;
  const mode = generationType === "product_only" ? "productOnly" : "onModel";
  return resolvePromptWithGuardrails({
    product,
    preset: scenePreset,
    identity,
    faceArtifact: args.faceArtifact || null,
    bodyArtifact: args.bodyArtifact || null,
    productArtifact: args.productArtifact || null,
    faceScale: args.faceScale,
    bodyScale: args.bodyScale,
    productScale: args.productScale,
    generationType,
  });
}

module.exports = {
  joinPos,
  joinNeg,
  normalizePrompt,
  clamp01,
  resolvePromptWithGuardrails,
  resolvePrompt,
};
