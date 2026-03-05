#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const ZIP_PATH = getArg(
  "zip",
  "/Users/howard07/.codex/worktrees/f971/nutri-app/data/iherb_products_09e814d1b48847f7be1e38b52eb5e0b3_20260303_115845.zip",
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "demo5_iherb"));
const OUT_JSON = path.join(OUT_DIR, "extracted_demo5_overlay.json");
const OUT_MD = path.join(OUT_DIR, "extracted_demo5_overlay.md");

const DEMO_PRODUCT_IDS = [90284, 100269, 72248, 92368, 104058];
const PREFERRED_ENTRIES = ["sports-research.json", "life-extension.json", "codeage.json"];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length > 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const parseAllDescription = (raw) => {
  const text = String(raw ?? "").replace(/\r/g, "").replace(/\u00a0/g, " ");
  if (!text.trim()) {
    return {
      Description: "",
      "Suggested use": "",
      "Other ingredients": "",
      Warnings: "",
      Disclaimer: "",
    };
  }

  const headings = ["Description", "Suggested use", "Other ingredients", "Warnings", "Disclaimer"];
  const re = /(?:^|\n)\s*(Description|Suggested use|Other ingredients|Warnings|Disclaimer)\s*(?=\n|$)/gi;
  const matches = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    matches.push({ heading: match[1], index: match.index, end: re.lastIndex });
  }

  const out = {
    Description: "",
    "Suggested use": "",
    "Other ingredients": "",
    Warnings: "",
    Disclaimer: "",
  };

  if (matches.length === 0) {
    out.Description = normalizeText(text);
    return out;
  }

  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const next = matches[i + 1];
    const start = cur.end;
    const end = next ? next.index : text.length;
    const body = normalizeText(text.slice(start, end));
    if (headings.includes(cur.heading)) {
      out[cur.heading] = body;
    }
  }

  return out;
};

const pickNutritionFacts = (facts) => {
  if (!Array.isArray(facts)) return [];
  return facts
    .map((row) => ({
      substancy: normalizeText(row?.substancy),
      amountPerServing: normalizeText(row?.amountPerServing),
      dailyValuePercent: normalizeText(row?.dailyValuePercent),
    }))
    .filter((row) => row.substancy || row.amountPerServing || row.dailyValuePercent);
};

const zipListEntries = (zipPath) => {
  const output = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.endsWith(".json"));
};

const readZipJsonEntry = (zipPath, entry) => {
  const output = execFileSync("unzip", ["-p", zipPath, entry], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  return JSON.parse(output);
};

const sha256File = async (filePath) => {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
};

const collectProductsFromEntry = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.items)) return payload.items;
  }
  return [];
};

const extractRecord = (row) => {
  const parsedSections = parseAllDescription(row?.allDescription);
  return {
    brandName: normalizeText(row?.brandName),
    title: normalizeText(row?.title),
    productId: row?.productId ?? null,
    upcCode: normalizeText(row?.upcCode) || null,
    barcode_gtin14: toGtin14(row?.upcCode),
    link: normalizeText(row?.link) || null,
    productImages: Array.isArray(row?.productImages) ? row.productImages.filter(Boolean) : [],
    productCatalogImage: normalizeText(row?.productCatalogImage) || null,
    categories: Array.isArray(row?.categories)
      ? row.categories.map((item) => normalizeText(item)).filter(Boolean)
      : [],
    serving: {
      servingType: normalizeText(row?.serving?.servingType) || null,
      servingDescription: normalizeText(row?.serving?.servingDescription) || null,
    },
    supplementFacts: {
      servingSize: normalizeText(row?.supplementFacts?.servingSize) || null,
      servingsPerContainer: normalizeText(row?.supplementFacts?.servingsPerContainer) || null,
      nutritionalFacts: pickNutritionFacts(row?.supplementFacts?.nutritionalFacts),
    },
    allDescriptionSections: {
      Description: parsedSections.Description || null,
      "Suggested use": parsedSections["Suggested use"] || null,
      "Other ingredients": parsedSections["Other ingredients"] || null,
      Warnings: parsedSections.Warnings || null,
      Disclaimer:
        parsedSections.Disclaimer || normalizeText(row?.supplementFacts?.disclaimer) || null,
    },
  };
};

const toMd = (payload) => {
  const lines = [];
  lines.push("# Demo5 iHerb Overlay Extraction");
  lines.push("");
  lines.push(`- generated_at: ${payload.generatedAt}`);
  lines.push(`- zip_path: ${payload.input.zipPath}`);
  lines.push(`- zip_sha256: ${payload.input.zipSha256}`);
  lines.push(`- matched_products: ${payload.products.length}/${payload.requiredProductIds.length}`);
  lines.push("");
  lines.push("## Products");
  lines.push("");
  for (const product of payload.products) {
    lines.push(`### ${product.brandName} — ${product.title}`);
    lines.push(`- productId: ${product.productId}`);
    lines.push(`- upcCode: ${product.upcCode ?? ""}`);
    lines.push(`- barcode_gtin14: ${product.barcode_gtin14 ?? ""}`);
    lines.push(`- link: ${product.link ?? ""}`);
    lines.push(`- categories: ${(product.categories ?? []).join(" | ")}`);
    lines.push(`- servingType: ${product.serving?.servingType ?? ""}`);
    lines.push(`- servingDescription: ${product.serving?.servingDescription ?? ""}`);
    lines.push(`- supplementFacts.servingSize: ${product.supplementFacts?.servingSize ?? ""}`);
    lines.push(`- supplementFacts.servingsPerContainer: ${product.supplementFacts?.servingsPerContainer ?? ""}`);
    lines.push(`- supplementFacts.nutritionalFacts.count: ${(product.supplementFacts?.nutritionalFacts ?? []).length}`);
    lines.push("- allDescription sections:");
    lines.push(`  - Description: ${normalizeText(product.allDescriptionSections?.Description).slice(0, 220)}`);
    lines.push(`  - Suggested use: ${normalizeText(product.allDescriptionSections?.["Suggested use"]).slice(0, 220)}`);
    lines.push(`  - Other ingredients: ${normalizeText(product.allDescriptionSections?.["Other ingredients"]).slice(0, 220)}`);
    lines.push(`  - Warnings: ${normalizeText(product.allDescriptionSections?.Warnings).slice(0, 220)}`);
    lines.push(`  - Disclaimer: ${normalizeText(product.allDescriptionSections?.Disclaimer).slice(0, 220)}`);
    lines.push("");
  }
  if (payload.missingProductIds.length > 0) {
    lines.push("## Missing Product IDs");
    lines.push("");
    for (const id of payload.missingProductIds) {
      lines.push(`- ${id}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const zipSha256 = await sha256File(ZIP_PATH);

  const allEntries = zipListEntries(ZIP_PATH);
  const preferred = allEntries.filter((entry) => PREFERRED_ENTRIES.includes(entry));
  const candidateEntries = preferred.length > 0 ? preferred : allEntries;

  const byProductId = new Map();
  for (const entry of candidateEntries) {
    const parsed = readZipJsonEntry(ZIP_PATH, entry);
    const products = collectProductsFromEntry(parsed);
    for (const row of products) {
      const productId = Number(row?.productId);
      if (!Number.isFinite(productId)) continue;
      if (!DEMO_PRODUCT_IDS.includes(productId)) continue;
      if (!byProductId.has(productId)) {
        byProductId.set(productId, {
          ...extractRecord(row),
          _sourceEntry: entry,
        });
      }
    }
    if (DEMO_PRODUCT_IDS.every((id) => byProductId.has(id))) break;
  }

  const extracted = DEMO_PRODUCT_IDS
    .filter((id) => byProductId.has(id))
    .map((id) => byProductId.get(id));
  const missing = DEMO_PRODUCT_IDS.filter((id) => !byProductId.has(id));

  const payload = {
    schemaVersion: "demo5_iherb_overlay.v1",
    generatedAt: new Date().toISOString(),
    input: {
      zipPath: ZIP_PATH,
      zipSha256,
      scannedEntries: candidateEntries.length,
      preferredEntriesUsed: preferred.length > 0,
    },
    requiredProductIds: DEMO_PRODUCT_IDS,
    products: extracted,
    missingProductIds: missing,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMd(payload), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: missing.length === 0,
        output: {
          json: OUT_JSON,
          md: OUT_MD,
        },
        matched: extracted.length,
        missing,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
