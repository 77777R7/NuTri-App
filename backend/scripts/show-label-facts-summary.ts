import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

const cwdEnvPath = path.resolve(process.cwd(), ".env");
const backendEnvPath = path.resolve(process.cwd(), "backend", ".env");
const envPath = fs.existsSync(backendEnvPath) ? backendEnvPath : cwdEnvPath;
dotenv.config({ path: envPath });

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "[label-facts-summary] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

type DsldFactsRow = {
  dsld_label_id: number | string | null;
  brand_name: string | null;
  product_name: string | null;
  facts_json: unknown;
};

type LnhpdFactsRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
  brand_name: string | null;
  product_name: string | null;
  facts_json: unknown;
};

type SummaryRow = {
  source: "dsld" | "lnhpd";
  sourceId: string;
  npn?: string | null;
  brandName: string | null;
  productName: string | null;
  dosage: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatAmountUnit = (amount: number | null, unit: string | null): string | null => {
  if (amount == null && !unit) return null;
  if (amount == null) return unit;
  if (!unit) return String(amount);
  return `${amount} ${unit}`;
};

const extractDsldDosage = (facts: Record<string, unknown>): string | null => {
  const actives = Array.isArray(facts.actives) ? facts.actives : [];
  for (const item of actives) {
    if (!item || typeof item !== "object") continue;
    const amount = toNumber((item as { amount?: unknown }).amount);
    const unit = toTrimmedString((item as { unit?: unknown }).unit);
    const dosage = formatAmountUnit(amount, unit);
    if (dosage) return dosage;
  }
  return toTrimmedString(facts.servingSize);
};

const extractLnhpdDosage = (facts: Record<string, unknown>): string | null => {
  const dosesRaw = facts.doses;
  if (Array.isArray(dosesRaw)) {
    for (const item of dosesRaw) {
      const dose = toTrimmedString(item);
      if (dose) return dose;
    }
  } else {
    const dose = toTrimmedString(dosesRaw);
    if (dose) return dose;
  }
  return toTrimmedString(facts.servingSize);
};

const buildDsldSummary = (row: DsldFactsRow): SummaryRow | null => {
  const sourceId = toTrimmedString(row.dsld_label_id ?? null);
  if (!sourceId) return null;
  const facts = row.facts_json && typeof row.facts_json === "object" ? (row.facts_json as Record<string, unknown>) : null;
  const brandFromFacts = facts ? toTrimmedString(facts.brandName) : null;
  const productFromFacts = facts ? toTrimmedString(facts.productName) : null;
  return {
    source: "dsld",
    sourceId,
    brandName: brandFromFacts ?? row.brand_name ?? null,
    productName: productFromFacts ?? row.product_name ?? null,
    dosage: facts ? extractDsldDosage(facts) : null,
  };
};

const buildLnhpdSummary = (row: LnhpdFactsRow): SummaryRow | null => {
  const sourceId = toTrimmedString(row.lnhpd_id ?? null);
  if (!sourceId) return null;
  const facts = row.facts_json && typeof row.facts_json === "object" ? (row.facts_json as Record<string, unknown>) : null;
  const brandFromFacts = facts ? toTrimmedString(facts.brandName) : null;
  const productFromFacts = facts ? toTrimmedString(facts.productName) : null;
  return {
    source: "lnhpd",
    sourceId,
    npn: row.npn ?? (facts ? toTrimmedString(facts.npn) : null),
    brandName: brandFromFacts ?? row.brand_name ?? null,
    productName: productFromFacts ?? row.product_name ?? null,
    dosage: facts ? extractLnhpdDosage(facts) : null,
  };
};

const resolveLnhpdFactsTable = async (): Promise<"lnhpd_facts_complete" | "lnhpd_facts"> => {
  const { data, error } = await supabase
    .from("lnhpd_facts_complete")
    .select("lnhpd_id")
    .limit(1);
  if (!error && (data?.length ?? 0) > 0) return "lnhpd_facts_complete";
  return "lnhpd_facts";
};

const main = async () => {
  const limit = Math.max(1, Number(getArg("limit") ?? "5"));
  const dsldId = getArg("dsld-id");
  const lnhpdId = getArg("lnhpd-id");
  const npn = getArg("npn");

  const dsldQuery = supabase
    .from("dsld_label_facts")
    .select("dsld_label_id,brand_name,product_name,facts_json");

  const dsldResponse = dsldId ? await dsldQuery.eq("dsld_label_id", dsldId).limit(1) : await dsldQuery.limit(limit);
  if (dsldResponse.error) {
    throw new Error(`dsld_label_facts read failed: ${dsldResponse.error.message}`);
  }
  const dsldRows = (dsldResponse.data ?? []) as DsldFactsRow[];
  const dsldSummary = dsldRows.map(buildDsldSummary).filter((item): item is SummaryRow => Boolean(item));

  const lnhpdTable = await resolveLnhpdFactsTable();
  let lnhpdQuery = supabase
    .from(lnhpdTable)
    .select("lnhpd_id,npn,brand_name,product_name,facts_json");

  if (lnhpdId) {
    lnhpdQuery = lnhpdQuery.eq("lnhpd_id", lnhpdId);
  } else if (npn) {
    lnhpdQuery = lnhpdQuery.eq("npn", npn);
  }

  const lnhpdResponse = lnhpdId || npn ? await lnhpdQuery.limit(1) : await lnhpdQuery.limit(limit);
  if (lnhpdResponse.error) {
    throw new Error(`${lnhpdTable} read failed: ${lnhpdResponse.error.message}`);
  }
  const lnhpdRows = (lnhpdResponse.data ?? []) as LnhpdFactsRow[];
  const lnhpdSummary = lnhpdRows.map(buildLnhpdSummary).filter((item): item is SummaryRow => Boolean(item));

  console.log(
    JSON.stringify(
      {
        dsld: dsldSummary,
        lnhpd: lnhpdSummary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[label-facts-summary] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
