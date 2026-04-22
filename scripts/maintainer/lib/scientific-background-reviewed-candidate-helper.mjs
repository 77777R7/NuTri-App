import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_EVIDENCE_PATH = path.join(
  ROOT,
  "backend",
  "data",
  "reviewed",
  "scientific-background-evidence.v1.json",
);

const PRIORITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const normalizeList = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export async function loadScientificBackgroundCandidateRegistry({
  evidencePath = DEFAULT_EVIDENCE_PATH,
} = {}) {
  const raw = await fs.readFile(evidencePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.candidate_pubmed_searches) ? parsed.candidate_pubmed_searches : [];
}

export function selectScientificBackgroundReviewSeeds({
  registry,
  priorities = ["P0"],
  families = null,
  maxPerEntry = 3,
} = {}) {
  const prioritySet = new Set(normalizeList(priorities) ?? ["P0"]);
  const familySet = families ? new Set(normalizeList(families) ?? []) : null;

  return [...(Array.isArray(registry) ? registry : [])]
    .filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const priority = String(entry.priority ?? "P9").trim();
      if (!prioritySet.has(priority)) return false;
      if (familySet && !familySet.has(String(entry.family ?? "").trim())) return false;
      return Array.isArray(entry.candidates) && entry.candidates.length > 0;
    })
    .sort((left, right) => {
      const leftPriority = PRIORITY_ORDER[String(left.priority ?? "P9")] ?? 99;
      const rightPriority = PRIORITY_ORDER[String(right.priority ?? "P9")] ?? 99;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const familyCompare = String(left.family ?? "").localeCompare(String(right.family ?? ""));
      if (familyCompare !== 0) return familyCompare;
      const laneCompare = String(left.lane ?? "").localeCompare(String(right.lane ?? ""));
      if (laneCompare !== 0) return laneCompare;
      return String(left.variant_key ?? "").localeCompare(String(right.variant_key ?? ""));
    })
    .map((entry) => ({
      ingredientFamily: entry.family ?? null,
      sectionKey: entry.lane ?? null,
      variantKey: entry.variant_key ?? null,
      priority: entry.priority ?? null,
      selectionNotes: Array.isArray(entry.selection_notes)
        ? entry.selection_notes.map((note) => String(note))
        : [],
      candidateCount: Array.isArray(entry.candidates) ? entry.candidates.length : 0,
      seedReferences: (Array.isArray(entry.candidates) ? entry.candidates : [])
        .slice(0, Math.max(1, Number(maxPerEntry) || 3))
        .map((candidate) => ({
          pmid: candidate?.pmid ?? null,
          title: candidate?.title ?? null,
          pubdate: candidate?.pubdate ?? null,
          pubtype: Array.isArray(candidate?.pubtype) ? candidate.pubtype : [],
          url: candidate?.url ?? null,
        })),
    }));
}

export function getScientificBackgroundCandidateHelperDefaults() {
  return {
    evidencePath: DEFAULT_EVIDENCE_PATH,
    priorityOrder: Object.keys(PRIORITY_ORDER),
  };
}
