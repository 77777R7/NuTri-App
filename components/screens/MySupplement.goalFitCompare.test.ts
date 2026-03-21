import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("my supplement detail sheet wires deterministic goal-fit scorecard and compare sheet", () => {
  const filePath = path.resolve(process.cwd(), "components/screens/MySupplement.tsx");
  const source = fs.readFileSync(filePath, "utf8");

  assert.match(source, /GoalFitScorecard/);
  assert.match(source, /CompareSheet/);
  assert.match(source, /buildGoalFitCard/);
  assert.match(source, /buildGoalCompareEntries/);
  assert.match(source, /selectedGoalKey=\{detailGoalKey\}/);
  assert.match(source, /savedProductEvaluation=\{detailSavedProductEvaluation\}/);
  assert.match(source, /compareEntries=\{detailCompareEntries\}/);
  assert.match(source, /tintColor=\{theme\.glassTint\}/);
  assert.match(source, /compareEnabled=\{compareEntryList.length > 1\}/);
  assert.match(source, /Object\.values\(snapshot\.evaluations\.savedProductEvaluations \?\? \{\}\)/);
});

test("compare sheet highlights differences and avoids internal-only fit language", () => {
  const filePath = path.resolve(process.cwd(), "components/screens/my-supplement/CompareSheet.tsx");
  const source = fs.readFileSync(filePath, "utf8");

  assert.match(source, /buildKeyDifferences/);
  assert.match(source, /Why it is not stronger/);
  assert.match(source, /Goal evidence/);
  assert.match(source, /Where these options differ for/);
});
