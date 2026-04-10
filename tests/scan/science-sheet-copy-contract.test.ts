import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DASHBOARD_FILE = path.join(process.cwd(), "components/scan/AnalysisDashboard.tsx");

const source = fs.readFileSync(DASHBOARD_FILE, "utf8");

test("science sheet uses fixed factual card plus B/C card titles", () => {
  assert.ok(source.includes('title="What this product provides"'));
  assert.ok(source.includes('title="Ingredient overview"'));
  assert.ok(source.includes('title="Scientific background"'));
  assert.ok(source.includes('Choose an ingredient for scientific background'));
  assert.equal(source.includes('title="What this supplement may help support"'), false);
  assert.equal(source.includes('title="Balanced overview"'), false);
});

test("science factual card stays grounded to decision-support ingredient rows", () => {
  assert.ok(source.includes("const decisionScienceIngredientRows = useMemo<ScienceSidecarIngredientRow[]>("));
  assert.ok(source.includes("decisionScienceBlock?.ingredientRows ?? []"));
  assert.ok(source.includes("decisionScienceIngredientRows.map((item, idx) => ("));
  assert.ok(source.includes("<Text style={styles.kvLabel}>Chemical Form</Text>"));
  assert.ok(source.includes("<Text style={styles.kvLabel}>Delivery Type</Text>"));
  assert.equal(source.includes("Possible chemical form (low confidence):"), false);
  assert.equal(source.includes("What this chemical form may change"), false);
});

test("science sheet removes branded iHerb provenance copy", () => {
  assert.equal(source.includes("iHerb snapshot"), false);
  assert.equal(source.includes("Product snapshot"), false);
  assert.equal(source.includes("Form from supplemental label data (iHerb):"), false);
  assert.equal(source.includes("Dosage form from supplemental label data (iHerb):"), false);
});
