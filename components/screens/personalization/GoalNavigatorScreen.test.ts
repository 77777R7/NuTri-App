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

test("profile personalization surface exposes steering, stack audit, and goal navigator entry", () => {
  const profilePath = path.resolve(process.cwd(), "components/screens/ProfileScreen.tsx");
  const profileSource = fs.readFileSync(profilePath, "utf8");
  const mySupplementPath = path.resolve(process.cwd(), "components/screens/MySupplement.tsx");
  const mySupplementSource = fs.readFileSync(mySupplementPath, "utf8");

  assert.match(profileSource, /CritiqueChipBar/);
  assert.match(profileSource, /GoalNavigatorEntryCard/);
  assert.match(profileSource, /StackAuditCard/);
  assert.match(profileSource, /buildPersonalizationControlEvents/);
  assert.match(profileSource, /pathname:\s*'\/main\/goal-navigator'/);

  assert.doesNotMatch(mySupplementSource, /CritiqueChipBar/);
  assert.doesNotMatch(mySupplementSource, /Explore best fits for/);
  assert.doesNotMatch(mySupplementSource, /StackAuditCard/);
});

test("goal navigator and stack audit expose bundle metadata surfaces", () => {
  const contextCardPath = path.resolve(
    process.cwd(),
    "components/screens/personalization/GoalNavigatorContextCard.tsx",
  );
  const contextCardSource = fs.readFileSync(contextCardPath, "utf8");
  const profilePath = path.resolve(process.cwd(), "components/screens/ProfileScreen.tsx");
  const profileSource = fs.readFileSync(profilePath, "utf8");
  const stackAuditPath = path.resolve(
    process.cwd(),
    "components/screens/personalization/StackAuditCard.tsx",
  );
  const stackAuditSource = fs.readFileSync(stackAuditPath, "utf8");

  assert.match(contextCardSource, /Why these are forward/);
  assert.match(contextCardSource, /Diet review bundle/);
  assert.match(contextCardSource, /Activity modifier/);
  assert.match(stackAuditSource, /Bundle steering/);
  assert.match(profileSource, /dietLanes=\{snapshot\.strategies\.dietLanes\}/);
  assert.match(profileSource, /activityPlan=\{snapshot\.strategies\.activityPlan\}/);
});
