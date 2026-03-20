import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("goal navigator screen reuses deterministic fit surfaces and catalog route", () => {
  const screenPath = path.resolve(
    process.cwd(),
    "components/screens/personalization/GoalNavigatorScreen.tsx",
  );
  const source = fs.readFileSync(screenPath, "utf8");

  assert.match(source, /fetchGoalNavigator\(/);
  assert.match(source, /GoalFitScorecard/);
  assert.match(source, /CompareSheet/);
  assert.match(source, /CritiqueChipBar/);
  assert.match(source, /GoalNavigatorContextCard/);
  assert.match(source, /buildGoalCompareEntries/);
  assert.match(source, /addSupplement/);
});

test("my saved surface exposes a goal navigator entry point", () => {
  const filePath = path.resolve(process.cwd(), "components/screens/MySupplement.tsx");
  const source = fs.readFileSync(filePath, "utf8");

  assert.match(source, /Explore best fits for/);
  assert.match(source, /router\.push\(\{\s*pathname:\s*"\/main\/goal-navigator"/);
});

test("goal navigator and stack audit expose bundle metadata surfaces", () => {
  const contextCardPath = path.resolve(
    process.cwd(),
    "components/screens/personalization/GoalNavigatorContextCard.tsx",
  );
  const contextCardSource = fs.readFileSync(contextCardPath, "utf8");
  const mySupplementPath = path.resolve(process.cwd(), "components/screens/MySupplement.tsx");
  const mySupplementSource = fs.readFileSync(mySupplementPath, "utf8");
  const stackAuditPath = path.resolve(
    process.cwd(),
    "components/screens/personalization/StackAuditCard.tsx",
  );
  const stackAuditSource = fs.readFileSync(stackAuditPath, "utf8");

  assert.match(contextCardSource, /Why these are forward/);
  assert.match(contextCardSource, /Diet review bundle/);
  assert.match(contextCardSource, /Activity modifier/);
  assert.match(stackAuditSource, /Bundle steering/);
  assert.match(mySupplementSource, /dietLanes=\{snapshot\.strategies\.dietLanes\}/);
  assert.match(mySupplementSource, /activityPlan=\{snapshot\.strategies\.activityPlan\}/);
});
