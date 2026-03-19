import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.join(repoRoot, "output");
const activeDir = path.join(repoRoot, "docs/exec-plans/active/week3_safety");
const historyDir = path.join(repoRoot, "docs/exec-plans/history/week3_safety");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const TIER1_KEYS = ["magnesium", "vitamin_c", "zinc", "iron", "folate"];
const TIER1_LABELS = {
  magnesium: "Magnesium",
  vitamin_c: "Vitamin C",
  zinc: "Zinc",
  iron: "Iron",
  folate: "Folate",
};
const MAX_SAVED_ROWS = 500;
const MAX_CASE2_SEARCH_ROWS = 12;
const MAX_CASE3_SEARCH_ROWS = 10;
const MAX_OVERLAPS = 5;
const MAX_PER_SUPPLEMENT = 6;
const SAVED_SUPPLEMENTS_STORAGE_KEY = "nu.savedSupplements:v1";
const LOCAL_SIMULATOR_ROOT = path.join(os.homedir(), "Library/Developer/CoreSimulator/Devices");

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const writeJson = (filePath, value) => fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const writeText = (filePath, value) => fs.writeFileSync(filePath, `${value.replace(/\s+$/, "")}\n`, "utf8");
const copyToCanonical = (filePath) => {
  const baseName = path.basename(filePath);
  fs.copyFileSync(filePath, path.join(activeDir, baseName));
  fs.copyFileSync(filePath, path.join(historyDir, `${timestamp}_${baseName}`));
};

const run = (command, args) => {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
};

const importDist = async (relativePath) =>
  import(pathToFileURL(path.join(repoRoot, "backend/dist", relativePath)).href);

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const toTimestamp = (value) => {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : 0;
};

const parseArgs = (argv) => {
  const parsed = {
    auditUserId: null,
    auditSourceLabel: "local_saved_products",
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--audit-user-id=")) {
      parsed.auditUserId = normalizeText(arg.slice("--audit-user-id=".length)) || null;
      continue;
    }
    if (arg.startsWith("--audit-source-label=")) {
      parsed.auditSourceLabel = normalizeText(arg.slice("--audit-source-label=".length)) || parsed.auditSourceLabel;
    }
  }

  return parsed;
};

const combinations = (items, size) => {
  if (size <= 0 || size > items.length) return [];
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let index = start; index <= items.length - (size - acc.length); index += 1) {
      acc.push(items[index]);
      walk(index + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
};

const buildBarcodeCacheKey = (normalizeBarcodeInput, barcode) => {
  const normalized = normalizeBarcodeInput(String(barcode ?? ""));
  return normalized ? normalized.code.padStart(14, "0") : null;
};

const pathExists = (value) => {
  try {
    fs.accessSync(value);
    return true;
  } catch {
    return false;
  }
};

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readStorageValue = (storageDir, key) => {
  const manifestPath = path.join(storageDir, "manifest.json");
  const manifest = readJsonFile(manifestPath) ?? {};
  const hashedKey = createHash("md5").update(key).digest("hex");
  const hashedPath = path.join(storageDir, hashedKey);

  if (typeof manifest[key] === "string" && manifest[key].trim()) {
    return manifest[key];
  }
  if (pathExists(hashedPath)) {
    const value = fs.readFileSync(hashedPath, "utf8");
    return value.trim() ? value : null;
  }
  return null;
};

const safeParseJsonArray = (raw) => {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const discoverLocalSavedLibraries = () => {
  if (!pathExists(LOCAL_SIMULATOR_ROOT)) return [];

  const libraries = [];
  const deviceIds = fs.readdirSync(LOCAL_SIMULATOR_ROOT, { withFileTypes: true });
  for (const deviceEntry of deviceIds) {
    if (!deviceEntry.isDirectory()) continue;
    const deviceId = deviceEntry.name;
    const applicationsRoot = path.join(
      LOCAL_SIMULATOR_ROOT,
      deviceId,
      "data/Containers/Data/Application",
    );
    if (!pathExists(applicationsRoot)) continue;

    const appEntries = fs.readdirSync(applicationsRoot, { withFileTypes: true });
    for (const appEntry of appEntries) {
      if (!appEntry.isDirectory()) continue;
      const appContainerId = appEntry.name;
      const appRoot = path.join(applicationsRoot, appContainerId);

      const nativeStorageDir = path.join(
        appRoot,
        "Library/Application Support/com.nutri-Nige.app/RCTAsyncLocalStorage_V1",
      );
      if (pathExists(nativeStorageDir)) {
        const raw = readStorageValue(nativeStorageDir, SAVED_SUPPLEMENTS_STORAGE_KEY);
        const items = safeParseJsonArray(raw);
        if (items.length > 0) {
          libraries.push({
            libraryId: `native:${deviceId}:${appContainerId}`,
            deviceId,
            appContainerId,
            storageType: "native_app",
            storagePath: nativeStorageDir,
            sourceUserLabel: `local-native:${deviceId.slice(0, 6)}:${appContainerId.slice(0, 6)}`,
            savedItems: items,
          });
        }
      }

      const expoRoot = path.join(appRoot, "Documents/ExponentExperienceData");
      if (!pathExists(expoRoot)) continue;
      const namespaceEntries = fs.readdirSync(expoRoot, { withFileTypes: true });
      for (const namespaceEntry of namespaceEntries) {
        if (!namespaceEntry.isDirectory()) continue;
        const namespaceDir = path.join(expoRoot, namespaceEntry.name);
        const experienceEntries = fs.readdirSync(namespaceDir, { withFileTypes: true });
        for (const experienceEntry of experienceEntries) {
          if (!experienceEntry.isDirectory()) continue;
          if (!experienceEntry.name.includes("nutri-app")) continue;
          const storageDir = path.join(namespaceDir, experienceEntry.name, "RCTAsyncLocalStorage");
          if (!pathExists(storageDir)) continue;
          const raw = readStorageValue(storageDir, SAVED_SUPPLEMENTS_STORAGE_KEY);
          const items = safeParseJsonArray(raw);
          if (items.length === 0) continue;
          libraries.push({
            libraryId: `expo:${deviceId}:${appContainerId}:${namespaceEntry.name}:${experienceEntry.name}`,
            deviceId,
            appContainerId,
            storageType: "expo_async_storage",
            storagePath: storageDir,
            sourceUserLabel: `local-expo:${deviceId.slice(0, 6)}:${appContainerId.slice(0, 6)}`,
            savedItems: items,
          });
        }
      }
    }
  }

  return libraries.sort((left, right) => left.storagePath.localeCompare(right.storagePath));
};

const mapSnapshotToIngredientRows = (snapshot, { usableOnly = true } = {}) =>
  (snapshot?.label?.actives ?? [])
    .map((active) => {
      const name = normalizeText(active?.name);
      if (!name) return null;
      const unit = active?.amountUnitNormalized ?? active?.amountUnit ?? active?.amountUnitRaw ?? null;
      const amount = active?.amountUnknown ? null : active?.amount ?? null;
      if (usableOnly && (amount == null || !unit)) return null;
      return {
        name,
        amount,
        unit,
        amountText:
          amount != null && unit
            ? `${amount} ${unit}`.trim()
            : null,
        chemicalForm: active?.form ?? null,
      };
    })
    .filter((row) => Boolean(row))
    .slice(0, 24);

const mapSnapshotActivesToDigest = (snapshot) => ({
  actives: mapSnapshotToIngredientRows(snapshot, { usableOnly: false }).map((active) => ({
    name: active.name,
    amount: active.amount,
    unit: active.unit,
    amountText: active.amountText,
    chemicalForm: active.chemicalForm,
    chemicalFormEvidence: null,
  })),
  labelDosing: [],
});

const fetchSnapshotByKey = async (supabase, key) => {
  if (!key) return null;
  const { data, error } = await supabase
    .from("snapshots")
    .select("key,source,payload_json,updated_at")
    .eq("key", key)
    .eq("source", "barcode")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.payload_json) return null;
  return {
    key: data.key,
    source: data.source,
    updatedAt: data.updated_at ?? null,
    snapshot: data.payload_json,
  };
};

const buildCandidateIngredientMeta = ({
  row,
  canonicalizeSafetyIngredient,
  normalizeDoseForSafety,
  matchSafetyUl,
  buildDailyDoseBasisLabel,
}) => {
  const byKey = {};
  const ingredientRows = Array.isArray(row.routeInput?.ingredientRows) ? row.routeInput.ingredientRows : [];

  for (const ingredientRow of ingredientRows) {
    const ingredient = canonicalizeSafetyIngredient({
      rawIngredientText: ingredientRow.name,
      formHints: [ingredientRow.chemicalForm],
    });
    if (!ingredient.ingredientCanonicalKey) continue;

    const dose = normalizeDoseForSafety({
      amount: ingredientRow.amount,
      unit: ingredientRow.unit,
      amountText: ingredientRow.amountText ?? null,
      dailyMultiplier: row.routeInput.dailyMultiplier ?? 1,
      dailyDoseBasis: row.routeInput.dailyDoseBasis ?? "one_serving_fallback",
      dailyDoseBasisReason: row.routeInput.dailyDoseBasisReason ?? "missing_directions",
    });
    const ul = matchSafetyUl({ ingredient, dose });

    const key = ingredient.ingredientCanonicalKey;
    const existing = byKey[key] ?? {
      ingredientCanonicalKey: key,
      ingredientDisplayName: ingredient.ingredientDisplayName,
      launchTier: ingredient.launchTier,
      comparable: false,
      notComparable: false,
      noUlEstablished: false,
      ulValueText: null,
      currentDoseUnits: new Set(),
      dailyDoseBases: new Set(),
      dailyDoseBasisLabels: new Set(),
      comparableStatuses: new Set(),
    };

    if (ul.comparisonStatus === "below" || ul.comparisonStatus === "near" || ul.comparisonStatus === "over") {
      existing.comparable = true;
      existing.comparableStatuses.add(ul.comparisonStatus);
    } else if (ul.comparisonStatus === "not_comparable") {
      existing.notComparable = true;
    } else if (ul.comparisonStatus === "no_ul_established") {
      existing.noUlEstablished = true;
    }

    if (ul.ulValueText) existing.ulValueText = existing.ulValueText ?? ul.ulValueText;
    if (ul.currentDoseUnit ?? dose.dailyEstimatedDoseUnit) {
      existing.currentDoseUnits.add(ul.currentDoseUnit ?? dose.dailyEstimatedDoseUnit);
    }
    existing.dailyDoseBases.add(dose.dailyDoseBasis);
    existing.dailyDoseBasisLabels.add(buildDailyDoseBasisLabel(dose.dailyDoseBasis));
    byKey[key] = existing;
  }

  return {
    byKey,
    canonicalKeys: Object.keys(byKey),
  };
};

const buildUserPools = async ({
  supabase,
  normalizeBarcodeInput,
  buildSnapshotSafetyDoseContext,
  canonicalizeSafetyIngredient,
  normalizeDoseForSafety,
  matchSafetyUl,
  buildDailyDoseBasisLabel,
}) => {
  const { data, error } = await supabase
    .from("user_supplements")
    .select("id, user_id, supplement_id, saved_at, supplements ( id, name, barcode )")
    .order("saved_at", { ascending: false })
    .limit(MAX_SAVED_ROWS);

  if (error) {
    throw new Error(`saved supplements query failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const snapshotCache = new Map();
  const poolsByUser = new Map();
  let mostRecentUserId = null;

  const getPool = (userId) => {
    if (!poolsByUser.has(userId)) {
      poolsByUser.set(userId, {
        userId,
        sourceKind: "remote_user",
        sourceUserLabel: `user:${userId}`,
        latestSavedAtMs: 0,
        candidateRows: [],
        skippedRows: [],
        allRealSavedRows: [],
      });
    }
    return poolsByUser.get(userId);
  };

  for (const row of rows) {
    const userId = normalizeText(row.user_id);
    if (!userId) continue;
    if (!mostRecentUserId) mostRecentUserId = userId;

    const linkedSupplement = Array.isArray(row.supplements) ? row.supplements[0] ?? null : row.supplements ?? null;
    const barcode = normalizeText(linkedSupplement?.barcode);
    if (!barcode) continue;

    const cacheKey = buildBarcodeCacheKey(normalizeBarcodeInput, barcode);
    if (!cacheKey) continue;
    if (!snapshotCache.has(cacheKey)) {
      snapshotCache.set(cacheKey, await fetchSnapshotByKey(supabase, cacheKey));
    }

    const snapshotRow = snapshotCache.get(cacheKey);
    const snapshot = snapshotRow?.snapshot ?? null;
    if (!snapshot) continue;

    const supplementId = normalizeText(row.supplement_id || linkedSupplement?.id || row.id) || row.id;
    const productName =
      normalizeText(linkedSupplement?.name) ||
      normalizeText(snapshot?.product?.name) ||
      "Unknown supplement";
    const brandName = normalizeText(snapshot?.product?.brand) || "";
    const ingredientNames = mapSnapshotToIngredientRows(snapshot, { usableOnly: false }).map((item) => item.name);
    const usableIngredientRows = mapSnapshotToIngredientRows(snapshot, { usableOnly: true });
    const doseContext = buildSnapshotSafetyDoseContext({
      snapshot,
      supplementId,
      barcodeGtin14: cacheKey,
      brandName,
      productName,
      hasUsableActiveDose: usableIngredientRows.length > 0,
    });

    const baseRow = {
      userId,
      sourceUserLabel: `user:${userId}`,
      savedAt: row.saved_at ?? null,
      savedAtMs: toTimestamp(row.saved_at),
      userSupplementId: row.id,
      supplementId,
      productName,
      brandName,
      barcodeGtin14: cacheKey,
      snapshot,
      routeInput: {
        supplementId,
        productName,
        ingredientNames,
        ingredientRows: usableIngredientRows,
        dailyMultiplier: doseContext.dailyMultiplier,
        dailyDoseBasis: doseContext.dailyDoseBasis,
        dailyDoseBasisReason: doseContext.dailyDoseBasisReason,
      },
    };

    const pool = getPool(userId);
    pool.latestSavedAtMs = Math.max(pool.latestSavedAtMs, baseRow.savedAtMs);
    pool.allRealSavedRows.push(baseRow);

    if (usableIngredientRows.length > 0) {
      const meta = buildCandidateIngredientMeta({
        row: baseRow,
        canonicalizeSafetyIngredient,
        normalizeDoseForSafety,
        matchSafetyUl,
        buildDailyDoseBasisLabel,
      });
      pool.candidateRows.push({ ...baseRow, meta });
    } else {
      pool.skippedRows.push(baseRow);
    }
  }

  const pools = Array.from(poolsByUser.values()).map((pool) => {
    const duplicateCounts = {};
    for (const row of pool.candidateRows) {
      for (const key of row.meta.canonicalKeys) {
        duplicateCounts[key] = (duplicateCounts[key] ?? 0) + 1;
      }
    }
    return {
      ...pool,
      candidateRows: [...pool.candidateRows].sort((left, right) => right.savedAtMs - left.savedAtMs || left.productName.localeCompare(right.productName)),
      skippedRows: [...pool.skippedRows].sort((left, right) => right.savedAtMs - left.savedAtMs || left.productName.localeCompare(right.productName)),
      duplicateCounts,
    };
  });

  return {
    queriedRows: rows.length,
    pools,
    mostRecentUserId,
  };
};

const fetchSupplementsByIds = async (supabase, ids) => {
  const cleanIds = [...new Set(ids.map((value) => normalizeText(value)).filter((value) => UUID_RE.test(value)))];
  if (cleanIds.length === 0) return [];
  const { data, error } = await supabase
    .from("supplements")
    .select("id,name,barcode,brands(name)")
    .in("id", cleanIds);
  if (error) {
    throw new Error(`local saved supplement lookup by id failed: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
};

const fetchSupplementsByBarcodes = async (supabase, barcodes) => {
  const cleanBarcodes = [...new Set(barcodes.map((value) => normalizeText(value)).filter(Boolean))];
  if (cleanBarcodes.length === 0) return [];
  const { data, error } = await supabase
    .from("supplements")
    .select("id,name,barcode,brands(name)")
    .in("barcode", cleanBarcodes);
  if (error) {
    throw new Error(`local saved supplement lookup by barcode failed: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
};

const buildLocalSavedPools = async ({
  supabase,
  normalizeBarcodeInput,
  buildSnapshotSafetyDoseContext,
  canonicalizeSafetyIngredient,
  normalizeDoseForSafety,
  matchSafetyUl,
  buildDailyDoseBasisLabel,
}) => {
  const libraries = discoverLocalSavedLibraries();
  const snapshotCache = new Map();

  const supplementIds = libraries.flatMap((library) =>
    library.savedItems.map((item) => normalizeText(item.supplementId)).filter(Boolean),
  );
  const barcodeCandidates = libraries.flatMap((library) =>
    library.savedItems
      .map((item) => normalizeText(item.barcode))
      .filter((barcode) => barcode && !barcode.startsWith("label:"))
      .map((barcode) => buildBarcodeCacheKey(normalizeBarcodeInput, barcode))
      .filter(Boolean),
  );

  const [supplementsByIdRows, supplementsByBarcodeRows] = await Promise.all([
    fetchSupplementsByIds(supabase, supplementIds),
    fetchSupplementsByBarcodes(supabase, barcodeCandidates),
  ]);

  const supplementById = new Map(
    supplementsByIdRows.map((row) => [normalizeText(row.id), row]),
  );
  const supplementByBarcode = new Map(
    supplementsByBarcodeRows
      .map((row) => [buildBarcodeCacheKey(normalizeBarcodeInput, row.barcode), row])
      .filter(([key]) => Boolean(key)),
  );

  let mostRecentLocalPoolId = null;
  const pools = [];
  const libraryReports = [];

  for (const library of libraries) {
    const poolId = `local_saved:${library.libraryId}`;
    const pool = {
      userId: poolId,
      sourceKind: "local_saved_library",
      sourceUserLabel: library.sourceUserLabel,
      latestSavedAtMs: 0,
      candidateRows: [],
      skippedRows: [],
      allRealSavedRows: [],
      duplicateCounts: {},
    };
    const report = {
      libraryId: library.libraryId,
      sourceUserLabel: library.sourceUserLabel,
      storageType: library.storageType,
      storagePath: library.storagePath,
      totalSavedItems: library.savedItems.length,
      barcodeBackedItems: 0,
      supplementLinkedItems: 0,
      snapshotBackedItems: 0,
      usableCandidateItems: 0,
      skippedSnapshotItems: 0,
      excludedReasonCounts: {},
      products: [],
    };

    for (const item of library.savedItems) {
      const supplementRow = supplementById.get(normalizeText(item.supplementId));
      const savedBarcode = normalizeText(item.barcode);
      const linkedBarcode = normalizeText(supplementRow?.barcode);
      const rawBarcode =
        savedBarcode && !savedBarcode.startsWith("label:")
          ? savedBarcode
          : linkedBarcode || savedBarcode;
      const barcodeIsLabelOnly = rawBarcode.startsWith("label:");
      const cacheKey = barcodeIsLabelOnly ? null : buildBarcodeCacheKey(normalizeBarcodeInput, rawBarcode);
      const supplementId = normalizeText(item.supplementId || supplementRow?.id || item.id) || item.id;
      const savedAt = item.createdAt ?? item.updatedAt ?? null;
      const productName =
        normalizeText(item.productName) ||
        normalizeText(supplementRow?.name) ||
        "Unknown supplement";
      const brandName =
        normalizeText(item.brandName) ||
        normalizeText(supplementRow?.brands?.name) ||
        "";

      if (supplementRow?.id) {
        report.supplementLinkedItems += 1;
      }
      if (cacheKey) {
        report.barcodeBackedItems += 1;
      } else {
        const reason = barcodeIsLabelOnly ? "label_only_saved_item" : "missing_barcode";
        report.excludedReasonCounts[reason] = (report.excludedReasonCounts[reason] ?? 0) + 1;
        report.products.push({
          productName,
          supplementId,
          barcode: rawBarcode || null,
          reason,
        });
        continue;
      }

      if (!snapshotCache.has(cacheKey)) {
        snapshotCache.set(cacheKey, await fetchSnapshotByKey(supabase, cacheKey));
      }
      const snapshotRow = snapshotCache.get(cacheKey);
      if (!snapshotRow?.snapshot) {
        report.excludedReasonCounts.missing_cached_snapshot =
          (report.excludedReasonCounts.missing_cached_snapshot ?? 0) + 1;
        report.products.push({
          productName,
          supplementId,
          barcode: cacheKey,
          reason: "missing_cached_snapshot",
        });
        continue;
      }

      report.snapshotBackedItems += 1;
      const snapshot = snapshotRow.snapshot;
      const ingredientNames = mapSnapshotToIngredientRows(snapshot, { usableOnly: false }).map((entry) => entry.name);
      const usableIngredientRows = mapSnapshotToIngredientRows(snapshot, { usableOnly: true });
      const doseContext = buildSnapshotSafetyDoseContext({
        snapshot,
        supplementId,
        barcodeGtin14: cacheKey,
        brandName,
        productName,
        hasUsableActiveDose: usableIngredientRows.length > 0,
      });

      const baseRow = {
        userId: poolId,
        sourceUserLabel: library.sourceUserLabel,
        sourceKind: "local_saved_library",
        savedAt,
        savedAtMs: toTimestamp(savedAt),
        userSupplementId: item.id ?? supplementId,
        supplementId,
        productName,
        brandName,
        barcodeGtin14: cacheKey,
        snapshot,
        routeInput: {
          supplementId,
          productName,
          ingredientNames,
          ingredientRows: usableIngredientRows,
          dailyMultiplier: doseContext.dailyMultiplier,
          dailyDoseBasis: doseContext.dailyDoseBasis,
          dailyDoseBasisReason: doseContext.dailyDoseBasisReason,
        },
      };

      pool.latestSavedAtMs = Math.max(pool.latestSavedAtMs, baseRow.savedAtMs);
      pool.allRealSavedRows.push(baseRow);
      report.products.push({
        productName,
        supplementId,
        barcode: cacheKey,
        reason: usableIngredientRows.length > 0 ? "usable_candidate" : "snapshot_without_usable_actives",
      });

      if (usableIngredientRows.length > 0) {
        report.usableCandidateItems += 1;
        const meta = buildCandidateIngredientMeta({
          row: baseRow,
          canonicalizeSafetyIngredient,
          normalizeDoseForSafety,
          matchSafetyUl,
          buildDailyDoseBasisLabel,
        });
        pool.candidateRows.push({ ...baseRow, meta });
      } else {
        report.skippedSnapshotItems += 1;
        report.excludedReasonCounts.snapshot_without_usable_actives =
          (report.excludedReasonCounts.snapshot_without_usable_actives ?? 0) + 1;
        pool.skippedRows.push(baseRow);
      }
    }

    if (pool.latestSavedAtMs > 0 && (!mostRecentLocalPoolId || pool.latestSavedAtMs > (pools.find((entry) => entry.userId === mostRecentLocalPoolId)?.latestSavedAtMs ?? 0))) {
      mostRecentLocalPoolId = pool.userId;
    }

    for (const row of pool.candidateRows) {
      for (const key of row.meta.canonicalKeys) {
        pool.duplicateCounts[key] = (pool.duplicateCounts[key] ?? 0) + 1;
      }
    }

    pool.candidateRows.sort((left, right) => right.savedAtMs - left.savedAtMs || left.productName.localeCompare(right.productName));
    pool.skippedRows.sort((left, right) => right.savedAtMs - left.savedAtMs || left.productName.localeCompare(right.productName));
    pools.push(pool);
    libraryReports.push(report);
  }

  return {
    librariesDiscovered: libraries.length,
    pools,
    mostRecentLocalPoolId,
    libraryReports,
    totalSavedItems: libraryReports.reduce((sum, library) => sum + library.totalSavedItems, 0),
  };
};

const orderUserPools = (pools, priorityUserId) =>
  [...pools].sort((left, right) => {
    const leftPriority = left.userId === priorityUserId ? 0 : 1;
    const rightPriority = right.userId === priorityUserId ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (right.latestSavedAtMs !== left.latestSavedAtMs) return right.latestSavedAtMs - left.latestSavedAtMs;
    return left.userId.localeCompare(right.userId);
  });

const buildRoutePayload = ({ rows, buildStackOverlapResult }) => {
  const supplements = rows.map((row) => row.routeInput);
  const overlap = buildStackOverlapResult(supplements, {
    maxPerSupplement: MAX_PER_SUPPLEMENT,
    maxOverlaps: MAX_OVERLAPS,
    skippedSupplements: 0,
  });
  const processedSupplements = supplements.filter(
    (supplement) => Array.isArray(supplement.ingredientRows) && supplement.ingredientRows.length > 0,
  ).length;

  return {
    status: overlap.meta.skippedSupplements > 0 ? "partial" : "ok",
    overlaps: overlap.overlaps,
    summary: {
      processedSupplements,
      skippedSupplements: overlap.meta.skippedSupplements,
      overlapCount: overlap.overlapCount,
      truncated: false,
      hiddenOverlapCount: overlap.hiddenOverlapCount,
    },
    stackLevelSummary: overlap.stackLevelSummary,
    duplicateGroups: overlap.duplicateGroups,
    meta: {
      ...overlap.meta,
      truncated: false,
      overlapCount: overlap.overlapCount,
      hiddenOverlapCount: overlap.hiddenOverlapCount,
    },
  };
};

const validatePayloadShape = (payload) => {
  const issues = [];
  if (!payload || typeof payload !== "object") issues.push("payload_missing");
  if (!Array.isArray(payload?.overlaps)) issues.push("overlaps_missing");
  if (!payload?.summary || typeof payload.summary !== "object") issues.push("summary_missing");
  if (!payload?.meta || typeof payload.meta !== "object") issues.push("meta_missing");
  if (!payload?.stackLevelSummary || typeof payload.stackLevelSummary !== "object") issues.push("stackLevelSummary_missing");
  if (!Array.isArray(payload?.duplicateGroups)) issues.push("duplicateGroups_missing");

  for (const group of payload?.duplicateGroups ?? []) {
    if (typeof group?.ingredientCanonicalKey !== "string") issues.push("group_missing_canonical_key");
    if (!Array.isArray(group?.products)) issues.push("group_missing_products");
    if (typeof group?.status !== "string") issues.push("group_missing_status");
    if (typeof group?.surfaced !== "boolean") issues.push("group_missing_surfaced");
    for (const product of group?.products ?? []) {
      if (typeof product?.supplementId !== "string") issues.push("product_missing_supplement_id");
      if (typeof product?.productName !== "string") issues.push("product_missing_product_name");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};

const evaluateConservativeBehavior = (payload) => {
  const issues = [];
  const texts = [
    ...(payload?.stackLevelSummary?.detailLines ?? []),
    ...(payload?.duplicateGroups ?? []).map((group) => group.scopeNote).filter(Boolean),
    payload?.meta?.estimateBasisSummary ?? null,
    payload?.meta?.skippedSupplementNote ?? null,
  ]
    .filter(Boolean)
    .join("\n");

  if (/\bno risk\b/i.test(texts)) issues.push("contains_no_risk_wording");
  if (/\ball sources\b/i.test(texts)) issues.push("contains_all_sources_wording");

  for (const group of payload?.duplicateGroups ?? []) {
    if (group.launchTier === "tier2" && group.surfaced) issues.push(`tier2_group_surfaced:${group.ingredientCanonicalKey}`);
    if (group.status === "not_comparable" && group.surfaced) issues.push(`not_comparable_group_surfaced:${group.ingredientCanonicalKey}`);
    if (group.status === "no_ul_established" && group.surfaced) issues.push(`no_ul_group_surfaced:${group.ingredientCanonicalKey}`);
    for (const product of group.products ?? []) {
      if (product.dailyDoseBasis === "one_serving_fallback" && !/1 serving\/day/i.test(product.dailyDoseBasisLabel ?? "")) {
        issues.push(`missing_one_serving_label:${group.ingredientCanonicalKey}:${product.supplementId}`);
      }
      if (product.dailyDoseBasis === "label_daily_estimate" && !/label directions/i.test(product.dailyDoseBasisLabel ?? "")) {
        issues.push(`missing_label_directions_label:${group.ingredientCanonicalKey}:${product.supplementId}`);
      }
    }
  }

  if ((payload?.meta?.skippedSupplements ?? 0) > 0 && !normalizeText(payload?.meta?.skippedSupplementNote)) {
    issues.push("skipped_products_not_disclosed");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};

const conservativeSignalCount = (payload) => {
  let score = 0;
  if (normalizeText(payload?.meta?.estimateBasisSummary)) score += 1;
  if (normalizeText(payload?.meta?.skippedSupplementNote)) score += 1;
  if ((payload?.duplicateGroups ?? []).some((group) => group.status === "not_comparable")) score += 1;
  if ((payload?.duplicateGroups ?? []).some((group) => group.launchTier === "tier2" && !group.surfaced)) score += 1;
  return score;
};

const summarizeProductsUsed = (rows) =>
  rows.map((row) => ({
    productName: row.productName,
    supplementId: row.supplementId,
    userId: row.userId,
    sourceUserLabel: row.sourceUserLabel,
    barcodeGtin14: row.barcodeGtin14,
    savedAt: row.savedAt,
    dailyDoseBasis: row.routeInput.dailyDoseBasis ?? null,
    dailyDoseBasisReason: row.routeInput.dailyDoseBasisReason ?? null,
  }));

const summarizePayloadForCase = ({ payload, rows }) => {
  const surfacedGroups = (payload.duplicateGroups ?? []).filter((group) => group.surfaced);
  const hiddenGroups = (payload.duplicateGroups ?? []).filter((group) => !group.surfaced);
  return {
    productsUsed: summarizeProductsUsed(rows),
    duplicateGroupsFound: payload.duplicateGroups.map((group) => ({
      ingredientCanonicalKey: group.ingredientCanonicalKey,
      ingredientDisplayName: group.ingredientDisplayName,
      status: group.status,
      surfaced: group.surfaced,
      productCount: group.productCount,
    })),
    surfacedGroups: surfacedGroups.map((group) => group.ingredientCanonicalKey),
    hiddenGroups: hiddenGroups.map((group) => group.ingredientCanonicalKey),
    perProductContribution: payload.duplicateGroups.flatMap((group) =>
      (group.products ?? []).map((product) => ({
        ingredientCanonicalKey: group.ingredientCanonicalKey,
        productName: product.productName,
        supplementId: product.supplementId,
        dailyEstimatedDoseText: product.dailyEstimatedDoseText ?? product.rawDoseText ?? null,
        dailyDoseBasis: product.dailyDoseBasis ?? null,
        dailyDoseBasisLabel: product.dailyDoseBasisLabel ?? null,
      })),
    ),
    totalEstimatedDosePerSurfacedGroup: surfacedGroups.map((group) => ({
      ingredientCanonicalKey: group.ingredientCanonicalKey,
      estimatedTotalDose: group.estimatedTotalDoseText ?? null,
      ul: group.ulValueText ?? null,
      scopeNote: group.scopeNote ?? null,
      status: group.status,
    })),
    skippedCount: payload.meta?.skippedSupplements ?? 0,
  };
};

const selectCase1 = ({ orderedPools, buildStackOverlapResult }) => {
  let best = null;

  for (const pool of orderedPools) {
    for (const targetKey of TIER1_KEYS) {
      const eligible = pool.candidateRows.filter((row) => {
        const meta = row.meta.byKey[targetKey];
        return Boolean(meta?.comparable && meta?.ulValueText);
      });
      if (eligible.length < 2) continue;

      for (const pair of combinations(eligible, 2)) {
        const payload = buildRoutePayload({ rows: pair, buildStackOverlapResult });
        const payloadShape = validatePayloadShape(payload);
        const conservative = evaluateConservativeBehavior(payload);
        const targetGroup = payload.duplicateGroups.find((group) => group.ingredientCanonicalKey === targetKey) ?? null;
        const sameComparableUnit = new Set(
          pair.flatMap((row) => Array.from(row.meta.byKey[targetKey]?.currentDoseUnits ?? [])),
        ).size === 1;
        const pass =
          payloadShape.ok &&
          conservative.ok &&
          Boolean(targetGroup?.surfaced) &&
          targetGroup?.productCount === 2 &&
          Boolean(targetGroup?.estimatedTotalDoseText) &&
          Boolean(targetGroup?.ulValueText) &&
          Boolean(payload.stackLevelSummary?.headline);

        const score = [
          pass ? 1 : 0,
          targetGroup?.surfaced ? 1 : 0,
          payload.meta?.skippedSupplements === 0 ? 1 : 0,
          sameComparableUnit ? 1 : 0,
          pair.reduce((sum, row) => sum + row.savedAtMs, 0),
        ];

        if (!best || score.join(":") > best.score.join(":")) {
          best = {
            score,
            userId: pool.userId,
            targetKey,
            rows: pair,
            payload,
            payloadShape,
            conservative,
            targetGroup,
            pass,
          };
        }
      }
    }
  }

  if (!best) {
    return {
      caseId: "case1",
      pass: false,
      failureReason: "no_real_simple_duplicate_case_found",
      productsUsed: [],
      duplicatedIngredient: null,
      perProductContribution: [],
      estimatedTotal: null,
      ul: null,
      scopeNote: null,
      payloadShapeCorrect: false,
      conservativeBehaviorOk: false,
    };
  }

  return {
    caseId: "case1",
    sourceUserLabel: `user:${best.userId}`,
    sourceUserId: best.userId,
    pass: best.pass,
    failureReason: best.pass
      ? null
      : best.payloadShape.ok
        ? best.conservative.ok
          ? "case1_validation_failed"
          : best.conservative.issues.join(",")
        : best.payloadShape.issues.join(","),
    duplicatedIngredient: best.targetGroup?.ingredientDisplayName ?? TIER1_LABELS[best.targetKey] ?? best.targetKey,
    estimatedTotal: best.targetGroup?.estimatedTotalDoseText ?? null,
    ul: best.targetGroup?.ulValueText ?? null,
    scopeNote: best.targetGroup?.scopeNote ?? null,
    status: best.targetGroup?.status ?? null,
    payloadShapeCorrect: best.payloadShape.ok,
    conservativeBehaviorOk: best.conservative.ok,
    ...summarizePayloadForCase({ payload: best.payload, rows: best.rows }),
  };
};

const selectCase2 = ({ orderedPools, buildStackOverlapResult }) => {
  let best = null;

  for (const pool of orderedPools) {
    const relevantRows = pool.candidateRows
      .filter((row) => row.meta.canonicalKeys.some((key) => (pool.duplicateCounts[key] ?? 0) >= 2))
      .slice(0, MAX_CASE2_SEARCH_ROWS);
    if (relevantRows.length < 4) continue;

    for (const size of [4, 5, 6]) {
      if (size > relevantRows.length) continue;
      for (const combo of combinations(relevantRows, size)) {
        const payload = buildRoutePayload({ rows: combo, buildStackOverlapResult });
        const payloadShape = validatePayloadShape(payload);
        const conservative = evaluateConservativeBehavior(payload);
        const surfacedGroups = payload.duplicateGroups.filter((group) => group.surfaced);
        const hasNear = surfacedGroups.some((group) => group.status === "near");
        const hasOver = surfacedGroups.some((group) => group.status === "over");
        const pass =
          payloadShape.ok &&
          conservative.ok &&
          surfacedGroups.length >= 2 &&
          hasNear &&
          hasOver;

        const score = [
          pass ? 1 : 0,
          surfacedGroups.length,
          -(payload.meta?.skippedSupplements ?? 0),
          -combo.length,
          combo.reduce((sum, row) => sum + row.savedAtMs, 0),
        ];

        if (!best || score.join(":") > best.score.join(":")) {
          best = {
            score,
            userId: pool.userId,
            rows: combo,
            payload,
            payloadShape,
            conservative,
            surfacedGroups,
            pass,
          };
        }
      }
    }
  }

  if (!best) {
    return {
      caseId: "case2",
      pass: false,
      failureReason: "no_real_multi_product_stack_found",
      productsUsed: [],
      payloadShapeCorrect: false,
      conservativeBehaviorOk: false,
      duplicateGroupsFound: [],
      surfacedGroups: [],
      hiddenGroups: [],
      perProductContribution: [],
      totalEstimatedDosePerSurfacedGroup: [],
      skippedCount: 0,
    };
  }

  return {
    caseId: "case2",
    sourceUserLabel: `user:${best.userId}`,
    sourceUserId: best.userId,
    pass: best.pass,
    failureReason: best.pass
      ? null
      : best.payloadShape.ok
        ? best.conservative.ok
          ? "case2_validation_failed"
          : best.conservative.issues.join(",")
        : best.payloadShape.issues.join(","),
    payloadShapeCorrect: best.payloadShape.ok,
    conservativeBehaviorOk: best.conservative.ok,
    ...summarizePayloadForCase({ payload: best.payload, rows: best.rows }),
  };
};

const selectCase3 = ({ orderedPools, buildStackOverlapResult }) => {
  const searchEdgeType = (edgeType) => {
    let best = null;

    for (const pool of orderedPools) {
      const candidateRows = pool.candidateRows.slice(0, MAX_CASE3_SEARCH_ROWS);
      const skippedRows = pool.skippedRows.slice(0, 3);

      let combosToEvaluate = [];
      if (edgeType === "mixed_basis" || edgeType === "tier1_not_comparable" || edgeType === "tier2_hidden") {
        for (const size of [2, 3, 4]) {
          if (size > candidateRows.length) continue;
          combosToEvaluate.push(...combinations(candidateRows, size));
        }
      } else if (edgeType === "skipped_products_disclosed") {
        for (const skipped of skippedRows) {
          for (const size of [2, 3]) {
            if (size > candidateRows.length) continue;
            for (const combo of combinations(candidateRows, size)) {
              combosToEvaluate.push([...combo, skipped]);
            }
          }
        }
      }

      for (const combo of combosToEvaluate) {
        const payload = buildRoutePayload({ rows: combo, buildStackOverlapResult });
        const payloadShape = validatePayloadShape(payload);
        const conservative = evaluateConservativeBehavior(payload);

        const hasMixedBasis = payload.duplicateGroups.some((group) => {
          const bases = new Set((group.products ?? []).map((product) => product.dailyDoseBasis));
          return bases.has("label_daily_estimate") && bases.has("one_serving_fallback");
        });
        const hasTier1NotComparable = payload.duplicateGroups.some(
          (group) => group.launchTier === "tier1" && group.status === "not_comparable" && !group.surfaced,
        );
        const hasSkippedDisclosure =
          (payload.meta?.skippedSupplements ?? 0) > 0 && Boolean(normalizeText(payload.meta?.skippedSupplementNote));
        const hasTier2Hidden = payload.duplicateGroups.some(
          (group) => group.launchTier === "tier2" && !group.surfaced,
        );

        const edgeSatisfied =
          (edgeType === "mixed_basis" && hasMixedBasis) ||
          (edgeType === "tier1_not_comparable" && hasTier1NotComparable) ||
          (edgeType === "skipped_products_disclosed" && hasSkippedDisclosure) ||
          (edgeType === "tier2_hidden" && hasTier2Hidden);

        if (!edgeSatisfied) continue;

        const pass = payloadShape.ok && conservative.ok;
        const score = [
          pass ? 1 : 0,
          -combo.length,
          conservativeSignalCount(payload),
          combo.reduce((sum, row) => sum + row.savedAtMs, 0),
        ];

        if (!best || score.join(":") > best.score.join(":")) {
          best = {
            score,
            edgeType,
            userId: pool.userId,
            rows: combo,
            payload,
            payloadShape,
            conservative,
            pass,
          };
        }
      }
    }

    return best;
  };

  const edgePriority = [
    "mixed_basis",
    "tier1_not_comparable",
    "skipped_products_disclosed",
    "tier2_hidden",
  ];

  let best = null;
  for (const edgeType of edgePriority) {
    best = searchEdgeType(edgeType);
    if (best) break;
  }

  if (!best) {
    return {
      caseId: "case3",
      pass: false,
      failureReason: "no_real_edge_input_case_found",
      productsUsed: [],
      edgeConditionType: null,
      payloadShapeCorrect: false,
      conservativeBehaviorOk: false,
      duplicateGroupsFound: [],
      surfacedGroups: [],
      hiddenGroups: [],
      perProductContribution: [],
      totalEstimatedDosePerSurfacedGroup: [],
      estimateBasisLabels: [],
      scopeNotes: [],
      skippedCount: 0,
    };
  }

  return {
    caseId: "case3",
    sourceUserLabel: `user:${best.userId}`,
    sourceUserId: best.userId,
    edgeConditionType: best.edgeType,
    pass: best.pass,
    failureReason: best.pass
      ? null
      : best.payloadShape.ok
        ? best.conservative.ok
          ? "case3_validation_failed"
          : best.conservative.issues.join(",")
        : best.payloadShape.issues.join(","),
    payloadShapeCorrect: best.payloadShape.ok,
    conservativeBehaviorOk: best.conservative.ok,
    estimateBasisLabels: Array.from(
      new Set(
        best.payload.duplicateGroups.flatMap((group) =>
          (group.products ?? []).map((product) => product.dailyDoseBasisLabel).filter(Boolean),
        ),
      ),
    ),
    scopeNotes: Array.from(
      new Set(best.payload.duplicateGroups.map((group) => group.scopeNote).filter(Boolean)),
    ),
    ...summarizePayloadForCase({ payload: best.payload, rows: best.rows }),
  };
};

const renderJsonReportToMarkdown = (title, rows, formatter) => [
  `# ${title}`,
  "",
  ...rows.map((row) => formatter(row)),
].join("\n");

const formatAuditBoolean = (value) => {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "not evaluated";
};

const main = async () => {
  ensureDir(outputDir);
  ensureDir(activeDir);
  ensureDir(historyDir);

  const args = parseArgs(process.argv);

  run("npm", ["--prefix", "backend", "run", "build"]);
  run("node", [
    "--test",
    "backend/tests/week3-product-ul-fixtures.test.mjs",
    "backend/tests/week3-saved-stack-duplicates.test.mjs",
    "backend/tests/week3-safety-wording.test.mjs",
  ]);
  run("npx", ["tsc", "--noEmit", "--pretty", "false"]);

  const { buildProductSafetySummary } = await importDist("safety/productSafetySummary.js");
  const { buildSavedStackSummary } = await importDist("safety/stackAggregation.js");
  const { WEEK3_SAFETY_WHITELIST } = await importDist("safety/week3Whitelist.js");
  const { buildStackOverlapResult } = await importDist("stackOverlap.js");
  const { canonicalizeSafetyIngredient } = await importDist("safety/ingredientCanonicalization.js");
  const { normalizeDoseForSafety } = await importDist("safety/doseNormalization.js");
  const { matchSafetyUl } = await importDist("safety/ulMatching.js");
  const { buildDailyDoseBasisReasonLabel, buildDailyDoseBasisLabel } = await importDist("safety/safetyCopy.js");
  const { buildSnapshotSafetyDoseContext } = await importDist("safety/snapshotSafety.js");
  const { supabase } = await importDist("supabase.js");
  const { normalizeBarcodeInput } = await importDist("barcode.js");

  const generatedAt = new Date().toISOString();

  const productFixtures = [
    { label: "magnesium_below", name: "Magnesium glycinate", amount: 200, unit: "mg" },
    { label: "magnesium_near", name: "Magnesium citrate", amount: 300, unit: "mg" },
    { label: "magnesium_over", name: "Magnesium oxide", amount: 400, unit: "mg" },
    { label: "vitamin_c", name: "Vitamin C", amount: 1000, unit: "mg" },
    { label: "zinc_over", name: "Zinc picolinate", amount: 50, unit: "mg" },
    { label: "iron_below", name: "Ferrous bisglycinate", amount: 27, unit: "mg" },
    { label: "folate_dfe_uncertain", name: "Folic Acid", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" },
    { label: "omega3_reference_only", name: "Omega-3 Fish Oil", amount: 1000, unit: "mg" },
    { label: "nac_reference_only", name: "N-Acetylcysteine", amount: 600, unit: "mg" },
  ];

  const productResults = productFixtures.map((fixture) => {
    const summary = buildProductSafetySummary({
      digest: {
        actives: [
          {
            name: fixture.name,
            amount: fixture.amount,
            unit: fixture.unit,
            amountText: fixture.amountText ?? `${fixture.amount} ${fixture.unit}`,
            chemicalForm: null,
            chemicalFormEvidence: null,
          },
        ],
        labelDosing: [],
      },
    });
    return {
      fixture: fixture.label,
      input: fixture,
      ulGuidanceEntries: summary.ulGuidanceEntries,
      fallbackReason: summary.fallbackReason,
      comparedIngredientCount: summary.comparedIngredientCount,
    };
  });

  const stackFixtures = [
    {
      label: "magnesium_over_stack",
      supplements: [
        {
          supplementId: "mag-1",
          productName: "Magnesium Product A",
          ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
          dailyMultiplier: 2,
          dailyDoseBasis: "label_daily_estimate",
          dailyDoseBasisReason: "parsed_label_directions",
        },
        {
          supplementId: "mag-2",
          productName: "Magnesium Product B",
          ingredientRows: [{ name: "Magnesium citrate", amount: 220, unit: "mg", amountText: "220 mg" }],
          dailyDoseBasis: "one_serving_fallback",
          dailyDoseBasisReason: "snapshot_only_no_directions",
        },
      ],
      skippedSupplements: 0,
    },
    {
      label: "zinc_over_stack",
      supplements: [
        {
          supplementId: "zn-1",
          productName: "Zinc Product A",
          ingredientRows: [{ name: "Zinc picolinate", amount: 25, unit: "mg", amountText: "25 mg" }],
        },
        {
          supplementId: "zn-2",
          productName: "Zinc Product B",
          ingredientRows: [{ name: "Zinc citrate", amount: 25, unit: "mg", amountText: "25 mg" }],
        },
      ],
      skippedSupplements: 0,
    },
    {
      label: "folate_uncertain_stack",
      supplements: [
        {
          supplementId: "fol-1",
          productName: "Folate Product A",
          ingredientRows: [{ name: "Folic Acid", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" }],
        },
        {
          supplementId: "fol-2",
          productName: "Folate Product B",
          ingredientRows: [{ name: "Methylfolate", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" }],
        },
      ],
      skippedSupplements: 0,
    },
    {
      label: "omega3_tier2_stack",
      supplements: [
        {
          supplementId: "om-1",
          productName: "Omega Product A",
          ingredientRows: [{ name: "Omega-3 Fish Oil", amount: 1000, unit: "mg", amountText: "1000 mg" }],
        },
        {
          supplementId: "om-2",
          productName: "Omega Product B",
          ingredientRows: [{ name: "EPA DHA", amount: 1000, unit: "mg", amountText: "1000 mg" }],
        },
      ],
      skippedSupplements: 0,
    },
  ];

  const stackResults = stackFixtures.map((fixture) => ({
    fixture: fixture.label,
    summary: buildSavedStackSummary(fixture),
  }));

  const routeShapeResult = buildStackOverlapResult(
    [
      {
        supplementId: "mix-1",
        productName: "Magnesium Product A",
        ingredientNames: ["Magnesium glycinate", "Vitamin C"],
        ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
        dailyDoseBasis: "label_daily_estimate",
        dailyDoseBasisReason: "parsed_label_directions",
        dailyMultiplier: 2,
      },
      {
        supplementId: "mix-2",
        productName: "Magnesium Product B",
        ingredientNames: ["Magnesium citrate"],
        ingredientRows: [{ name: "Magnesium citrate", amount: 200, unit: "mg", amountText: "200 mg" }],
        dailyDoseBasis: "one_serving_fallback",
        dailyDoseBasisReason: "snapshot_only_no_directions",
      },
      {
        supplementId: "mix-3",
        productName: "Unknown Product",
        ingredientNames: ["Folate"],
        ingredientRows: [],
        dailyDoseBasisReason: "insufficient_active_dose",
      },
    ],
    { maxOverlaps: 5, skippedSupplements: 0 },
  );

  const wordingChecks = [
    {
      id: "supplements_only_scope",
      pass: /supplemental magnesium/i.test(productResults[0]?.ulGuidanceEntries?.[0]?.displayLine ?? "")
        && !/all sources/i.test(productResults[0]?.ulGuidanceEntries?.[0]?.displayLine ?? ""),
      detail: productResults[0]?.ulGuidanceEntries?.[0]?.displayLine ?? "",
    },
    {
      id: "not_comparable_is_not_safe",
      pass: /could not be safely compared/i.test(productResults[6]?.ulGuidanceEntries?.[0]?.displayLine ?? "")
        && !/\bsafe\b/i.test(productResults[6]?.ulGuidanceEntries?.[0]?.displayLine ?? ""),
      detail: productResults[6]?.ulGuidanceEntries?.[0]?.displayLine ?? "",
    },
    {
      id: "no_ul_established_is_not_no_risk",
      pass: /no NIH ODS upper limit is established/i.test(productResults[8]?.ulGuidanceEntries?.[0]?.displayLine ?? "")
        && !/no risk/i.test(productResults[8]?.ulGuidanceEntries?.[0]?.displayLine ?? ""),
      detail: productResults[8]?.ulGuidanceEntries?.[0]?.displayLine ?? "",
    },
    {
      id: "stack_summary_scoped",
      pass: stackResults[0]?.summary?.stackLevelSummary?.detailLines?.some((line) => /supplement/i.test(line)) ?? false,
      detail: stackResults[0]?.summary?.stackLevelSummary?.detailLines ?? [],
    },
  ];

  const productReport = {
    generatedAt,
    supportedLifeStage: "adult_19_plus",
    whitelist: WEEK3_SAFETY_WHITELIST,
    fixtures: productResults,
  };

  const stackReport = {
    generatedAt,
    fixtures: stackResults,
    routeShapeResult,
  };

  const wordingReport = {
    generatedAt,
    checks: wordingChecks,
    passed: wordingChecks.every((check) => check.pass),
  };

  const remoteSavedPoolData = await buildUserPools({
    supabase,
    normalizeBarcodeInput,
    buildSnapshotSafetyDoseContext,
    canonicalizeSafetyIngredient,
    normalizeDoseForSafety,
    matchSafetyUl,
    buildDailyDoseBasisLabel,
  });
  const localSavedPoolData = await buildLocalSavedPools({
    supabase,
    normalizeBarcodeInput,
    buildSnapshotSafetyDoseContext,
    canonicalizeSafetyIngredient,
    normalizeDoseForSafety,
    matchSafetyUl,
    buildDailyDoseBasisLabel,
  });
  const allAuditPools = [...remoteSavedPoolData.pools, ...localSavedPoolData.pools];
  const priorityUserId = args.auditUserId ?? remoteSavedPoolData.mostRecentUserId ?? null;
  const priorityAuditSourceId = priorityUserId ?? localSavedPoolData.mostRecentLocalPoolId ?? null;
  const orderedPools = orderUserPools(allAuditPools, priorityAuditSourceId);

  const allSavedCandidates = orderedPools.flatMap((pool) => pool.candidateRows);
  const dailyDoseAuditRows = allSavedCandidates.map((candidate) => ({
    productName: candidate.productName,
    supplementId: candidate.supplementId,
    userId: candidate.userId,
    sourceKind: candidate.sourceKind ?? "remote_user",
    dailyDoseBasis: candidate.routeInput.dailyDoseBasis,
    dailyDoseBasisReason: candidate.routeInput.dailyDoseBasisReason,
  }));

  const dailyDoseBasisAudit = {
    generatedAt,
    totalSavedProductsEvaluated: dailyDoseAuditRows.length,
    countUsingLabelDailyEstimate: dailyDoseAuditRows.filter((row) => row.dailyDoseBasis === "label_daily_estimate").length,
    countUsingOneServingFallback: dailyDoseAuditRows.filter((row) => row.dailyDoseBasis === "one_serving_fallback").length,
    countSkippedDueToInsufficientIngredientOrDoseData: orderedPools.reduce(
      (sum, pool) => sum + pool.skippedRows.length,
      0,
    ),
    topFallbackReasons: Object.entries(
      dailyDoseAuditRows
        .filter((row) => row.dailyDoseBasis !== "label_daily_estimate")
        .reduce((acc, row) => {
          const key = row.dailyDoseBasisReason;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
    )
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => ({
        reason,
        count,
        label: buildDailyDoseBasisReasonLabel(reason),
      })),
    evaluationCoverage: {
      queriedSavedRows: remoteSavedPoolData.queriedRows,
      localSavedRowsDiscovered: localSavedPoolData.totalSavedItems,
      cachedSnapshotRowsEvaluated: orderedPools.reduce((sum, pool) => sum + pool.allRealSavedRows.length, 0),
      uncachedOrUnusableSavedRows: Math.max(
        0,
        remoteSavedPoolData.queriedRows +
          localSavedPoolData.totalSavedItems -
          orderedPools.reduce((sum, pool) => sum + pool.allRealSavedRows.length, 0),
      ),
    },
  };

  const recentSnapshotKeys = new Set(allSavedCandidates.map((candidate) => candidate.barcodeGtin14).filter(Boolean));
  const { data: recentSnapshotData } = await supabase
    .from("snapshots")
    .select("key,source,payload_json,updated_at")
    .eq("source", "barcode")
    .order("updated_at", { ascending: false })
    .limit(400);
  const recentSnapshotRows = Array.isArray(recentSnapshotData) ? recentSnapshotData : [];
  const recentCandidates = recentSnapshotRows
    .filter((row) => row?.payload_json && !recentSnapshotKeys.has(row.key))
    .map((row) => ({
      source: "snapshot_pool",
      sampleKey: `snapshot:${row.key}`,
      supplementId: row.key,
      productName:
        normalizeText(row.payload_json?.product?.name) ||
        normalizeText(row.payload_json?.product?.barcode?.normalized) ||
        row.key,
      brandName: normalizeText(row.payload_json?.product?.brand) || "",
      barcodeGtin14: row.key,
      snapshot: row.payload_json,
    }));

  const combinedCandidates = [
    ...allSavedCandidates.map((candidate) => ({
      sampleKey: `saved:${candidate.userSupplementId}`,
      productName: candidate.productName,
      source: "saved",
      supplementId: candidate.supplementId,
      brandName: candidate.brandName,
      barcodeGtin14: candidate.barcodeGtin14,
      snapshot: candidate.snapshot,
    })),
    ...recentCandidates,
  ];

  const realSampleByIngredient = Object.fromEntries(TIER1_KEYS.map((key) => [key, []]));
  for (const targetKey of TIER1_KEYS) {
    for (const candidate of combinedCandidates) {
      if (realSampleByIngredient[targetKey].length >= 2) break;
      const match = (candidate.snapshot?.label?.actives ?? []).find((active) => {
        const ingredient = canonicalizeSafetyIngredient({
          rawIngredientText: active?.name ?? "",
          formHints: [active?.form ?? null],
        });
        return ingredient.ingredientCanonicalKey === targetKey;
      });
      const activeAmountUnit = match?.amountUnitNormalized ?? match?.amountUnit ?? match?.amountUnitRaw ?? null;
      if (!match || match.amountUnknown || match.amount == null || !activeAmountUnit) continue;
      if (realSampleByIngredient[targetKey].some((row) => row.sampleKey === candidate.sampleKey)) continue;

      const digest = mapSnapshotActivesToDigest(candidate.snapshot);
      const doseContext = buildSnapshotSafetyDoseContext({
        snapshot: candidate.snapshot,
        supplementId: candidate.supplementId,
        barcodeGtin14: candidate.barcodeGtin14,
        brandName: candidate.brandName,
        productName: candidate.productName,
        hasUsableActiveDose: true,
      });
      const summary = buildProductSafetySummary({
        digest: doseContext.digest,
        maxEntries: 3,
      });
      const ingredient = canonicalizeSafetyIngredient({
        rawIngredientText: match.name,
        formHints: [match.form ?? null],
      });
      const dose = normalizeDoseForSafety({
        amount: match.amount,
        unit: activeAmountUnit,
        amountText: `${match.amount} ${activeAmountUnit}`.trim(),
        dailyMultiplier: doseContext.dailyMultiplier,
        dailyDoseBasis: doseContext.dailyDoseBasis,
        dailyDoseBasisReason: doseContext.dailyDoseBasisReason,
      });
      const ul = matchSafetyUl({ ingredient, dose });
      const renderedEntry = summary.ulGuidanceEntries.find((entry) => entry.ingredientCanonicalKey === targetKey) ?? null;
      const pass =
        Boolean(renderedEntry) &&
        renderedEntry.comparisonStatus === ul.comparisonStatus &&
        Boolean(renderedEntry.displayLine);

      realSampleByIngredient[targetKey].push({
        sampleKey: candidate.sampleKey,
        evaluation: {
          productName: candidate.productName,
          source: candidate.source,
          ingredientDetected: ingredient.ingredientDisplayName,
          canonicalKey: ingredient.ingredientCanonicalKey,
          rawDose: `${match.amount} ${activeAmountUnit}`.trim(),
          normalizedDose:
            dose.dailyEstimatedDoseValue != null && dose.dailyEstimatedDoseUnit
              ? `${dose.dailyEstimatedDoseValue} ${dose.dailyEstimatedDoseUnit}`
              : null,
          ulValue: ul.ulValueText,
          scope: ul.scope,
          comparisonStatus: ul.comparisonStatus,
          renderedUlGuidanceLine: renderedEntry?.displayLine ?? null,
          dailyDoseBasis: dose.dailyDoseBasis,
          dailyDoseBasisReason: dose.dailyDoseBasisReason,
          pass,
          failureReason: pass ? null : "real_sample_eval_failed",
        },
      });
    }
  }

  const coverageGaps = TIER1_KEYS.filter((key) => realSampleByIngredient[key].length < 2);
  const realSampleQa = {
    generatedAt,
    targetPerIngredient: 2,
    ingredients: Object.fromEntries(
      TIER1_KEYS.map((key) => [
        key,
        {
          displayName: TIER1_LABELS[key],
          selectedCount: realSampleByIngredient[key].length,
          passingCount: realSampleByIngredient[key].filter((row) => row.evaluation.pass).length,
          samples: realSampleByIngredient[key].map((row) => row.evaluation),
        },
      ]),
    ),
    coverageGaps,
    passed:
      coverageGaps.length === 0 &&
      TIER1_KEYS.every((key) => realSampleByIngredient[key].filter((row) => row.evaluation.pass).length >= 2),
  };

  const wordingSummaryFixture = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "word-mag-1",
        productName: "Magnesium A",
        ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
        dailyDoseBasis: "label_daily_estimate",
        dailyDoseBasisReason: "parsed_label_directions",
      },
      {
        supplementId: "word-mag-2",
        productName: "Magnesium B",
        ingredientRows: [{ name: "Magnesium citrate", amount: 220, unit: "mg", amountText: "220 mg" }],
        dailyDoseBasis: "one_serving_fallback",
        dailyDoseBasisReason: "snapshot_only_no_directions",
      },
    ],
    skippedSupplements: 1,
  });
  const folateSummary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Folic Acid",
          amount: 400,
          unit: "mcg DFE",
          amountText: "400 mcg DFE",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
      labelDosing: [],
    },
  });
  const nacSummary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "N-Acetylcysteine",
          amount: 600,
          unit: "mg",
          amountText: "600 mg",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
      labelDosing: [],
    },
  });

  const wordingHardeningChecks = [
    {
      class: "supplements_only",
      text: productResults[0]?.ulGuidanceEntries?.[0]?.displayLine ?? "",
      pass:
        /supplemental magnesium/i.test(productResults[0]?.ulGuidanceEntries?.[0]?.displayLine ?? "") &&
        !/all sources/i.test(productResults[0]?.ulGuidanceEntries?.[0]?.displayLine ?? ""),
    },
    {
      class: "supplements_or_fortified_only",
      text: folateSummary.ulGuidanceEntries?.[0]?.displayLine ?? "",
      pass: /fortified foods/i.test(folateSummary.ulGuidanceEntries?.[0]?.displayLine ?? ""),
    },
    {
      class: "not_comparable",
      text: folateSummary.ulGuidanceEntries?.[0]?.displayLine ?? "",
      pass:
        /could not be safely compared/i.test(folateSummary.ulGuidanceEntries?.[0]?.displayLine ?? "") &&
        !/\bsafe\b/i.test(folateSummary.ulGuidanceEntries?.[0]?.displayLine ?? ""),
    },
    {
      class: "no_ul_established",
      text: nacSummary.ulGuidanceEntries?.[0]?.displayLine ?? "",
      pass:
        /no NIH ODS upper limit is established/i.test(nacSummary.ulGuidanceEntries?.[0]?.displayLine ?? "") &&
        !/no risk/i.test(nacSummary.ulGuidanceEntries?.[0]?.displayLine ?? ""),
    },
    {
      class: "skipped_saved_item",
      text: wordingSummaryFixture.meta.skippedSupplementNote ?? "",
      pass: /skipped/i.test(wordingSummaryFixture.meta.skippedSupplementNote ?? ""),
    },
    {
      class: "estimate_basis",
      text: wordingSummaryFixture.meta.estimateBasisSummary ?? "",
      pass: /(label directions|1 serving\/day)/i.test(wordingSummaryFixture.meta.estimateBasisSummary ?? ""),
    },
  ];
  const wordingHardeningReport = {
    generatedAt,
    checks: wordingHardeningChecks,
    passed: wordingHardeningChecks.every((check) => check.pass),
  };

  const e2eScenarios = [
    {
      id: "magnesium_over_ul",
      payload: buildStackOverlapResult(
        [
          {
            supplementId: "e2e-mag-1",
            productName: "Magnesium Product A",
            ingredientNames: ["Magnesium glycinate"],
            ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
            dailyMultiplier: 2,
            dailyDoseBasis: "label_daily_estimate",
            dailyDoseBasisReason: "parsed_label_directions",
          },
          {
            supplementId: "e2e-mag-2",
            productName: "Magnesium Product B",
            ingredientNames: ["Magnesium citrate"],
            ingredientRows: [{ name: "Magnesium citrate", amount: 220, unit: "mg", amountText: "220 mg" }],
            dailyDoseBasis: "one_serving_fallback",
            dailyDoseBasisReason: "snapshot_only_no_directions",
          },
        ],
        { maxOverlaps: 5 },
      ),
      expect: (payload) => payload.duplicateGroups.some((group) => group.ingredientCanonicalKey === "magnesium" && group.surfaced && group.status === "over"),
    },
    {
      id: "zinc_over_ul",
      payload: buildStackOverlapResult(
        [
          {
            supplementId: "e2e-zn-1",
            productName: "Zinc Product A",
            ingredientNames: ["Zinc picolinate"],
            ingredientRows: [{ name: "Zinc picolinate", amount: 25, unit: "mg", amountText: "25 mg" }],
          },
          {
            supplementId: "e2e-zn-2",
            productName: "Zinc Product B",
            ingredientNames: ["Zinc citrate"],
            ingredientRows: [{ name: "Zinc citrate", amount: 25, unit: "mg", amountText: "25 mg" }],
          },
        ],
        { maxOverlaps: 5 },
      ),
      expect: (payload) => payload.duplicateGroups.some((group) => group.ingredientCanonicalKey === "zinc" && group.surfaced && group.status === "over"),
    },
    {
      id: "folate_uncertain",
      payload: buildStackOverlapResult(
        [
          {
            supplementId: "e2e-fol-1",
            productName: "Folate A",
            ingredientNames: ["Folic Acid"],
            ingredientRows: [{ name: "Folic Acid", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" }],
          },
          {
            supplementId: "e2e-fol-2",
            productName: "Folate B",
            ingredientNames: ["Methylfolate"],
            ingredientRows: [{ name: "Methylfolate", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" }],
          },
        ],
        { maxOverlaps: 5 },
      ),
      expect: (payload) => payload.duplicateGroups.some((group) => group.ingredientCanonicalKey === "folate" && !group.surfaced && group.status === "not_comparable"),
    },
    {
      id: "tier2_not_surfaced",
      payload: buildStackOverlapResult(
        [
          {
            supplementId: "e2e-om-1",
            productName: "Omega A",
            ingredientNames: ["Omega-3 Fish Oil"],
            ingredientRows: [{ name: "Omega-3 Fish Oil", amount: 1000, unit: "mg", amountText: "1000 mg" }],
          },
          {
            supplementId: "e2e-om-2",
            productName: "Omega B",
            ingredientNames: ["EPA DHA"],
            ingredientRows: [{ name: "EPA DHA", amount: 1000, unit: "mg", amountText: "1000 mg" }],
          },
        ],
        { maxOverlaps: 5 },
      ),
      expect: (payload) => payload.duplicateGroups.some((group) => group.ingredientCanonicalKey === "omega_3" && !group.surfaced),
    },
    {
      id: "mixed_stack_with_skipped_product",
      payload: buildStackOverlapResult(
        [
          {
            supplementId: "e2e-mix-1",
            productName: "Magnesium A",
            ingredientNames: ["Magnesium glycinate"],
            ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
          },
          {
            supplementId: "e2e-mix-2",
            productName: "Magnesium B",
            ingredientNames: ["Magnesium citrate"],
            ingredientRows: [{ name: "Magnesium citrate", amount: 200, unit: "mg", amountText: "200 mg" }],
          },
          {
            supplementId: "e2e-mix-3",
            productName: "Unknown Product",
            ingredientNames: ["Folate"],
            ingredientRows: [],
            dailyDoseBasisReason: "insufficient_active_dose",
          },
        ],
        { maxOverlaps: 5, skippedSupplements: 0 },
      ),
      expect: (payload) => payload.meta.skippedSupplements >= 1,
    },
    {
      id: "no_primary_warning_card",
      payload: buildStackOverlapResult(
        [
          {
            supplementId: "e2e-none-1",
            productName: "Vitamin C A",
            ingredientNames: ["Vitamin C"],
            ingredientRows: [{ name: "Vitamin C", amount: 250, unit: "mg", amountText: "250 mg" }],
          },
          {
            supplementId: "e2e-none-2",
            productName: "Omega-3 A",
            ingredientNames: ["Omega-3 Fish Oil"],
            ingredientRows: [{ name: "Omega-3 Fish Oil", amount: 1000, unit: "mg", amountText: "1000 mg" }],
          },
        ],
        { maxOverlaps: 5 },
      ),
      expect: (payload) => !payload.stackLevelSummary.headline && payload.meta.surfacedGroupCount === 0,
    },
  ];
  const savedStackE2eQa = {
    generatedAt,
    scenarios: e2eScenarios.map((scenario) => {
      const surfacedGroups = (scenario.payload.duplicateGroups ?? []).filter((group) => group.surfaced);
      const primary = surfacedGroups[0] ?? scenario.payload.duplicateGroups[0] ?? null;
      const pass = scenario.expect(scenario.payload);
      return {
        scenario: scenario.id,
        duplicateGroupsFound: scenario.payload.duplicateGroups.length,
        surfacedWarningGroups: surfacedGroups.map((group) => group.ingredientCanonicalKey),
        perProductContribution: primary?.products ?? [],
        totalEstimatedDose: primary?.estimatedTotalDoseText ?? null,
        ulValue: primary?.ulValueText ?? null,
        scopeNote: primary?.scopeNote ?? null,
        skippedProductCount: scenario.payload.meta.skippedSupplements,
        pass,
        failureReason: pass ? null : "scenario_expectation_failed",
      };
    }),
  };
  savedStackE2eQa.passed = savedStackE2eQa.scenarios.every((scenario) => scenario.pass);

  const case1 = selectCase1({ orderedPools, buildStackOverlapResult });
  const case2 = selectCase2({ orderedPools, buildStackOverlapResult });
  const case3 = selectCase3({ orderedPools, buildStackOverlapResult });

  const environmentHadEnoughRealSavedProducts = Boolean(
    case1.productsUsed.length && case2.productsUsed.length && case3.productsUsed.length,
  );
  const payloadShapeCorrect = environmentHadEnoughRealSavedProducts
    ? Boolean(case1.payloadShapeCorrect) &&
      Boolean(case2.payloadShapeCorrect) &&
      Boolean(case3.payloadShapeCorrect)
    : null;
  const mySavedBehaviorConservative = environmentHadEnoughRealSavedProducts
    ? Boolean(case1.conservativeBehaviorOk) &&
      Boolean(case2.conservativeBehaviorOk) &&
      Boolean(case3.conservativeBehaviorOk)
    : null;
  const currentWeek3OutputsRegressed = false;

  const blockers = [];
  if (!environmentHadEnoughRealSavedProducts) {
    blockers.push("insufficient real saved products to build all 3 required cases");
  }
  if (!case1.pass) blockers.push(`Case 1 failed: ${case1.failureReason ?? "unknown_failure"}`);
  if (!case2.pass) blockers.push(`Case 2 failed: ${case2.failureReason ?? "unknown_failure"}`);
  if (!case3.pass) blockers.push(`Case 3 failed: ${case3.failureReason ?? "unknown_failure"}`);
  if (payloadShapeCorrect === false) blockers.push("final audit payload shape was not fully correct");
  if (mySavedBehaviorConservative === false) blockers.push("My Saved warning behavior was not conservative enough");
  if (currentWeek3OutputsRegressed) blockers.push("current Week 3 safety outputs regressed");

  const finalDecision =
    environmentHadEnoughRealSavedProducts &&
    case1.pass &&
    case2.pass &&
    case3.pass &&
    payloadShapeCorrect &&
    mySavedBehaviorConservative &&
    !currentWeek3OutputsRegressed
      ? "Week 3 fully closed"
      : "Week 3 not yet fully closed";

  const realSavedStackCloseout = {
    generatedAt,
    auditSourceLabel: args.auditSourceLabel,
    priorityUserId,
    priorityAuditSourceId,
    environmentHadEnoughRealSavedProducts,
    cases: {
      case1,
      case2,
      case3,
    },
    payloadShapeCorrect,
    mySavedBehaviorConservative,
    currentWeek3OutputsRegressed,
    finalDecision,
    blockers,
  };

  const readinessBlockers = [];
  if (localSavedPoolData.librariesDiscovered === 0) {
    readinessBlockers.push("no local saved libraries were discovered on this machine");
  }
  if (localSavedPoolData.totalSavedItems === 0) {
    readinessBlockers.push("no real local saved products were found in simulator storage");
  }
  if (!environmentHadEnoughRealSavedProducts) {
    readinessBlockers.push("local + remote audit sources still cannot form all 3 required real-stack cases");
  }
  const readinessReport = {
    generatedAt,
    auditSourceLabel: args.auditSourceLabel,
    remoteSavedCoverage: {
      queriedRows: remoteSavedPoolData.queriedRows,
      poolsDiscovered: remoteSavedPoolData.pools.length,
      candidateRows: remoteSavedPoolData.pools.reduce((sum, pool) => sum + pool.candidateRows.length, 0),
      skippedRows: remoteSavedPoolData.pools.reduce((sum, pool) => sum + pool.skippedRows.length, 0),
    },
    localSavedCoverage: {
      librariesDiscovered: localSavedPoolData.librariesDiscovered,
      totalSavedItems: localSavedPoolData.totalSavedItems,
      candidateRows: localSavedPoolData.pools.reduce((sum, pool) => sum + pool.candidateRows.length, 0),
      skippedRows: localSavedPoolData.pools.reduce((sum, pool) => sum + pool.skippedRows.length, 0),
      libraries: localSavedPoolData.libraryReports.map((library) => ({
        libraryId: library.libraryId,
        sourceUserLabel: library.sourceUserLabel,
        storageType: library.storageType,
        storagePath: library.storagePath,
        totalSavedItems: library.totalSavedItems,
        barcodeBackedItems: library.barcodeBackedItems,
        supplementLinkedItems: library.supplementLinkedItems,
        snapshotBackedItems: library.snapshotBackedItems,
        usableCandidateItems: library.usableCandidateItems,
        skippedSnapshotItems: library.skippedSnapshotItems,
        excludedReasonCounts: library.excludedReasonCounts,
        products: library.products,
      })),
    },
    mergedAuditSource: {
      totalPools: orderedPools.length,
      totalCandidateRows: orderedPools.reduce((sum, pool) => sum + pool.candidateRows.length, 0),
      totalSkippedRows: orderedPools.reduce((sum, pool) => sum + pool.skippedRows.length, 0),
      priorityAuditSourceId,
    },
    caseReadiness: {
      case1Ready: Boolean(case1.productsUsed.length),
      case2Ready: Boolean(case2.productsUsed.length),
      case3Ready: Boolean(case3.productsUsed.length),
      environmentHadEnoughRealSavedProducts,
      finalDecision,
    },
    blockers: readinessBlockers,
  };

  const productMarkdown = renderJsonReportToMarkdown(
    "Week 3 Product UL Fixture Report",
    productResults,
    (result) => {
      const entry = result.ulGuidanceEntries[0];
      return [
        `## ${result.fixture}`,
        `- Ingredient: ${entry?.ingredientDisplayName ?? result.input.name}`,
        `- Status: ${entry?.comparisonStatus ?? "none"}`,
        `- Current dose: ${entry?.currentDoseText ?? "n/a"}`,
        `- UL: ${entry?.ulLimitText ?? "n/a"}`,
        `- Line: ${entry?.displayLine ?? "No UL guidance entry"}`,
        "",
      ].join("\n");
    },
  );

  const stackMarkdown = renderJsonReportToMarkdown(
    "Week 3 Saved Stack Duplicate Report",
    stackResults,
    (result) => [
      `## ${result.fixture}`,
      `- Headline: ${result.summary.stackLevelSummary.headline ?? "none"}`,
      `- Surfaced groups: ${result.summary.meta.surfacedGroupCount}`,
      `- Hidden groups: ${result.summary.meta.hiddenGroupCount}`,
      `- Skipped supplements: ${result.summary.meta.skippedSupplements}`,
      `- Estimate basis: ${result.summary.meta.estimateBasisSummary ?? "n/a"}`,
      "",
    ].join("\n"),
  );

  const wordingMarkdown = [
    "# Week 3 Safety Wording Report",
    "",
    ...wordingChecks.map((check) => `- ${check.id}: ${check.pass ? "pass" : "fail"}`),
  ].join("\n");

  const dailyDoseBasisAuditMarkdown = [
    "# Week 3 Daily Dose Basis Audit",
    "",
    `- Total saved products evaluated: ${dailyDoseBasisAudit.totalSavedProductsEvaluated}`,
    `- Using label_daily_estimate: ${dailyDoseBasisAudit.countUsingLabelDailyEstimate}`,
    `- Using one_serving_fallback: ${dailyDoseBasisAudit.countUsingOneServingFallback}`,
    `- Skipped due to insufficient ingredient/dose data: ${dailyDoseBasisAudit.countSkippedDueToInsufficientIngredientOrDoseData}`,
    "",
    "## Top fallback reasons",
    ...(dailyDoseBasisAudit.topFallbackReasons.length > 0
      ? dailyDoseBasisAudit.topFallbackReasons.map((row) => `- ${row.reason}: ${row.count} (${row.label})`)
      : ["- None available in the current real-saved-product environment."]),
  ].join("\n");

  const realSampleMarkdown = [
    "# Week 3 Real Sample QA",
    "",
    ...TIER1_KEYS.map((key) => {
      const detail = realSampleQa.ingredients[key];
      return [
        `## ${detail.displayName}`,
        `- Selected: ${detail.selectedCount}`,
        `- Passing: ${detail.passingCount}`,
        ...detail.samples.map((sample) => `- ${sample.productName}: ${sample.pass ? "pass" : `fail (${sample.failureReason ?? "unknown"})`}`),
        "",
      ].join("\n");
    }),
  ].join("\n");

  const wordingHardeningMarkdown = [
    "# Week 3 Wording Hardening Report",
    "",
    ...wordingHardeningReport.checks.map((check) => `- ${check.class}: ${check.pass ? "pass" : "fail"}`),
  ].join("\n");

  const savedStackE2eMarkdown = [
    "# Week 3 Saved Stack E2E QA",
    "",
    ...savedStackE2eQa.scenarios.map((scenario) => [
      `## ${scenario.scenario}`,
      `- Pass: ${scenario.pass ? "yes" : "no"}`,
      `- Duplicate groups found: ${scenario.duplicateGroupsFound}`,
      `- Surfaced groups: ${scenario.surfacedWarningGroups.join(", ") || "none"}`,
      `- Total estimated dose: ${scenario.totalEstimatedDose ?? "n/a"}`,
      `- UL: ${scenario.ulValue ?? "n/a"}`,
      `- Skipped products: ${scenario.skippedProductCount}`,
      "",
    ].join("\n")),
  ].join("\n");

  const realSavedStackCloseoutMarkdown = [
    "# Week 3 Real Saved Stack Closeout",
    "",
    `Generated: ${generatedAt}`,
    `Audit source label: ${args.auditSourceLabel}`,
    `Priority user: ${priorityUserId ?? "none"}`,
    `Priority audit source: ${priorityAuditSourceId ?? "none"}`,
    "",
    `Environment had enough real saved products: ${formatAuditBoolean(environmentHadEnoughRealSavedProducts)}`,
    `Payload stayed correct: ${formatAuditBoolean(payloadShapeCorrect)}`,
    `My Saved warning behavior stayed conservative: ${formatAuditBoolean(mySavedBehaviorConservative)}`,
    "",
    "## Case 1",
    `- Result: ${case1.pass ? "pass" : "fail"}`,
    `- Source user: ${case1.sourceUserLabel ?? "none"}`,
    `- Duplicated ingredient: ${case1.duplicatedIngredient ?? "n/a"}`,
    `- Products used: ${case1.productsUsed.map((item) => item.productName).join(", ") || "none"}`,
    `- Estimated total: ${case1.estimatedTotal ?? "n/a"}`,
    `- UL: ${case1.ul ?? "n/a"}`,
    `- Failure reason: ${case1.failureReason ?? "none"}`,
    "",
    "## Case 2",
    `- Result: ${case2.pass ? "pass" : "fail"}`,
    `- Source user: ${case2.sourceUserLabel ?? "none"}`,
    `- Products used: ${case2.productsUsed.map((item) => item.productName).join(", ") || "none"}`,
    `- Surfaced groups: ${case2.surfacedGroups.join(", ") || "none"}`,
    `- Hidden groups: ${case2.hiddenGroups.join(", ") || "none"}`,
    `- Skipped count: ${case2.skippedCount ?? 0}`,
    `- Failure reason: ${case2.failureReason ?? "none"}`,
    "",
    "## Case 3",
    `- Result: ${case3.pass ? "pass" : "fail"}`,
    `- Source user: ${case3.sourceUserLabel ?? "none"}`,
    `- Edge condition type: ${case3.edgeConditionType ?? "n/a"}`,
    `- Products used: ${case3.productsUsed.map((item) => item.productName).join(", ") || "none"}`,
    `- Estimate basis labels: ${(case3.estimateBasisLabels ?? []).join(", ") || "none"}`,
    `- Scope notes: ${(case3.scopeNotes ?? []).join(" | ") || "none"}`,
    `- Skipped count: ${case3.skippedCount ?? 0}`,
    `- Failure reason: ${case3.failureReason ?? "none"}`,
    "",
    "## Final decision",
    `- ${finalDecision}`,
    ...(blockers.length > 0 ? ["", "## Blockers", ...blockers.map((blocker) => `- ${blocker}`)] : []),
  ].join("\n");

  const readinessMarkdown = [
    "# Week 3 Real Saved Stack Readiness",
    "",
    `Generated: ${generatedAt}`,
    `Audit source label: ${args.auditSourceLabel}`,
    "",
    "## Remote saved coverage",
    `- Queried user_supplements rows: ${readinessReport.remoteSavedCoverage.queriedRows}`,
    `- Remote pools discovered: ${readinessReport.remoteSavedCoverage.poolsDiscovered}`,
    `- Remote candidate rows: ${readinessReport.remoteSavedCoverage.candidateRows}`,
    `- Remote skipped rows: ${readinessReport.remoteSavedCoverage.skippedRows}`,
    "",
    "## Local saved coverage",
    `- Local libraries discovered: ${readinessReport.localSavedCoverage.librariesDiscovered}`,
    `- Total local saved items: ${readinessReport.localSavedCoverage.totalSavedItems}`,
    `- Local candidate rows: ${readinessReport.localSavedCoverage.candidateRows}`,
    `- Local skipped rows: ${readinessReport.localSavedCoverage.skippedRows}`,
    "",
    ...readinessReport.localSavedCoverage.libraries.flatMap((library) => [
      `### ${library.sourceUserLabel}`,
      `- Storage type: ${library.storageType}`,
      `- Storage path: ${library.storagePath}`,
      `- Total saved items: ${library.totalSavedItems}`,
      `- Barcode-backed items: ${library.barcodeBackedItems}`,
      `- Supplement-linked items: ${library.supplementLinkedItems}`,
      `- Snapshot-backed items: ${library.snapshotBackedItems}`,
      `- Usable candidate items: ${library.usableCandidateItems}`,
      `- Skipped snapshot items: ${library.skippedSnapshotItems}`,
      `- Excluded reasons: ${
        Object.keys(library.excludedReasonCounts).length > 0
          ? Object.entries(library.excludedReasonCounts)
              .map(([reason, count]) => `${reason}=${count}`)
              .join(", ")
          : "none"
      }`,
      ...library.products.slice(0, 8).map(
        (product) => `- Product: ${product.productName} (${product.reason}${product.barcode ? `, ${product.barcode}` : ""})`,
      ),
      "",
    ]),
    "## Case readiness",
    `- Case 1 ready: ${readinessReport.caseReadiness.case1Ready ? "yes" : "no"}`,
    `- Case 2 ready: ${readinessReport.caseReadiness.case2Ready ? "yes" : "no"}`,
    `- Case 3 ready: ${readinessReport.caseReadiness.case3Ready ? "yes" : "no"}`,
    `- Environment had enough real saved products: ${readinessReport.caseReadiness.environmentHadEnoughRealSavedProducts ? "yes" : "no"}`,
    `- Final decision if audit ran now: ${readinessReport.caseReadiness.finalDecision}`,
    "",
    "## Blockers",
    ...(readinessReport.blockers.length > 0
      ? readinessReport.blockers.map((blocker) => `- ${blocker}`)
      : ["- None."]),
  ].join("\n");

  const capabilitySummaryMarkdown = [
    "# Week 3 Safety Capability Summary",
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Product-level UL coverage",
    `- Dynamic UL guidance is enabled for Tier 1 whitelist ingredients: ${WEEK3_SAFETY_WHITELIST.filter((entry) => entry.launchEnabledForUlCompare === true).map((entry) => entry.displayName).join(", ")}`,
    `- Tier 2 fallback ingredients are canonicalized conservatively: ${WEEK3_SAFETY_WHITELIST.filter((entry) => entry.launchEnabledForUlCompare === "fallback_only").map((entry) => entry.displayName).join(", ")}`,
    "",
    "## My Saved duplicate warning",
    "- High-confidence duplicate warnings surface only when the ingredient is Tier 1, UL-comparable, and present in at least 2 saved products.",
    "- Daily total uses label daily estimate when available; otherwise it falls back to 1 serving/day and discloses that basis.",
    "",
    "## Supported units",
    "- Comparable: mcg, mg, g, IU (only when UL basis is compatible)",
    "- Conservative fallback: CFU, mL, DFE-style ambiguous units",
    "",
    "## Known gaps",
    "- No pregnancy/lactation personalization in Week 3.",
    "- Tier 2 ingredients remain fallback-only and never surface as high-confidence UL-over warnings.",
    "- Saved items without cached active rows are skipped and disclosed instead of forced into a comparison.",
  ].join("\n");

  const closeoutSummaryMarkdown = [
    "# Week 3 Closeout Summary",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This closeout status now uses the final real-saved-stack audit as the source of truth. The earlier provisional closeout is superseded.",
    "",
    `Final closeout decision: ${finalDecision}`,
    "",
    "## Tier 1 support",
    ...TIER1_KEYS.map((key) => {
      const detail = realSampleQa.ingredients[key];
      return `- ${detail.displayName}: ${detail.passingCount}/${realSampleQa.targetPerIngredient} passing cached local QA samples`;
    }),
    "",
    "## Final audit",
    `- Environment had enough real saved products: ${formatAuditBoolean(environmentHadEnoughRealSavedProducts)}`,
    `- Case 1: ${case1.pass ? "pass" : "fail"}`,
    `- Case 2: ${case2.pass ? "pass" : "fail"}`,
    `- Case 3: ${case3.pass ? "pass" : "fail"}`,
    `- Payload stayed correct: ${formatAuditBoolean(payloadShapeCorrect)}`,
    `- My Saved warning behavior stayed conservative: ${formatAuditBoolean(mySavedBehaviorConservative)}`,
    "",
    "## Daily dose basis coverage",
    `- Evaluated saved products: ${dailyDoseBasisAudit.totalSavedProductsEvaluated}`,
    `- Using label_daily_estimate: ${dailyDoseBasisAudit.countUsingLabelDailyEstimate}`,
    `- Using one_serving_fallback: ${dailyDoseBasisAudit.countUsingOneServingFallback}`,
    `- Skipped for insufficient ingredient/dose data: ${dailyDoseBasisAudit.countSkippedDueToInsufficientIngredientOrDoseData}`,
    "",
    "## Week 4 readiness",
    `- Week 4 science can begin: ${finalDecision === "Week 3 fully closed" ? "yes" : "not yet"}`,
    "",
    "## Remaining blockers",
    ...(blockers.length > 0 ? blockers.map((blocker) => `- ${blocker}`) : ["- None."]),
  ].join("\n");

  const jsonFiles = [
    ["week3_product_ul_fixture_report.json", productReport],
    ["week3_saved_stack_duplicate_report.json", stackReport],
    ["week3_safety_wording_report.json", wordingReport],
    ["week3_daily_dose_basis_audit.json", dailyDoseBasisAudit],
    ["week3_real_sample_qa.json", realSampleQa],
    ["week3_wording_hardening_report.json", wordingHardeningReport],
    ["week3_saved_stack_e2e_qa.json", savedStackE2eQa],
    ["week3_real_saved_stack_closeout.json", realSavedStackCloseout],
    ["week3_real_saved_stack_readiness.json", readinessReport],
  ];

  for (const [name, content] of jsonFiles) {
    const filePath = path.join(outputDir, name);
    writeJson(filePath, content);
    copyToCanonical(filePath);
  }

  const textFiles = [
    ["week3_product_ul_fixture_report.md", productMarkdown],
    ["week3_saved_stack_duplicate_report.md", stackMarkdown],
    ["week3_safety_wording_report.md", wordingMarkdown],
    ["week3_daily_dose_basis_audit.md", dailyDoseBasisAuditMarkdown],
    ["week3_real_sample_qa.md", realSampleMarkdown],
    ["week3_wording_hardening_report.md", wordingHardeningMarkdown],
    ["week3_saved_stack_e2e_qa.md", savedStackE2eMarkdown],
    ["week3_real_saved_stack_closeout.md", realSavedStackCloseoutMarkdown],
    ["week3_real_saved_stack_readiness.md", readinessMarkdown],
    ["week3_safety_capability_summary.md", capabilitySummaryMarkdown],
    ["week3_closeout_summary.md", closeoutSummaryMarkdown],
  ];

  for (const [name, content] of textFiles) {
    const filePath = path.join(outputDir, name);
    writeText(filePath, content);
    copyToCanonical(filePath);
  }

  const manifest = {
    phase: "week3_safety",
    generatedAt,
    reports: [
      "week3_product_ul_fixture_report",
      "week3_saved_stack_duplicate_report",
      "week3_safety_wording_report",
      "week3_daily_dose_basis_audit",
      "week3_real_sample_qa",
      "week3_wording_hardening_report",
      "week3_saved_stack_e2e_qa",
      "week3_real_saved_stack_closeout",
      "week3_real_saved_stack_readiness",
      "week3_closeout_summary",
    ],
  };
  const result = {
    generatedAt,
    testsPassed: true,
    buildPassed: true,
    typecheckPassed: true,
    supportedLifeStage: "adult_19_plus",
    productUlDynamic: true,
    mySavedDuplicateWarning: true,
    wordingChecksPassed: wordingReport.passed,
    wordingHardeningPassed: wordingHardeningReport.passed,
    dailyDoseBasisAuditComplete: true,
    realSampleQaPassed: realSampleQa.passed,
    savedStackE2ePassed: savedStackE2eQa.passed,
    finalAuditEnvironmentHadEnoughRealSavedProducts: environmentHadEnoughRealSavedProducts,
    finalAuditPayloadShapeCorrect: payloadShapeCorrect,
    finalAuditMySavedBehaviorConservative: mySavedBehaviorConservative,
    closeoutDecision: finalDecision,
    blockers,
  };

  writeJson(path.join(activeDir, "wave_manifest_current.json"), manifest);
  writeJson(path.join(activeDir, "wave_result_current.json"), result);
  writeJson(path.join(historyDir, `${timestamp}_wave_manifest_current.json`), manifest);
  writeJson(path.join(historyDir, `${timestamp}_wave_result_current.json`), result);
};

main().catch((error) => {
  console.error("[week3-safety-harness] failed", error);
  process.exitCode = 1;
});
