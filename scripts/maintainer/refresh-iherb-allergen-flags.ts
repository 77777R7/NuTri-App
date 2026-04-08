#!/usr/bin/env -S node --import tsx

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { extractFromIherbOverlay } from "../../backend/src/allergy/extractFromIherbOverlay.ts";
import {
  buildProductAllergenFlagsRow,
  upsertProductAllergenFlagsRows,
} from "../../backend/src/allergy/productAllergenFlagsRepository.ts";

type OverlayRow = {
  id: number;
  product_id: string;
  barcode_gtin14: string | null;
  supplement_facts: Record<string, unknown> | null;
  description_sections: Record<string, unknown> | null;
};

const PROJECT_REF = "dlwlobgmjzcmpirwvetq";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

const getArg = (flag: string): string | null => {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const batchSize = Math.max(100, Number(getArg("batch") ?? "500"));
const limit = Math.max(0, Number(getArg("limit") ?? "0"));
const outputDir = getArg("out-dir")
  ? path.resolve(getArg("out-dir") as string)
  : path.join(
      process.cwd(),
      "output",
      "maintainer-gates",
      `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_allergen_refresh`,
    );

const getServiceRoleKey = (): string => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  const raw = execFileSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
    { encoding: "utf8" },
  );
  const apiKeys = JSON.parse(raw) as { id?: string; name?: string; api_key?: string }[];
  const serviceRoleKey =
    apiKeys.find((entry) => entry.id === "service_role" || entry.name === "service_role")?.api_key ?? "";
  if (!serviceRoleKey) {
    throw new Error("Unable to resolve Supabase service role key from Supabase CLI login.");
  }
  return serviceRoleKey;
};

const supabase = createClient(SUPABASE_URL, getServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fetchOverlayBatch = async (afterId: number): Promise<OverlayRow[]> => {
  let query = supabase
    .from("iherb_overlay_products")
    .select("id,product_id,barcode_gtin14,supplement_facts,description_sections")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (afterId > 0) {
    query = query.gt("id", afterId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read iherb_overlay_products: ${error.message}`);
  return (data ?? []) as OverlayRow[];
};

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });

  let scanned = 0;
  let upserted = 0;
  let afterId = 0;
  const startedAt = new Date().toISOString();

  while (true) {
    const rows = await fetchOverlayBatch(afterId);
    if (rows.length === 0) break;

    const computedAt = new Date().toISOString();
    const payload = rows.map((row) => {
      const result = extractFromIherbOverlay({
        productId: row.product_id,
        canonicalSourceId: row.barcode_gtin14,
        supplementFacts: row.supplement_facts,
        descriptionSections: row.description_sections,
      });

      return buildProductAllergenFlagsRow({
        source: "iherb_overlay",
        sourceId: String(row.product_id),
        canonicalSourceId: row.barcode_gtin14 ?? null,
        allergyFlags: result.allergyFlags,
        ingredientRestrictions: result.ingredientRestrictions,
        coverageStatus: result.coverageStatus,
        details: result.details,
        computedAt,
      });
    });

    const upsert = await upsertProductAllergenFlagsRows(payload, supabase);
    if (!upsert.ok) {
      throw new Error(`Failed to upsert product_allergen_flags: ${upsert.error.message}`);
    }

    scanned += rows.length;
    upserted += upsert.count;
    afterId = rows[rows.length - 1]?.id ?? afterId;

    console.log(
      `[iherb-allergen-refresh] scanned=${scanned} upserted=${upserted} lastId=${afterId}`,
    );

    if ((limit > 0 && scanned >= limit) || rows.length < batchSize) {
      break;
    }
  }

  const report = {
    status: "ok",
    projectRef: PROJECT_REF,
    startedAt,
    finishedAt: new Date().toISOString(),
    scanned,
    upserted,
    lastProcessedId: afterId,
  };

  const reportPath = path.join(outputDir, "iherb_allergen_refresh_report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
