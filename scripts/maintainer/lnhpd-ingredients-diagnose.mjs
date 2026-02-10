#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
const OUT_DIR = path.join(ROOT_DIR, "output", `lnhpd-ingredients-diagnose-${Date.now()}`);

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const NPN_CASES = [
  { npn: "80021829", barcode: "00628747100113" },
  { npn: "80044382", barcode: "00628747200264" },
  { npn: "80010311", barcode: "00628747108652" },
  { npn: "80043836", barcode: "00628747101240" },
  { npn: "80017685", barcode: "00628747101486" },
];

function describeShape(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array(len=${value.length})`;
  const t = typeof value;
  if (t !== "object") return t;
  const keys = Object.keys(value);
  const sample = keys.slice(0, 8);
  return `object(keys=${keys.length}, sample=[${sample.join(",")}])`;
}

function findNameCandidate(obj) {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj;
  const keys = Object.keys(rec);
  const nameKey = keys.find((k) => k.toLowerCase().includes("name"));
  if (nameKey && typeof rec[nameKey] === "string") return rec[nameKey];
  return null;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Abort.");
    process.exit(1);
  }

  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const rows = [];
  for (const c of NPN_CASES) {
    // Prefer complete, then fallback to on-market.
    const query = async (table) => {
      let q = supabase
        .from(table)
        .select("npn,dataset_version,extracted_at,facts_json")
        .eq("npn", c.npn)
        .limit(1);
      if (table === "lnhpd_facts") q = q.eq("is_on_market", true);
      const { data, error } = await q;
      if (error || !data || data.length === 0) return null;
      return data[0];
    };

    const record = (await query("lnhpd_facts_complete")) || (await query("lnhpd_facts"));
    const facts = record?.facts_json || null;
    const medicinal = facts?.medicinalIngredients;
    const nonMedicinal = facts?.nonMedicinalIngredients;
    const purposes = facts?.purposes;
    const doses = facts?.doses;

    // Try best-effort count for medicinal ingredients if it looks iterable.
    let medicinalCount = null;
    let medicinalExampleName = null;
    if (Array.isArray(medicinal)) {
      medicinalCount = medicinal.length;
      medicinalExampleName = findNameCandidate(medicinal[0]);
    } else if (medicinal && typeof medicinal === "object") {
      const values = Object.values(medicinal);
      const objValues = values.filter((v) => v && typeof v === "object");
      if (objValues.length > 0) {
        medicinalCount = objValues.length;
        medicinalExampleName = findNameCandidate(objValues[0]);
      }
    }

    rows.push({
      npn: c.npn,
      barcode: c.barcode,
      datasetVersion: record?.dataset_version ?? null,
      extractedAt: record?.extracted_at ?? null,
      medicinalShape: describeShape(medicinal),
      medicinalCount,
      medicinalExampleName,
      nonMedicinalShape: describeShape(nonMedicinal),
      purposesShape: describeShape(purposes),
      dosesShape: describeShape(doses),
      found: Boolean(record),
    });
  }

  const outPath = path.join(OUT_DIR, "lnhpd-ingredients-diagnose.json");
  await fs.promises.writeFile(outPath, JSON.stringify(rows, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log("\nnpn\tbarcode\tfound\tmedicinalShape\tmedicinalCount\texampleName\tdatasetVersion");
  for (const r of rows) {
    console.log(
      [
        r.npn,
        r.barcode,
        r.found ? "yes" : "no",
        r.medicinalShape,
        r.medicinalCount ?? "",
        (r.medicinalExampleName ?? "").slice(0, 60),
        r.datasetVersion ?? "",
      ].join("\t"),
    );
  }
}

main().catch((err) => {
  console.error("lnhpd-ingredients-diagnose failed:", err);
  process.exit(1);
});

