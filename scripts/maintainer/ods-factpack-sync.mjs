#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sanitizeOdsBullets,
  sanitizeOdsOverview,
} from "../../lib/knowledge/ods-quality-gate.js";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..", "..");
const OUT_FILE = path.join(ROOT_DIR, "lib", "knowledge", "ods-factpack.json");

const ODS_API = "https://ods.od.nih.gov/api/";

const CORE_RECIPES = [
  {
    key: "vitamin c",
    resourceName: "VitaminC",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/VitaminC-Consumer/",
    overview:
      "Vitamin C (ascorbic acid) is a water-soluble antioxidant nutrient that supports collagen formation and normal immune function.",
    whatItDoes: [
      "Helps support immune system function.",
      "Supports collagen formation for skin, blood vessels, and connective tissues.",
      "Can improve iron absorption from plant-based foods.",
    ],
    watchOuts: [
      "High supplemental doses can cause stomach upset or diarrhea.",
      "Large doses may increase risk in people with iron overload conditions.",
      "Check total intake if taking multiple products with vitamin C.",
    ],
  },
  {
    key: "vitamin d",
    resourceName: "VitaminD",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/VitaminD-Consumer/",
    overview:
      "Vitamin D supports calcium balance, bone health, and immune function, and is commonly used when sunlight exposure is limited.",
    whatItDoes: [
      "Supports calcium absorption and bone health.",
      "Helps maintain normal muscle and immune function.",
      "Often used to address low vitamin D intake or status.",
    ],
    watchOuts: [
      "Do not combine multiple high-dose vitamin D products without checking totals.",
      "Excessive long-term intake can increase risk of high blood calcium.",
      "Discuss dosing with a clinician if you have kidney or parathyroid conditions.",
    ],
  },
  {
    key: "omega-3",
    resourceName: "Omega3FattyAcids",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Omega3FattyAcids-Consumer/",
    overview:
      "Omega-3 fatty acids include ALA, EPA, and DHA, and are commonly used for heart and triglyceride support.",
    whatItDoes: [
      "EPA and DHA can help lower triglyceride levels.",
      "Omega-3s are important components of cell membranes, including in the brain and eyes.",
      "Seafood intake is associated with cardiovascular health benefits.",
    ],
    watchOuts: [
      "High-dose omega-3 supplements can increase bleeding risk, especially with anticoagulants.",
      "Mild effects can include fishy aftertaste or stomach discomfort.",
      "Check EPA+DHA total if combining multiple omega-3 products.",
    ],
  },
  {
    key: "magnesium",
    resourceName: "Magnesium",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Magnesium-Consumer/",
    overview:
      "Magnesium is an essential mineral involved in energy production, muscle and nerve function, and many enzyme reactions.",
    whatItDoes: [
      "Supports normal muscle and nerve function.",
      "Contributes to bone health and energy metabolism.",
      "Helps maintain normal heart rhythm and blood pressure regulation.",
    ],
    watchOuts: [
      "Higher supplemental doses can cause loose stools or abdominal discomfort.",
      "Certain forms may be better tolerated than others.",
      "Separate timing from some medications if advised by your clinician or pharmacist.",
    ],
  },
  {
    key: "zinc",
    resourceName: "Zinc",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Zinc-Consumer/",
    overview:
      "Zinc is a trace mineral needed for immune function, wound healing, and DNA/protein synthesis.",
    whatItDoes: [
      "Supports immune cell function and normal inflammatory response.",
      "Helps with wound healing and tissue repair.",
      "Required for many enzyme systems involved in growth and metabolism.",
    ],
    watchOuts: [
      "Higher chronic intakes can interfere with copper status.",
      "Can cause nausea if taken on an empty stomach.",
      "Avoid stacking multiple zinc products without checking total daily amount.",
    ],
  },
  {
    key: "iron",
    resourceName: "Iron",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Iron-Consumer/",
    overview:
      "Iron is essential for hemoglobin formation and oxygen transport, and is often supplemented when intake is insufficient.",
    whatItDoes: [
      "Supports normal red blood cell production and oxygen transport.",
      "Helps reduce risk of iron deficiency when intake is inadequate.",
      "Important for energy metabolism and cognitive function.",
    ],
    watchOuts: [
      "Iron can cause constipation, nausea, or stomach discomfort.",
      "Keep iron supplements out of reach of children due to overdose risk.",
      "Calcium, coffee, and tea can reduce iron absorption when taken together.",
    ],
  },
  {
    key: "vitamin b12",
    resourceName: "VitaminB12",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/VitaminB12-Consumer/",
    overview:
      "Vitamin B12 supports red blood cell formation, neurological function, and DNA synthesis.",
    whatItDoes: [
      "Helps maintain normal nerve and brain function.",
      "Supports healthy red blood cell production.",
      "Required for DNA synthesis and energy metabolism.",
    ],
    watchOuts: [
      "Absorption can decrease with age and some GI conditions.",
      "Vegetarian or vegan diets may require intake planning.",
      "Check stacked multivitamin/B-complex products for duplicate B12 doses.",
    ],
  },
  {
    key: "calcium",
    resourceName: "Calcium",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Calcium-Consumer/",
    overview:
      "Calcium is essential for bone structure, muscle contraction, and nerve signaling.",
    whatItDoes: [
      "Supports bone and teeth health.",
      "Helps normal muscle contraction and nerve transmission.",
      "Works with vitamin D for calcium balance.",
    ],
    watchOuts: [
      "Large doses may cause constipation in some people.",
      "Separate timing from iron, zinc, and certain medications when advised.",
      "Avoid unnecessary overlap from multiple calcium-containing products.",
    ],
  },
  {
    key: "folate",
    resourceName: "Folate",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Folate-Consumer/",
    overview:
      "Folate (vitamin B9) is important for cell division and DNA synthesis.",
    whatItDoes: [
      "Supports normal red blood cell formation.",
      "Helps DNA synthesis and cell growth.",
      "Adequate folate intake is important in pregnancy planning.",
    ],
    watchOuts: [
      "High folic acid intake can mask vitamin B12 deficiency.",
      "Use clinician guidance for pregnancy-specific dosing.",
      "Check overlap across prenatal and multivitamin products.",
    ],
  },
  {
    key: "potassium",
    resourceName: "Potassium",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Potassium-Consumer/",
    overview:
      "Potassium is an electrolyte involved in fluid balance, muscle contraction, and nerve signaling.",
    whatItDoes: [
      "Helps maintain normal fluid and electrolyte balance.",
      "Supports normal muscle and nerve function.",
      "Adequate intake supports healthy blood pressure patterns.",
    ],
    watchOuts: [
      "Supplemental potassium may be unsafe with some kidney conditions.",
      "Use caution with medicines that affect potassium levels.",
      "Avoid combining multiple potassium supplements without clinician advice.",
    ],
  },
  {
    key: "selenium",
    resourceName: "Selenium",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Selenium-Consumer/",
    overview:
      "Selenium is a trace mineral involved in antioxidant defense and thyroid hormone metabolism.",
    whatItDoes: [
      "Supports antioxidant enzyme systems.",
      "Contributes to normal thyroid hormone metabolism.",
      "Helps support immune function.",
    ],
    watchOuts: [
      "Chronic high intake can lead to selenium toxicity symptoms.",
      "Avoid stacking multiple selenium-containing products.",
      "Use caution if your baseline intake is already high from diet/supplements.",
    ],
  },
  {
    key: "iodine",
    resourceName: "Iodine",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Iodine-Consumer/",
    overview:
      "Iodine is required for thyroid hormone production and normal growth and metabolism.",
    whatItDoes: [
      "Supports thyroid hormone synthesis.",
      "Contributes to normal metabolic regulation.",
      "Important during pregnancy and early development.",
    ],
    watchOuts: [
      "Too little or too much iodine can affect thyroid function.",
      "Discuss supplementation if you have thyroid disease.",
      "Check overlap across prenatal and thyroid support products.",
    ],
  },
  {
    key: "vitamin a",
    resourceName: "VitaminA",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/VitaminA-Consumer/",
    overview:
      "Vitamin A supports vision, immune function, and normal cell growth.",
    whatItDoes: [
      "Supports normal vision and eye health.",
      "Contributes to immune function and epithelial integrity.",
      "Supports cell growth and development.",
    ],
    watchOuts: [
      "High preformed vitamin A intake can be harmful, especially in pregnancy.",
      "Check overlap with liver oil and multivitamin products.",
      "Use caution with chronic high-dose supplementation.",
    ],
  },
  {
    key: "vitamin e",
    resourceName: "VitaminE",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/VitaminE-Consumer/",
    overview:
      "Vitamin E is a fat-soluble antioxidant that helps protect cell membranes.",
    whatItDoes: [
      "Provides antioxidant support for cell membranes.",
      "Contributes to normal immune function.",
      "Helps protect polyunsaturated fats in tissues.",
    ],
    watchOuts: [
      "High supplemental doses may increase bleeding risk in some contexts.",
      "Use caution with anticoagulant/antiplatelet medications.",
      "Avoid unnecessary overlap from multiple vitamin E products.",
    ],
  },
  {
    key: "vitamin k",
    resourceName: "VitaminK",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/VitaminK-Consumer/",
    overview:
      "Vitamin K is involved in normal blood clotting and bone metabolism.",
    whatItDoes: [
      "Supports normal blood clotting pathways.",
      "Contributes to bone protein activation.",
      "Works with other nutrients in bone health pathways.",
    ],
    watchOuts: [
      "Intake consistency matters if using warfarin or similar anticoagulants.",
      "Discuss supplementation with your clinician if on blood thinners.",
      "Check overlap across multivitamin and bone formulas.",
    ],
  },
  {
    key: "niacin",
    resourceName: "Niacin",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Niacin-Consumer/",
    overview:
      "Niacin (vitamin B3) supports energy metabolism and normal nervous system function.",
    whatItDoes: [
      "Helps convert food into usable energy.",
      "Supports normal skin and nervous system function.",
      "Contributes to broader B-complex metabolic pathways.",
    ],
    watchOuts: [
      "Higher doses can cause flushing and warmth sensations.",
      "Very high intake may affect liver enzymes in some people.",
      "Avoid stacking multiple B-complex/high-niacin products.",
    ],
  },
  {
    key: "thiamin",
    resourceName: "Thiamin",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Thiamin-Consumer/",
    overview:
      "Thiamin (vitamin B1) is required for carbohydrate metabolism and nerve function.",
    whatItDoes: [
      "Supports carbohydrate and energy metabolism.",
      "Contributes to normal nerve function.",
      "Helps maintain normal cellular energy pathways.",
    ],
    watchOuts: [
      "Deficiency risk is higher in some malabsorption and alcohol-use contexts.",
      "Supplement overlap is common in B-complex products.",
      "Use label totals when combining fortified products.",
    ],
  },
  {
    key: "riboflavin",
    resourceName: "Riboflavin",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Riboflavin-Consumer/",
    overview:
      "Riboflavin (vitamin B2) supports energy production and antioxidant enzyme function.",
    whatItDoes: [
      "Supports energy metabolism and cellular function.",
      "Contributes to antioxidant enzyme activity.",
      "Helps maintain normal growth and development.",
    ],
    watchOuts: [
      "High intakes commonly cause bright yellow urine and are usually benign.",
      "Overlap is common in multivitamins and B-complex formulas.",
      "Use total daily intake checks when stacking products.",
    ],
  },
  {
    key: "biotin",
    resourceName: "Biotin",
    fallbackUrl: "https://ods.od.nih.gov/factsheets/Biotin-Consumer/",
    overview:
      "Biotin (vitamin B7) supports nutrient metabolism and normal skin, hair, and nail physiology.",
    whatItDoes: [
      "Supports metabolism of fats, carbohydrates, and proteins.",
      "Contributes to normal skin and hair physiology.",
      "Functions as a cofactor in multiple metabolic enzymes.",
    ],
    watchOuts: [
      "High-dose biotin can interfere with certain lab test results.",
      "Inform clinicians/labs before blood testing if taking biotin.",
      "Check overlap across beauty-focused multinutrient products.",
    ],
  },
];

const NAC_FALLBACK = {
  key: "nac",
  overview:
    "N-acetylcysteine (NAC) is a precursor to glutathione and is commonly used as a general antioxidant-support ingredient.",
  whatItDoes: [
    "Provides cysteine for glutathione synthesis.",
    "Is commonly used for antioxidant support goals.",
    "May be used as part of broader respiratory or liver-support regimens under clinician guidance.",
  ],
  watchOuts: [
    "Can cause stomach upset in some people.",
    "Check total supplement stack to avoid unnecessary overlap with similar antioxidant products.",
    "Consult a clinician if using prescription medications or managing chronic conditions.",
  ],
  sourceUrl: null,
};

const getTag = (xml, tagName) => {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? match[1].trim() : null;
};

const htmlDecode = (value) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripHtml = (value) =>
  htmlDecode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitSentences = (content) => {
  const text = stripHtml(content);
  if (!text) return [];
  const parts = text.match(/[^.!?]+[.!?]/g) ?? [text];
  return parts.map((part) => part.trim()).filter(Boolean);
};

const RISK_KEYWORDS = [
  "risk",
  "toxic",
  "toxicity",
  "caution",
  "avoid",
  "adverse",
  "bleeding",
  "overdose",
  "upper limit",
  "interfere",
  "interactions",
  "medication",
  "consult",
  "kidney",
  "liver",
  "pregnan",
  "side effect",
  "stomach upset",
];

const BENEFIT_KEYWORDS = [
  "supports",
  "help",
  "helps",
  "important",
  "required",
  "contributes",
  "associated",
  "maintain",
  "normal",
  "function",
  "health",
];

const isRiskSentence = (sentence) => {
  const lower = sentence.toLowerCase();
  return RISK_KEYWORDS.some((word) => lower.includes(word));
};

const isBenefitSentence = (sentence) => {
  const lower = sentence.toLowerCase();
  return BENEFIT_KEYWORDS.some((word) => lower.includes(word)) && !isRiskSentence(sentence);
};

const extractOdsBullets = (content, recipe) => {
  const sentences = splitSentences(content);
  const benefitCandidates = sentences.filter(isBenefitSentence);
  const riskCandidates = sentences.filter(isRiskSentence);

  const whatItDoes = sanitizeOdsBullets(benefitCandidates, 3);
  const watchOuts = sanitizeOdsBullets(riskCandidates, 3);

  return {
    whatItDoes: whatItDoes.length > 0 ? whatItDoes : sanitizeOdsBullets(recipe.whatItDoes, 3),
    watchOuts: watchOuts.length > 0 ? watchOuts : sanitizeOdsBullets(recipe.watchOuts, 3),
  };
};

const fetchFactSheet = async (resourceName) => {
  const url = `${ODS_API}?resourcename=${encodeURIComponent(resourceName)}&readinglevel=Consumer&outputformat=XML`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ODS API failed for ${resourceName}: ${res.status}`);
  }
  const xml = await res.text();
  return {
    reviewed: getTag(xml, "Reviewed"),
    sourceUrl: getTag(xml, "URL"),
    content: getTag(xml, "Content"),
  };
};

const main = async () => {
  const entries = {};
  const reviewedDates = [];

  for (const recipe of CORE_RECIPES) {
    try {
      const fetched = await fetchFactSheet(recipe.resourceName);
      if (fetched.reviewed) reviewedDates.push(fetched.reviewed);
      const sanitizedOverview = sanitizeOdsOverview(fetched.content ?? "", recipe.overview);
      const sanitizedBullets = extractOdsBullets(fetched.content ?? "", recipe);
      entries[recipe.key] = {
        overview: sanitizedOverview.text,
        curatedOverview: recipe.overview,
        overviewSource: sanitizedOverview.source,
        whatItDoes: sanitizedBullets.whatItDoes,
        watchOuts: sanitizedBullets.watchOuts,
        sourceUrl: fetched.sourceUrl || recipe.fallbackUrl,
      };
      console.log(`[ods-sync] synced ${recipe.key}`);
    } catch (error) {
      const fallbackOverview = sanitizeOdsOverview("", recipe.overview);
      entries[recipe.key] = {
        overview: fallbackOverview.text,
        curatedOverview: recipe.overview,
        overviewSource: "curated",
        whatItDoes: sanitizeOdsBullets(recipe.whatItDoes, 3),
        watchOuts: sanitizeOdsBullets(recipe.watchOuts, 3),
        sourceUrl: recipe.fallbackUrl,
      };
      console.warn(
        `[ods-sync] fallback for ${recipe.key}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  entries[NAC_FALLBACK.key] = {
    overview: NAC_FALLBACK.overview,
    curatedOverview: NAC_FALLBACK.overview,
    overviewSource: "curated",
    whatItDoes: sanitizeOdsBullets(NAC_FALLBACK.whatItDoes, 3),
    watchOuts: sanitizeOdsBullets(NAC_FALLBACK.watchOuts, 3),
    sourceUrl: NAC_FALLBACK.sourceUrl,
  };

  const reviewedAt = reviewedDates.sort().at(-1);
  const payload = {
    packVersion: `ods-core-${new Date().toISOString().slice(0, 10)}`,
    updatedAt: reviewedAt ? new Date(`${reviewedAt}T00:00:00.000Z`).toISOString() : new Date().toISOString(),
    entries,
  };

  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[ods-sync] wrote ${OUT_FILE}`);
};

main().catch((error) => {
  console.error("[ods-sync] fatal", error);
  process.exit(1);
});
