import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DASHBOARD_FILE = path.join(process.cwd(), "components/scan/AnalysisDashboard.tsx");
const source = fs.readFileSync(DASHBOARD_FILE, "utf8");

const findIndex = (input: string, token: string | RegExp, from = 0): number => {
  if (typeof token === "string") {
    return input.indexOf(token, from);
  }
  const rest = input.slice(from);
  const local = rest.search(token);
  return local < 0 ? -1 : from + local;
};

const readBetween = (input: string, startToken: string | RegExp, endToken: string | RegExp): string => {
  const start = findIndex(input, startToken);
  assert.ok(start >= 0, `missing token: ${String(startToken)}`);
  const end = findIndex(input, endToken, start + 1);
  assert.ok(end > start, `missing token after ${String(startToken)}: ${String(endToken)}`);
  return input.slice(start, end);
};

test("above-the-fold overview and science tiles prefer authoritative decision-support content", () => {
  assert.match(source, /const authoritativeOverviewTileSummary = useMemo(?:<[^>]+>)?\(\(\) => \{/);
  assert.match(source, /const authoritativeOverviewTileBullets = useMemo(?:<[^>]+>)?\(\(\) => \{/);
  assert.match(source, /const authoritativeScienceTileMechanisms = useMemo(?:<[^>]+>)?\(\(\) => \{/);

  const tilesSlice = readBetween(
    source,
    "const tiles: TileConfig[] = [",
    "const selectedTile = useMemo(",
  );

  assert.ok(tilesSlice.includes("summary: authoritativeOverviewTileSummary"));
  assert.ok(tilesSlice.includes("bullets: authoritativeOverviewTileBullets"));
  assert.ok(tilesSlice.includes("mechanisms: authoritativeScienceTileMechanisms"));
  assert.equal(tilesSlice.includes("summary: { text: overviewSummaryText }"), false);
  assert.equal(tilesSlice.includes("bullets: overviewBullets"), false);
  assert.equal(tilesSlice.includes("mechanisms: ingredientMechanisms"), false);
});

test("authoritative-first tiles use neutral placeholders instead of old cover copy before ready", () => {
  const overviewSelectorSlice = readBetween(
    source,
    /const authoritativeOverviewTileSummary = useMemo(?:<[^>]+>)?\(\(\) => \{/,
    /const productOverviewAiRequestPayload = useMemo(?:<[\s\S]*?>)?\(/,
  );

  assert.ok(overviewSelectorSlice.includes("Latest verified product details are loading."));
  assert.ok(overviewSelectorSlice.includes("Loading verified product facts."));
  assert.ok(overviewSelectorSlice.includes("Open the card to review the latest details."));
  assert.ok(overviewSelectorSlice.includes("Verified ingredient details loading"));
  assert.ok(overviewSelectorSlice.includes("Latest per-serving amounts"));
});

test("telemetry reflects the authoritative cover content that is actually shown", () => {
  const telemetrySlice = readBetween(
    source,
    "const usedCategorySpecificRanking = useMemo(() => {",
    "const overlayConsumerFieldHitCount =",
  );

  assert.ok(telemetrySlice.includes("const topNames = authoritativeScienceTileMechanisms"));
  assert.ok(telemetrySlice.includes("authoritativeOverviewTileSummary.text"));
  assert.ok(telemetrySlice.includes("...authoritativeOverviewTileBullets.map((item) => item.text)"));
  assert.equal(telemetrySlice.includes("const topNames = ingredientMechanisms"), false);
  assert.equal(telemetrySlice.includes("overviewSummaryText"), false);
  assert.equal(telemetrySlice.includes("...overviewBullets.map((item) => item.text)"), false);
});
