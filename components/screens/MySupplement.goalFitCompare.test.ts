import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("my supplement detail sheet keeps goal-fit research UI behind the research gate", () => {
  const filePath = path.resolve(process.cwd(), "components/screens/MySupplement.tsx");
  const source = fs.readFileSync(filePath, "utf8");
  const scorecardPath = path.resolve(
    process.cwd(),
    "components/screens/my-supplement/GoalFitScorecard.tsx",
  );
  const scorecardSource = fs.readFileSync(scorecardPath, "utf8");

  assert.match(source, /GoalFitScorecard/);
  assert.match(source, /CompareSheet/);
  assert.match(source, /PERSONALIZATION_RESEARCH_UI_ENABLED && goalFitCard/);
  assert.match(source, /if \(!PERSONALIZATION_RESEARCH_UI_ENABLED \|\| !goalFitCard\) return;/);
  assert.match(source, /buildGoalFitCard/);
  assert.match(source, /buildGoalCompareEntries/);
  assert.match(source, /selectedGoalKey=\{detailGoalKey\}/);
  assert.match(source, /savedProductEvaluation=\{detailSavedProductEvaluation\}/);
  assert.match(source, /compareEntries=\{detailCompareEntries\}/);
  assert.match(source, /tintColor=\{theme\.glassTint\}/);
  assert.match(source, /compareEnabled=\{compareEntryList.length > 1\}/);
  assert.match(source, /Object\.values\(snapshot\.evaluations\.savedProductEvaluations \?\? \{\}\)/);
  assert.match(source, /goalFitDetailTrackedKeyRef/);
  assert.match(scorecardSource, /Why this fits/);
  assert.match(scorecardSource, /See differences/);
  assert.match(scorecardSource, /See full reasoning/);
  assert.match(scorecardSource, /Show less/);
  assert.match(scorecardSource, /detailsVisible/);
  assert.match(scorecardSource, /label="Label"/);
  assert.match(scorecardSource, /label="Overlap"/);
});

test("compare sheet highlights differences and avoids internal-only fit language", () => {
  const filePath = path.resolve(process.cwd(), "components/screens/my-supplement/CompareSheet.tsx");
  const source = fs.readFileSync(filePath, "utf8");

  assert.match(source, /buildKeyDifferences/);
  assert.match(source, /Why it is not stronger/);
  assert.match(source, /See differences/);
  assert.match(source, /What changes between these picks for/);
  assert.match(source, /biggest differences/);
  assert.match(source, /See full reasoning/);
  assert.match(source, /What may need a closer look/);
  assert.doesNotMatch(source, /Holdbacks/);
});
