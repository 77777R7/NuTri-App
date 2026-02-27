#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const SOURCE_DATE = "2026-02-23";
const ROLE_DESCRIPTIONS = {
  killer: "historical killer barcode",
  lnhpd: "regulatory LNHPD path",
  dsld: "DSLD label path",
  ceiling: "LNHPD data-ceiling explainability suite",
  web_hint: "web hint boundary path",
  not_found: "not_found probe",
};
const DEFAULT_SET = {
  killer: "00665553227870",
  lnhpd: "00064642079992",
  dsld: "00690290532093",
  web_hint: "00666183000154",
  not_found: "99999999999999",
};
const PROFILE_MAP = {
  smoke5: 5,
  stratified30: 30,
  stratified50: 50,
  authoritative30: 30,
  authoritative200: 200,
  ceiling4: 4,
};
const AUTHORITATIVE_PROFILE_TARGETS = {
  authoritative30: { lnhpd: 15, dsld: 15 },
  authoritative200: { lnhpd: 100, dsld: 100 },
};
const STRATIFIED50_RELEASE_ROLE_COUNTS = Object.freeze({
  lnhpd: 18,
  dsld: 24,
  web_hint: 6,
  not_found: 2,
});

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const exact = args.find((entry) => entry.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const outArg = arg("--out", "");
const profileArgRaw = String(arg("--profile", "smoke5") || "smoke5").trim().toLowerCase();
const profile = profileArgRaw in PROFILE_MAP ? profileArgRaw : "smoke5";
const targetCount = PROFILE_MAP[profile];
const outPath = (() => {
  if (!outArg) return "";
  if (path.isAbsolute(outArg)) return outArg;
  return path.join(ROOT_DIR, outArg);
})();

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 8) return "";
  const normalized = digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0");
  if (!normalized || /^0+$/.test(normalized)) return "";
  return normalized;
};
const CEILING_SUITE_BARCODES = [
  "00826913120150",
  "00628747110204",
  "00064642062321",
  "00851722000812",
].map((value) => normalizeBarcode(value)).filter(Boolean);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const diagnostics = [];
const logDiag = (message, meta = {}) => {
  diagnostics.push({ message, ...meta });
};

const createSupabase = () =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const looksLikeDsldRow = (row) => {
  const outcome = String(row?.outcome ?? "").toLowerCase();
  if (outcome.includes("dsld")) return true;
  const signals = row?.signals;
  if (!signals) return false;
  const signalText = JSON.stringify(signals).toLowerCase();
  return signalText.includes("dsld") || signalText.includes("labelid") || signalText.includes("dsldlabelid");
};

const looksLikeWebHintRow = (row) => {
  const outcome = String(row?.outcome ?? "").toLowerCase();
  if (outcome.includes("web") || outcome.includes("marketplace")) return true;
  const signals = row?.signals;
  if (!signals) return false;
  const signalText = JSON.stringify(signals).toLowerCase();
  return signalText.includes("web") || signalText.includes("needs_js") || signalText.includes("marketplace");
};

const hasDsldLabelId = (row) => {
  const raw = row?.dsld_label_id ?? row?.dsldLabelId ?? row?.dsld_labelid ?? null;
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length > 0;
};

const looksLikeDsldSnapshotRow = (row) => {
  const payload = row?.payload_json;
  if (!payload || typeof payload !== "object") return false;
  const label = payload?.label && typeof payload.label === "object" ? payload.label : null;
  const actives = Array.isArray(label?.actives) ? label.actives : [];
  const hasDsldActives = actives.some((active) => String(active?.source ?? "").toLowerCase() === "dsld");
  if (hasDsldActives) return true;
  const dsldLabelId =
    label?.metadata?.dsldLabelId ??
    payload?.regulatory?.dsldLabelId ??
    payload?.regulatory?.dsld_label_id ??
    null;
  return hasDsldLabelId({ dsldLabelId });
};

const looksLikeDsldCanonicalRow = (row) => {
  const barcode = normalizeBarcode(row?.barcode_normalized_gtin14);
  const canonicalLabelId = String(row?.canonical_dsld_label_id ?? "").replace(/\D/g, "");
  return Boolean(barcode && canonicalLabelId);
};

const looksLikeDsldMetaRow = (row) => {
  const barcode = normalizeBarcode(row?.barcode_normalized_gtin14);
  return Boolean(barcode && row?.is_canonical_for_barcode === true);
};

const rowBarcodeCandidates = (row) => {
  if (!row || typeof row !== "object") return [];
  const keys = [
    "key",
    "gtin14",
    "barcode_normalized_gtin14",
    "barcode_gtin14",
    "barcode",
    "barcode_raw",
    "barcode_digits",
    "upc_digits_str",
    "upc",
    "ean",
    "code",
  ];
  const out = [];
  for (const key of keys) {
    const value = normalizeBarcode(row?.[key]);
    if (!value) continue;
    out.push(value);
  }
  return Array.from(new Set(out));
};

const selectBarcodes = async () => {
  const chosen = {
    killer: normalizeBarcode(DEFAULT_SET.killer),
    lnhpd: normalizeBarcode(DEFAULT_SET.lnhpd),
    dsld: normalizeBarcode(DEFAULT_SET.dsld),
    web_hint: normalizeBarcode(DEFAULT_SET.web_hint),
    not_found: normalizeBarcode(DEFAULT_SET.not_found),
  };

  if (!hasSupabase) {
    logDiag("supabase_unavailable", {
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasServiceRole: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    });
    return {
      chosen,
      supabaseVerified: false,
      replacements: [],
      pools: {
        lnhpd: [chosen.lnhpd],
        dsld: [chosen.dsld],
        web_hint: [chosen.web_hint],
      },
    };
  }

  const supabase = createSupabase();
  const replacements = [];

  const verifyLnhpd = async (barcode) => {
    try {
      const { data, error } = await supabase
        .from("barcode_regulatory_map")
        .select("*")
        .limit(500);
      if (error) {
        logDiag("verify_lnhpd_query_error", { barcode, error: error.message });
        return false;
      }
      return (
        Array.isArray(data) &&
        data.some((row) => {
          const hasNpn = Boolean(String(row?.npn ?? "").replace(/\D/g, ""));
          if (!hasNpn) return false;
          return rowBarcodeCandidates(row).includes(barcode);
        })
      );
    } catch (error) {
      logDiag("verify_lnhpd_exception", { barcode, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const verifyResolutionPattern = async (barcode, matcher, label) => {
    try {
      const { data, error } = await supabase
        .from("barcode_resolution_training")
        .select("*")
        .limit(800);
      if (error) {
        logDiag(`verify_${label}_query_error`, { barcode, error: error.message });
        return false;
      }
      return (
        Array.isArray(data) &&
        data.some((row) => rowBarcodeCandidates(row).includes(barcode) && matcher(row))
      );
    } catch (error) {
      logDiag(`verify_${label}_exception`, { barcode, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const pickFallback = async (params) => {
    const {
      role,
      query,
      matcher,
    } = params;

    try {
      const { data, error } = await query();
      if (error) {
        logDiag(`fallback_${role}_query_error`, { error: error.message });
        return null;
      }
      if (!Array.isArray(data) || data.length === 0) {
        logDiag(`fallback_${role}_empty`);
        return null;
      }

      for (const row of data) {
        const candidate = rowBarcodeCandidates(row)[0] ?? "";
        if (!candidate) continue;
        if (Object.values(chosen).includes(candidate)) continue;
        if (!matcher(row)) continue;
        return candidate;
      }
      return null;
    } catch (error) {
      logDiag(`fallback_${role}_exception`, { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const lnhpdOk = await verifyLnhpd(chosen.lnhpd);
  if (!lnhpdOk) {
    const fallback = await pickFallback({
      role: "lnhpd",
      query: () =>
        supabase
          .from("barcode_regulatory_map")
          .select("*")
          .limit(800),
      matcher: (row) => Boolean(String(row?.npn ?? "").replace(/\D/g, "")),
    });
    if (fallback) {
      replacements.push({ role: "lnhpd", from: chosen.lnhpd, to: fallback });
      chosen.lnhpd = fallback;
    }
  }

  const dsldOk = await verifyResolutionPattern(chosen.dsld, looksLikeDsldRow, "dsld");
  if (!dsldOk) {
    const fallback = await pickFallback({
      role: "dsld",
      query: () =>
        supabase
          .from("barcode_resolution_training")
          .select("*")
          .limit(1200),
      matcher: looksLikeDsldRow,
    });
    if (fallback) {
      replacements.push({ role: "dsld", from: chosen.dsld, to: fallback });
      chosen.dsld = fallback;
    }
  }

  const webOk = await verifyResolutionPattern(chosen.web_hint, looksLikeWebHintRow, "web_hint");
  if (!webOk) {
    const fallback = await pickFallback({
      role: "web_hint",
      query: () =>
        supabase
          .from("barcode_resolution_training")
          .select("*")
          .limit(1200),
      matcher: looksLikeWebHintRow,
    });
    if (fallback) {
      replacements.push({ role: "web_hint", from: chosen.web_hint, to: fallback });
      chosen.web_hint = fallback;
    }
  }

  const killerProbeTables = ["snapshots", "barcode_resolution_training"];
  for (const tableName of killerProbeTables) {
    try {
      const { error } = await supabase.from(tableName).select("*").limit(1);
      if (error) {
        logDiag("table_probe_error", { table: tableName, error: error.message });
      }
    } catch (error) {
      logDiag("table_probe_exception", { table: tableName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const collectPool = async ({ table, matcher, limit, pageSize = 1000 }) => {
    try {
      const out = [];
      const seen = new Set();
      const safePageSize = Math.max(100, Number(pageSize) || 1000);
      const maxRows = Math.max(safePageSize, Number(limit) || safePageSize);
      let offset = 0;
      while (offset < maxRows) {
        const start = offset;
        const end = Math.min(offset + safePageSize - 1, maxRows - 1);
        const { data, error } = await supabase.from(table).select("*").range(start, end);
        if (error) {
          if (offset > 0) {
            logDiag("collect_pool_pagination_end", { table, offset, error: error.message });
            break;
          }
          logDiag("collect_pool_query_error", { table, error: error.message });
          return [];
        }
        if (!Array.isArray(data) || data.length === 0) {
          break;
        }
        for (const row of data) {
          if (!matcher(row)) continue;
          for (const candidate of rowBarcodeCandidates(row)) {
            if (!candidate || seen.has(candidate)) continue;
            seen.add(candidate);
            out.push(candidate);
            break;
          }
        }
        offset += data.length;
        if (data.length < safePageSize) {
          break;
        }
      }
      return out;
    } catch (error) {
      logDiag("collect_pool_exception", {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  const lnhpdPool = await collectPool({
    table: "barcode_regulatory_map",
    matcher: (row) => Boolean(String(row?.npn ?? "").replace(/\D/g, "")),
    limit: 3000,
  });
  const dsldPoolFromResolution = await collectPool({
    table: "barcode_resolution_training",
    matcher: looksLikeDsldRow,
    limit: 5000,
  });
  const dsldPoolFromMap = await collectPool({
    table: "barcode_regulatory_map",
    matcher: hasDsldLabelId,
    limit: 3000,
  });
  const dsldPoolFromSnapshots = await collectPool({
    table: "snapshots",
    matcher: looksLikeDsldSnapshotRow,
    limit: 5000,
  });
  const dsldPoolFromCanonical = await collectPool({
    table: "dsld_barcode_canonical",
    matcher: looksLikeDsldCanonicalRow,
    limit: 20000,
  });
  const dsldPoolFromLabelsMeta = await collectPool({
    table: "dsld_labels_meta",
    matcher: looksLikeDsldMetaRow,
    limit: 20000,
  });
  const dsldPool = Array.from(
    new Set([
      ...dsldPoolFromResolution,
      ...dsldPoolFromMap,
      ...dsldPoolFromSnapshots,
      ...dsldPoolFromCanonical,
      ...dsldPoolFromLabelsMeta,
    ]),
  );
  const webHintPool = await collectPool({
    table: "barcode_resolution_training",
    matcher: looksLikeWebHintRow,
    limit: 5000,
  });

  logDiag("pool_counts", {
    lnhpd: lnhpdPool.length,
    dsldFromResolution: dsldPoolFromResolution.length,
    dsldFromMap: dsldPoolFromMap.length,
    dsldFromSnapshots: dsldPoolFromSnapshots.length,
    dsldFromCanonical: dsldPoolFromCanonical.length,
    dsldFromLabelsMeta: dsldPoolFromLabelsMeta.length,
    dsldTotal: dsldPool.length,
    webHint: webHintPool.length,
  });

  return {
    chosen,
    supabaseVerified: true,
    replacements,
    pools: {
      lnhpd: lnhpdPool,
      dsld: dsldPool,
      web_hint: webHintPool,
    },
  };
};

const buildSyntheticNotFoundBarcode = (index) =>
  normalizeBarcode(`9999${String(index).padStart(10, "0")}`);

const buildRolePlan = (count, selectedProfile) => {
  if (selectedProfile === "smoke5") {
    return ["killer", "lnhpd", "dsld", "web_hint", "not_found"].slice(0, count);
  }
  if (selectedProfile === "ceiling4") {
    return Array(Math.max(0, count)).fill("ceiling");
  }
  if (selectedProfile === "authoritative30" || selectedProfile === "authoritative200") {
    const target = AUTHORITATIVE_PROFILE_TARGETS[selectedProfile] || { lnhpd: 0, dsld: 0 };
    const authoritativePlan = [...Array(target.lnhpd).fill("lnhpd"), ...Array(target.dsld).fill("dsld")];
    return authoritativePlan.slice(0, count);
  }
  if (selectedProfile === "stratified50") {
    const weightedPlan = [
      ...Array(STRATIFIED50_RELEASE_ROLE_COUNTS.lnhpd).fill("lnhpd"),
      ...Array(STRATIFIED50_RELEASE_ROLE_COUNTS.dsld).fill("dsld"),
      ...Array(STRATIFIED50_RELEASE_ROLE_COUNTS.web_hint).fill("web_hint"),
      ...Array(STRATIFIED50_RELEASE_ROLE_COUNTS.not_found).fill("not_found"),
    ];
    return weightedPlan.slice(0, count);
  }
  if (count <= 4) {
    return ["lnhpd", "dsld", "web_hint", "not_found"].slice(0, count);
  }
  const plan = ["lnhpd", "dsld", "web_hint", "not_found"];
  const fillOrder = ["lnhpd", "dsld", "web_hint", "lnhpd", "dsld", "web_hint", "not_found"];
  while (plan.length < count) {
    plan.push(fillOrder[(plan.length - 4) % fillOrder.length]);
  }
  return plan.slice(0, count);
};

const pickRoleBarcode = ({ role, index, selection, pools, used, enforceUnique }) => {
  if (role === "ceiling") {
    const candidate = CEILING_SUITE_BARCODES[index % CEILING_SUITE_BARCODES.length] || "";
    if (!candidate) return "";
    if (!enforceUnique || !used.has(candidate)) return candidate;
    return "";
  }
  if (role === "not_found") {
    if (index === 0) return selection.chosen.not_found;
    let cursor = index;
    while (cursor < index + 1000) {
      const candidate = buildSyntheticNotFoundBarcode(cursor);
      if (candidate && (!enforceUnique || !used.has(candidate))) return candidate;
      cursor += 1;
    }
    return selection.chosen.not_found;
  }

  if (role === "killer") {
    return selection.chosen.killer;
  }

  const rolePool = Array.isArray(pools?.[role]) ? pools[role] : [];
  let cursor = index;
  for (let i = 0; i < rolePool.length; i += 1) {
    const candidate = normalizeBarcode(rolePool[cursor % rolePool.length]);
    cursor += 1;
    if (!candidate) continue;
    if (!enforceUnique || !used.has(candidate)) return candidate;
  }

  const fallback = normalizeBarcode(selection.chosen?.[role]);
  if (fallback && (!enforceUnique || !used.has(fallback))) return fallback;
  return "";
};

const main = async () => {
  const selection = await selectBarcodes();
  const enforceUnique =
    profile === "stratified30"
    || profile === "stratified50"
    || profile === "authoritative30"
    || profile === "authoritative200"
    || profile === "ceiling4";
  const pools = selection.pools || {
    lnhpd: [selection.chosen.lnhpd],
    dsld: [selection.chosen.dsld],
    web_hint: [selection.chosen.web_hint],
  };
  if (profile === "ceiling4") {
    const barcodes = CEILING_SUITE_BARCODES.slice(0, targetCount).map((barcode) => ({
      role: "ceiling",
      barcode,
      description: ROLE_DESCRIPTIONS.ceiling,
    }));
    if (barcodes.length < targetCount) {
      throw new Error(`ceiling4 requires ${targetCount} configured barcodes (got ${barcodes.length})`);
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      sourceDate: SOURCE_DATE,
      profile,
      requestedCount: targetCount,
      structure: "ceiling explainability suite (4 fixed LNHPD data-ceiling barcodes)",
      uniquenessEnforced: true,
      supabaseVerified: selection.supabaseVerified,
      replacements: selection.replacements,
      barcodes,
      diagnostics,
    };
    const json = JSON.stringify(payload, null, 2);
    if (outPath) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, json);
    }
    process.stdout.write(`${json}\n`);
    return;
  }

  if (profile === "authoritative30" || profile === "authoritative200") {
    const target = AUTHORITATIVE_PROFILE_TARGETS[profile] || { lnhpd: 15, dsld: 15 };
    const used = new Set();
    const takeUnique = (values, required) => {
      const out = [];
      for (const value of values) {
        const barcode = normalizeBarcode(value);
        if (!barcode || used.has(barcode)) continue;
        used.add(barcode);
        out.push(barcode);
        if (out.length >= required) break;
      }
      return out;
    };
    const lnhpdCandidates = [...(pools.lnhpd || []), selection.chosen.lnhpd];
    const dsldCandidates = [...(pools.dsld || []), selection.chosen.dsld];
    const lnhpdList = takeUnique(lnhpdCandidates, target.lnhpd);
    const dsldList = takeUnique(dsldCandidates, target.dsld);
    if (lnhpdList.length < target.lnhpd || dsldList.length < target.dsld) {
      throw new Error(
        `${profile} requires ${target.lnhpd} lnhpd + ${target.dsld} dsld unique barcodes (got lnhpd=${lnhpdList.length}, dsld=${dsldList.length})`,
      );
    }
    const barcodes = [
      ...lnhpdList.map((barcode) => ({
        role: "lnhpd",
        barcode,
        description: ROLE_DESCRIPTIONS.lnhpd,
      })),
      ...dsldList.map((barcode) => ({
        role: "dsld",
        barcode,
        description: ROLE_DESCRIPTIONS.dsld,
      })),
    ];
    const payload = {
      generatedAt: new Date().toISOString(),
      sourceDate: SOURCE_DATE,
      profile,
      requestedCount: targetCount,
      structure: `authoritative set (${target.lnhpd} lnhpd + ${target.dsld} dsld), killer/web_hint/not_found excluded`,
      uniquenessEnforced: true,
      supabaseVerified: selection.supabaseVerified,
      replacements: selection.replacements,
      barcodes,
      diagnostics,
    };
    const json = JSON.stringify(payload, null, 2);
    if (outPath) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, json);
    }
    process.stdout.write(`${json}\n`);
    return;
  }

  const rolePlan = buildRolePlan(targetCount, profile);
  const roleIndex = new Map();
  const used = new Set();
  const barcodes = rolePlan
    .map((role) => {
      let barcode = "";
      let guard = 0;
      while (!barcode && guard < 64) {
        const currentIndex = roleIndex.get(role) || 0;
        roleIndex.set(role, currentIndex + 1);
        barcode = pickRoleBarcode({
          role,
          index: currentIndex,
          selection,
          pools,
          used,
          enforceUnique,
        });
        if (barcode && enforceUnique && used.has(barcode)) {
          barcode = "";
        }
        guard += 1;
      }
      if (barcode && (enforceUnique || role !== "killer")) {
        used.add(barcode);
      }
      return {
        role,
        barcode,
        description: ROLE_DESCRIPTIONS[role] || role,
      };
    })
    .filter((entry) => entry.barcode);

  if (enforceUnique && barcodes.length < targetCount) {
    const fallbackRoles =
      profile === "authoritative30" || profile === "authoritative200"
        ? ["lnhpd", "dsld"]
        : ["lnhpd", "dsld", "web_hint", "not_found"];
    let guard = 0;
    while (barcodes.length < targetCount && guard < targetCount * 64) {
      const role = fallbackRoles[guard % fallbackRoles.length];
      const currentIndex = roleIndex.get(role) || 0;
      roleIndex.set(role, currentIndex + 1);
      const barcode = pickRoleBarcode({
        role,
        index: currentIndex,
        selection,
        pools,
        used,
        enforceUnique: true,
      });
      if (!barcode || used.has(barcode)) {
        guard += 1;
        continue;
      }
      used.add(barcode);
      barcodes.push({
        role,
        barcode,
        description: ROLE_DESCRIPTIONS[role] || role,
      });
      guard += 1;
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDate: SOURCE_DATE,
    profile,
    requestedCount: targetCount,
    structure:
      profile === "smoke5"
        ? "includes killer + LNHPD + DSLD + web_hint + not_found roles"
        : profile === "ceiling4"
          ? "ceiling suite (4 fixed LNHPD data-ceiling barcodes)"
        : profile === "stratified50"
          ? "stratified unique set (lnhpd/dsld/web_hint/not_found), killer excluded; stratified50 UL-eligible weighted (lnhpd=18 dsld=24 web_hint=6 not_found=2)"
        : profile === "authoritative30" || profile === "authoritative200"
          ? `authoritative set (${AUTHORITATIVE_PROFILE_TARGETS[profile]?.lnhpd ?? 15} lnhpd + ${AUTHORITATIVE_PROFILE_TARGETS[profile]?.dsld ?? 15} dsld), killer/web_hint/not_found excluded`
          : "stratified unique set (lnhpd/dsld/web_hint/not_found), killer excluded",
    uniquenessEnforced: enforceUnique,
    supabaseVerified: selection.supabaseVerified,
    replacements: selection.replacements,
    barcodes,
    diagnostics,
  };

  const json = JSON.stringify(payload, null, 2);
  if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, json);
  }

  process.stdout.write(`${json}\n`);
};

main().catch((error) => {
  console.error("[mobile-soak-select-barcodes] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
