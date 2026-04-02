import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeText } from "./iherb-overlay-utils.mjs";
import { runMacosVisionOcr } from "./macos-vision-ocr.mjs";

const ROOT = process.cwd();
const READER_PREFIX = "https://r.jina.ai/http://";
const MAX_PDF_URLS = 2;
const MAX_OCR_IMAGES = 3;
const PDF_TEXT_CACHE = new Map();
const ENRICHMENT_PYTHON = path.join(ROOT, "scripts", "maintainer", "python", ".venv_enrichment", "bin", "python");
const PDF_WORKER_PYTHON = process.env.PDF_FACTS_PYTHON_BIN || (fs.existsSync(ENRICHMENT_PYTHON) ? ENRICHMENT_PYTHON : "python3");
const PDF_WORKER_PATH = path.join(ROOT, "scripts", "maintainer", "python", "pdf_text_worker.py");

const toArray = (value) => (Array.isArray(value) ? value : []);

const normalizeUrl = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes("{width}")) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("//")) return `https:${text}`;
  return null;
};

const uniqueStrings = (values) => {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalizeUrl(value) ?? normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

const normalizeDailyValue = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^(?:\d+%|\*+|daily value not established\.?)$/i.test(text)) return text;
  return null;
};

const normalizeAmount = (value) => {
  const text = normalizeText(value)
    .replace(/\bAFU'S\b/gi, "AFU")
    .replace(/\bAFUS\b/gi, "AFU")
    .replace(/\bCFU'S\b/gi, "CFU");
  return text || null;
};

const parseAmountLine = (line) => {
  const normalized = normalizeText(line);
  if (!normalized) return null;
  const match = normalized.match(
    /(\d[\d,.]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|afu|ml|mL|billion|million)\b(?:\s*(?:\*+|[#]))?/i,
  );
  if (!match) return null;
  return normalizeAmount(`${match[1]} ${match[2]}`);
};

const parseSupplementFactsFromText = (text) => {
  const normalized = String(text ?? "").replace(/\r/g, "");
  let blockMatch = normalized.match(
    /(?:Supplement|Nutrition) Facts([\s\S]*?)(?=\n(?:Other Ingredients|Directions|Suggested Use|Recommended Use|Warning|Warnings|Caution|Store(?: in a cool)?|KEEP OUT OF REACH|Distributed by|Ingredients:?)\b|$)/i,
  );
  if (!blockMatch && /Serving Size[:\s]/i.test(normalized) && /Amount Per Serving/i.test(normalized)) {
    blockMatch = normalized.match(
      /Serving Size[:\s][\s\S]*?(?=\n(?:Other Ingredients|Directions|Suggested Use|Recommended Use|Warning|Warnings|Caution|Store(?: in a cool)?|KEEP OUT OF REACH|Distributed by|Ingredients:?)\b|$)/i,
    );
    if (blockMatch) {
      blockMatch = [blockMatch[0], blockMatch[0]];
    }
  }
  if (!blockMatch) return null;

  const block = blockMatch[1];
  const rawLines = block
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const findLabeledValue = (label) => {
    for (let index = 0; index < rawLines.length; index += 1) {
      const line = rawLines[index];
      if (label === "servingSize" && /^Serving Size\b/i.test(line)) {
        const inline = normalizeText(line.replace(/^Serving Size[:\s]*/i, ""));
        if (inline) return inline;
        return normalizeText(rawLines[index + 1] ?? null) || null;
      }
      if (label === "servingsPerContainer") {
        const trailing = line.match(/^Servings?\s+Per\s+Container[:\s]+(.+)$/i);
        if (trailing?.[1]) return normalizeText(trailing[1]);
        const leading = line.match(/^(.+?)\s+Servings?\s+Per\s+Container$/i);
        if (leading?.[1]) return normalizeText(leading[1]);
        if (/^Servings?\s+Per\s+Container$/i.test(line)) {
          return normalizeText(rawLines[index + 1] ?? null) || null;
        }
      }
    }
    return null;
  };

  const servingSize = findLabeledValue("servingSize");
  const servingsPerContainer = findLabeledValue("servingsPerContainer");
  const facts = [];
  const seen = new Set();
  const shouldSkipFact = (name, amount) => {
    const normalizedName = normalizeText(name).toLowerCase();
    const normalizedAmount = normalizeText(amount).toLowerCase();
    return (
      !normalizedName ||
      normalizedName === "**" ||
      normalizedName === "includes" ||
      /daily values? are based on/i.test(normalizedName) ||
      /daily value \(dv\) not established/i.test(normalizedName) ||
      (/calorie/.test(normalizedAmount) && /percent|daily value/.test(normalizedName))
    );
  };

  const registerFact = (substancy, amountPerServing, dailyValuePercent = null) => {
    const name = normalizeText(substancy);
    const amount = normalizeAmount(amountPerServing);
    const dailyValue = normalizeDailyValue(dailyValuePercent);
    if (!name || !amount || shouldSkipFact(name, amount)) return;
    const key = `${name.toLowerCase()}||${amount.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      substancy: name,
      amountPerServing: amount,
      dailyValuePercent: dailyValue,
    });
  };

  for (const line of rawLines) {
    const inlineMatch = line.match(
      /^(.{2,140}?)\s+(\d[\d,.]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|afu|ml|mL|billion|million)\b(?:\s+(.+))?$/i,
    );
    if (inlineMatch) {
      registerFact(inlineMatch[1], `${inlineMatch[2]} ${inlineMatch[3]}`, inlineMatch[4] ?? null);
    }
  }

  const cleanedLines = rawLines.filter(
    (line) =>
      !/^(?:Supplement|Nutrition) Facts$/i.test(line) &&
      !/^Serving Size\b/i.test(line) &&
      !/^Servings?\s+Per\s+Container\b/i.test(line) &&
      !/^Amount(?:\s+Per\s+Serving)?$/i.test(line) &&
      !/^One Capsule Contains$/i.test(line) &&
      !/^% ?DV$/i.test(line) &&
      !/^% ?Daily Value/i.test(line) &&
      !/^Daily Value not established\.?$/i.test(line),
  );

  for (let index = 0; index < cleanedLines.length; index += 1) {
    const line = cleanedLines[index];
    const nextLine = cleanedLines[index + 1] ?? "";
    const thirdLine = cleanedLines[index + 2] ?? "";
    if (!line || parseAmountLine(line)) continue;

    const nextAmount = parseAmountLine(nextLine);
    if (nextAmount) {
      registerFact(line, nextAmount, thirdLine);
      continue;
    }

    const currentInline = line.match(
      /^(.{2,140}?)\s+(\d[\d,.]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|afu|ml|mL|billion|million)\b(?:\s+(.+))?$/i,
    );
    if (currentInline) {
      registerFact(currentInline[1], `${currentInline[2]} ${currentInline[3]}`, currentInline[4] ?? null);
    }
  }

  if (!servingSize && !servingsPerContainer && facts.length === 0) return null;
  return {
    servingSize,
    servingsPerContainer,
    nutritionalFacts: facts,
  };
};

const fetchTextViaReader = async (targetUrl) => {
  const normalizedUrl = normalizeUrl(targetUrl);
  if (!normalizedUrl) return null;
  if (!PDF_TEXT_CACHE.has(normalizedUrl)) {
    PDF_TEXT_CACHE.set(
      normalizedUrl,
      (async () => {
        const response = await fetch(`${READER_PREFIX}${normalizedUrl}`, {
          headers: {
            Accept: "text/plain, text/markdown;q=0.9, */*;q=0.8",
            "User-Agent": "Mozilla/5.0",
          },
        });
        if (!response.ok) {
          throw new Error(`reader_fetch_failed:${response.status}`);
        }
        return response.text();
      })(),
    );
  }
  return PDF_TEXT_CACHE.get(normalizedUrl);
};

const extractPdfTextViaTempFile = (targetUrl) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      PDF_WORKER_PYTHON,
      [PDF_WORKER_PATH],
      {
        maxBuffer: 1024 * 1024 * 16,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `pdf_text_worker_failed: ${error.message}${stderr ? `\n${stderr}` : ""}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(
            new Error(
              `pdf_text_worker_invalid_json: ${parseError instanceof Error ? parseError.message : String(parseError)}${stderr ? `\n${stderr}` : ""}`,
            ),
          );
        }
      },
    );
    child.stdin.write(JSON.stringify({ url: targetUrl }));
    child.stdin.end();
  });

const removeMissingFactsWarning = (warnings) =>
  toArray(warnings).filter((warning) => normalizeText(warning).toLowerCase() !== "missing_supplement_facts_rows");

const recoverFactsFromPdfUrls = async (pdfUrls) => {
  for (const pdfUrl of uniqueStrings(pdfUrls).slice(0, MAX_PDF_URLS)) {
    try {
      const payload = await extractPdfTextViaTempFile(pdfUrl);
      const parsed = parseSupplementFactsFromText(payload?.text ?? "");
      if (parsed?.nutritionalFacts?.length || parsed?.servingSize || parsed?.servingsPerContainer) {
        return {
          supplementFacts: parsed,
          source: "pdf_temp_docling",
          evidenceUrl: pdfUrl,
          tempFileDeleted: Boolean(payload?.tempFileDeleted),
          pdfDownloadMode: payload?.downloadMode ?? null,
        };
      }
    } catch {
      // Best-effort recovery only.
    }
    try {
      const text = await fetchTextViaReader(pdfUrl);
      const parsed = parseSupplementFactsFromText(text);
      if (parsed?.nutritionalFacts?.length || parsed?.servingSize || parsed?.servingsPerContainer) {
        return {
          supplementFacts: parsed,
          source: "pdf_reader",
          evidenceUrl: pdfUrl,
          tempFileDeleted: true,
          pdfDownloadMode: "reader_fallback",
        };
      }
    } catch {
      // Best-effort recovery only.
    }
  }
  return null;
};

const recoverFactsFromImages = async (imageUrls) => {
  for (const imageUrl of uniqueStrings(imageUrls).slice(0, MAX_OCR_IMAGES)) {
    try {
      const payload = await runMacosVisionOcr(imageUrl);
      const parsed = parseSupplementFactsFromText(payload?.fullText ?? "");
      if (parsed?.nutritionalFacts?.length || parsed?.servingSize || parsed?.servingsPerContainer) {
        return {
          supplementFacts: parsed,
          source: "image_ocr",
          evidenceUrl: imageUrl,
        };
      }
    } catch {
      // Best-effort recovery only.
    }
  }
  return null;
};

export const applySupplementFactsFallbacks = async (raw) => {
  if (!raw?.ok) return raw;

  const artifacts =
    raw?.supplementFactsArtifacts && typeof raw.supplementFactsArtifacts === "object"
      ? { ...raw.supplementFactsArtifacts }
      : {};
  const existingRows = toArray(raw?.supplementFactsRows);
  if (existingRows.length > 0) {
    return {
      ...raw,
      extractionWarnings: removeMissingFactsWarning(raw?.extractionWarnings),
    };
  }

  const pdfUrls = uniqueStrings(artifacts?.pdfUrls ?? []);
  const imageUrls = uniqueStrings(artifacts?.imageUrls ?? []);
  let recovered = null;

  if (pdfUrls.length > 0) {
    recovered = await recoverFactsFromPdfUrls(pdfUrls);
  }
  if (!recovered && imageUrls.length > 0) {
    recovered = await recoverFactsFromImages(imageUrls);
  }
  if (!recovered) return raw;

  return {
    ...raw,
    servingSize: recovered.supplementFacts?.servingSize ?? raw?.servingSize ?? null,
    servingsPerContainer: recovered.supplementFacts?.servingsPerContainer ?? raw?.servingsPerContainer ?? null,
    supplementFactsRows: toArray(recovered.supplementFacts?.nutritionalFacts),
    supplementFactsSource: recovered.source,
    supplementFactsArtifacts: {
      ...artifacts,
      evidenceUrl: recovered.evidenceUrl,
      recoverySource: recovered.source,
      pdfTempFileDeleted: recovered.tempFileDeleted ?? null,
      pdfDownloadMode: recovered.pdfDownloadMode ?? null,
      pdfUrls,
      imageUrls,
    },
    extractionWarnings: removeMissingFactsWarning(raw?.extractionWarnings),
  };
};
