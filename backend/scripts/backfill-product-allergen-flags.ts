import { supabase } from "../src/supabase.js";
import {
  buildProductAllergenFlagsRow,
  upsertProductAllergenFlagsRows,
  type ProductAllergenFlagsSource,
} from "../src/allergy/productAllergenFlagsRepository.js";
import { extractFromDsld } from "../src/allergy/extractFromDsld.js";
import { extractFromLnhpd } from "../src/allergy/extractFromLnhpd.js";
import { extractFromIherbOverlay } from "../src/allergy/extractFromIherbOverlay.js";

const args = process.argv.slice(2);

const hasFlag = (flag: string) => args.includes(`--${flag}`);

const getArg = (flag: string): string | null => {
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const sourceArg = (getArg("source") ?? "all").trim().toLowerCase();
const batchSize = Math.max(
  1,
  Number(getArg("batch") ?? process.env.BACKFILL_BATCH_SIZE ?? "500"),
);
const limit = Math.max(0, Number(getArg("limit") ?? "0"));
const dryRun = hasFlag("dry-run");

const SUPPORTED_SOURCES = ["all", "dsld", "lnhpd", "iherb_overlay"] as const;

if (!SUPPORTED_SOURCES.includes(sourceArg as (typeof SUPPORTED_SOURCES)[number])) {
  throw new Error(
    `Unsupported --source value "${sourceArg}". Expected one of: ${SUPPORTED_SOURCES.join(", ")}`,
  );
}

const activeSources: ProductAllergenFlagsSource[] =
  sourceArg === "all"
    ? ["dsld", "lnhpd", "iherb_overlay"]
    : [sourceArg as Exclude<(typeof SUPPORTED_SOURCES)[number], "all">];

const backfillDsld = async () => {
  let lastSeenId = Number(getArg("start-dsld-id") ?? "0");
  let processed = 0;

  while (true) {
    let query = supabase
      .from("dsld_labels_meta")
      .select(
        "dsld_label_id,active_ingredients_summary,inactive_ingredients",
      )
      .order("dsld_label_id", { ascending: true })
      .limit(batchSize);

    if (lastSeenId > 0) {
      query = query.gt("dsld_label_id", lastSeenId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`dsld read failed: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const computedAt = new Date().toISOString();
    const payload = rows.map((row) => {
      const result = extractFromDsld({
        dsldLabelId: row.dsld_label_id,
        activeIngredientsSummary: row.active_ingredients_summary,
        inactiveIngredients: row.inactive_ingredients,
      });

      return buildProductAllergenFlagsRow({
        source: "dsld",
        sourceId: String(row.dsld_label_id),
        allergyFlags: result.allergyFlags,
        ingredientRestrictions: result.ingredientRestrictions,
        coverageStatus: result.coverageStatus,
        details: result.details,
        computedAt,
      });
    });

    if (!dryRun) {
      const upsert = await upsertProductAllergenFlagsRows(payload);
      if (!upsert.ok) {
        throw new Error(`dsld upsert failed: ${upsert.error.message}`);
      }
    }

    processed += payload.length;
    lastSeenId = Number(rows[rows.length - 1]?.dsld_label_id ?? lastSeenId);
    console.log(
      `[allergy-backfill][dsld] batch=${rows.length} total=${processed} lastSeenId=${lastSeenId}`,
    );

    if (limit > 0 && processed >= limit) break;
  }
};

const backfillLnhpd = async () => {
  let lastSeenId = Number(getArg("start-lnhpd-id") ?? "0");
  let processed = 0;

  while (true) {
    let query = supabase
      .from("lnhpd_facts")
      .select("lnhpd_id,npn,facts_json,is_on_market")
      .eq("is_on_market", true)
      .order("lnhpd_id", { ascending: true })
      .limit(batchSize);

    if (lastSeenId > 0) {
      query = query.gt("lnhpd_id", lastSeenId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`lnhpd read failed: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const computedAt = new Date().toISOString();
    const payload = rows.map((row) => {
      const result = extractFromLnhpd({
        lnhpdId: row.lnhpd_id,
        factsJson: row.facts_json,
      });

      return buildProductAllergenFlagsRow({
        source: "lnhpd",
        sourceId: String(row.lnhpd_id),
        canonicalSourceId: row.npn ?? null,
        allergyFlags: result.allergyFlags,
        ingredientRestrictions: result.ingredientRestrictions,
        coverageStatus: result.coverageStatus,
        details: result.details,
        computedAt,
      });
    });

    if (!dryRun) {
      const upsert = await upsertProductAllergenFlagsRows(payload);
      if (!upsert.ok) {
        throw new Error(`lnhpd upsert failed: ${upsert.error.message}`);
      }
    }

    processed += payload.length;
    lastSeenId = Number(rows[rows.length - 1]?.lnhpd_id ?? lastSeenId);
    console.log(
      `[allergy-backfill][lnhpd] batch=${rows.length} total=${processed} lastSeenId=${lastSeenId}`,
    );

    if (limit > 0 && processed >= limit) break;
  }
};

const backfillIherbOverlay = async () => {
  let lastSeenId = Number(getArg("start-iherb-id") ?? "0");
  let processed = 0;

  while (true) {
    let query = supabase
      .from("iherb_overlay_products")
      .select("id,product_id,barcode_gtin14,supplement_facts,description_sections")
      .order("id", { ascending: true })
      .limit(batchSize);

    if (lastSeenId > 0) {
      query = query.gt("id", lastSeenId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`iherb_overlay read failed: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const computedAt = new Date().toISOString();
    const payload = rows.map((row) => {
      const result = extractFromIherbOverlay({
        productId: row.product_id,
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

    if (!dryRun) {
      const upsert = await upsertProductAllergenFlagsRows(payload);
      if (!upsert.ok) {
        throw new Error(`iherb_overlay upsert failed: ${upsert.error.message}`);
      }
    }

    processed += payload.length;
    lastSeenId = Number(rows[rows.length - 1]?.id ?? lastSeenId);
    console.log(
      `[allergy-backfill][iherb_overlay] batch=${rows.length} total=${processed} lastSeenId=${lastSeenId}`,
    );

    if (limit > 0 && processed >= limit) break;
  }
};

const main = async () => {
  for (const source of activeSources) {
    if (source === "dsld") {
      await backfillDsld();
      continue;
    }
    if (source === "lnhpd") {
      await backfillLnhpd();
      continue;
    }
    if (source === "iherb_overlay") {
      await backfillIherbOverlay();
      continue;
    }
  }
};

main()
  .then(() => {
    console.log("[allergy-backfill] complete");
  })
  .catch((error) => {
    console.error("[allergy-backfill] failed", error);
    process.exitCode = 1;
  });
