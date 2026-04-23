import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ScientificCandidateReviewInput,
  ScientificCandidateReviewResult,
  VerifiedPmid,
} from "../../src/staging/nutriMinimalV4.js";
import { getNutriMinimalDefinitionForFamily } from "../../src/nutriMinimalFullFamilyProductization.js";

const DEFAULT_PLUGIN_ROOT = path.join(
  os.homedir(),
  ".codex",
  "plugins",
  "cache",
  "openai-curated",
  "life-science-research",
);
const DEFAULT_SCRIPT_RELATIVE_PATH = path.join(
  "skills",
  "ncbi-entrez-skill",
  "scripts",
  "ncbi_entrez.py",
);

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isValidPubmedId = (value: string): boolean =>
  /^[1-9][0-9]{0,8}$/.test(value);

const dedupePmids = (values: string[]): string[] =>
  Array.from(new Set(values.filter(isValidPubmedId)));

const parseJsonLine = (text: string): Record<string, unknown> => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (!candidate.startsWith("{")) continue;
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  throw new Error("[lsr] Could not parse ncbi-entrez JSON output.");
};

export const resolveNcbiEntrezScriptPath = async (): Promise<string> => {
  const explicit = normalizeText(
    process.env.LIFE_SCIENCE_RESEARCH_NCBI_ENTREZ_PATH,
  );
  if (explicit) return explicit;

  const direct = path.join(DEFAULT_PLUGIN_ROOT, DEFAULT_SCRIPT_RELATIVE_PATH);
  if (existsSync(direct)) return direct;

  const candidates = await readdir(DEFAULT_PLUGIN_ROOT, {
    withFileTypes: true,
  });
  for (const entry of candidates) {
    if (!entry.isDirectory()) continue;
    const nextPath = path.join(
      DEFAULT_PLUGIN_ROOT,
      entry.name,
      DEFAULT_SCRIPT_RELATIVE_PATH,
    );
    if (existsSync(nextPath)) return nextPath;
  }

  throw new Error(
    "[lsr] Could not resolve Life Science Research ncbi-entrez skill path.",
  );
};

const runNcbiEntrez = async (
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const scriptPath = await resolveNcbiEntrezScriptPath();
  const pythonExecutable =
    normalizeText(process.env.LIFE_SCIENCE_RESEARCH_PYTHON) ?? "python3";
  const timeoutMs = Number(
    process.env.LIFE_SCIENCE_RESEARCH_TIMEOUT_MS ?? 20000,
  );

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const child = spawn(pythonExecutable, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const result = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`[lsr] ncbi-entrez timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          const parsed = parseJsonLine(
            `${Buffer.concat(stderrChunks).toString("utf8")}\n${Buffer.concat(stdoutChunks).toString("utf8")}`,
          );
          if (parsed.ok !== true) {
            const error = parsed.error as
              | { code?: string; message?: string }
              | undefined;
            reject(
              new Error(
                `[lsr] ncbi-entrez request failed: ${error?.code ?? "unknown"} ${error?.message ?? "unknown"}`,
              ),
            );
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });

      child.stdin.write(JSON.stringify(request));
      child.stdin.end();
    },
  );

  return result;
};

export const searchPubmedIds = async (
  query: string,
  retmax = 5,
): Promise<string[]> => {
  const response = await runNcbiEntrez({
    endpoint: "esearch",
    params: {
      db: "pubmed",
      term: query,
      retmode: "json",
      retmax: String(retmax),
      sort: "relevance",
    },
    max_items: retmax,
    max_depth: 4,
  });
  const directRecords = Array.isArray(response.records) ? response.records : [];
  if (directRecords.length > 0) {
    return directRecords
      .map((value) => String(value ?? "").trim())
      .filter(isValidPubmedId);
  }
  const summary = response.summary as Record<string, unknown> | undefined;
  const searchResult = summary?.eSearchResult as
    | Record<string, unknown>
    | undefined;
  const idList = searchResult?.IdList as { Id?: unknown } | undefined;
  const ids = Array.isArray(idList?.Id) ? idList?.Id : [];
  return ids.map((value) => String(value ?? "").trim()).filter(isValidPubmedId);
};

export const summarizePubmedIds = async (
  pmids: string[],
): Promise<VerifiedPmid[]> => {
  const uniquePmids = dedupePmids(pmids).slice(0, 10);
  if (!uniquePmids.length) return [];

  const response = await runNcbiEntrez({
    endpoint: "esummary",
    params: {
      db: "pubmed",
      id: uniquePmids.join(","),
      retmode: "json",
    },
    record_path: "result",
    max_items: Math.max(50, uniquePmids.length * 10),
    max_depth: 4,
  });

  const summary = response.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== "object") return [];
  const uids = Array.isArray(summary.uids)
    ? summary.uids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : uniquePmids;

  return uids
    .map((pmid) => {
      const row = summary[pmid] as Record<string, unknown> | undefined;
      if (!row || typeof row !== "object") return null;
      return {
        pmid,
        title: normalizeText(row.title),
        pubdate: normalizeText(row.pubdate),
        pubtype: Array.isArray(row.pubtype)
          ? row.pubtype
              .map((value) => String(value ?? "").trim())
              .filter(Boolean)
          : [],
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      } satisfies VerifiedPmid;
    })
    .filter((row): row is VerifiedPmid => Boolean(row));
};

const extractSeedPmids = (input: ScientificCandidateReviewInput): string[] =>
  input.row.seed_citations
    .filter((citation) => citation.seed_kind === "pmid")
    .map((citation) => {
      const identifier = normalizeText(citation.identifier) ?? "";
      const explicitPmid = identifier.match(
        /\bPMID\s*:?\s*([1-9][0-9]{3,8})\b/i,
      );
      if (explicitPmid?.[1]) return explicitPmid[1];
      return /^[1-9][0-9]{3,8}$/.test(identifier) ? identifier : "";
    })
    .filter(isValidPubmedId);

const normalizeForRelevance = (value: string | null | undefined): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const titleMatchesFamily = (
  row: VerifiedPmid,
  family: string,
): boolean => {
  const title = normalizeForRelevance(row.title);
  if (!title) return false;
  const definition = getNutriMinimalDefinitionForFamily(family);
  const rawTerms = definition
    ? [
        definition.displayName,
        definition.sourceIngredientId.replace(/_/g, " "),
        definition.canonicalFamily.replace(/_/g, " "),
        ...definition.patternKeywords,
      ]
    : [family.replace(/_/g, " ")];
  const terms = Array.from(
    new Set(
      rawTerms
        .map(normalizeForRelevance)
        .filter((term) => term.length >= 3 && term !== "extract"),
    ),
  );
  return terms.some((term) => title.includes(term));
};

const filterFamilyRelevantRows = (
  rows: VerifiedPmid[],
  family: string,
): VerifiedPmid[] => rows.filter((row) => titleMatchesFamily(row, family));

export const reviewScientificCandidateWithNcbiEntrez = async (
  input: ScientificCandidateReviewInput,
): Promise<ScientificCandidateReviewResult> => {
  const seedPmids = extractSeedPmids(input);
  const verifiedPmids = filterFamilyRelevantRows(
    await summarizePubmedIds(seedPmids),
    input.row.family,
  );
  const knownPmids = new Set(verifiedPmids.map((row) => row.pmid));

  const query = input.row.query;
  if (!query) {
    return {
      query_used: null,
      verified_pmids: verifiedPmids,
    };
  }

  const remaining = Math.max(0, 5 - verifiedPmids.length);
  if (remaining === 0) {
    return {
      query_used: query,
      verified_pmids: verifiedPmids.slice(0, 5),
    };
  }

  const searchedIds = await searchPubmedIds(query, Math.max(remaining * 2, 5));
  const freshIds = searchedIds.filter((pmid) => !knownPmids.has(pmid));
  const searchedSummaries = filterFamilyRelevantRows(
    await summarizePubmedIds(freshIds),
    input.row.family,
  );

  return {
    query_used: query,
    verified_pmids: [...verifiedPmids, ...searchedSummaries].slice(0, 5),
  };
};
