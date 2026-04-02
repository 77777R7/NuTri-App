import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("goal navigator screen still keeps the research flow available behind deterministic surfaces", () => {
  const screenPath = path.resolve(
    process.cwd(),
    "components/screens/personalization/GoalNavigatorScreen.tsx",
  );
  const source = fs.readFileSync(screenPath, "utf8");

  assert.match(source, /fetchGoalNavigator\(/);
  assert.match(source, /GoalFitScorecard/);
  assert.match(source, /CompareSheet/);
  assert.match(source, /RefinePicksDrawer/);
  assert.match(source, /GoalNavigatorContextCard/);
  assert.match(source, /buildGoalCompareEntries/);
  assert.match(source, /addSupplement/);
});

test("production pages gate research personalization UI behind a default-off flag", () => {
  const profilePath = path.resolve(process.cwd(), "components/screens/ProfileScreen.tsx");
  const profileSource = fs.readFileSync(profilePath, "utf8");
  const homePath = path.resolve(process.cwd(), "app/main/Home-Page.tsx");
  const homeSource = fs.readFileSync(homePath, "utf8");
  const routePath = path.resolve(process.cwd(), "app/main/goal-navigator.tsx");
  const routeSource = fs.readFileSync(routePath, "utf8");
  const flagPath = path.resolve(process.cwd(), "lib/personalization/researchFlags.ts");
  const flagSource = fs.readFileSync(flagPath, "utf8");

  assert.match(flagSource, /EXPO_PUBLIC_PERSONALIZATION_RESEARCH_UI_ENABLED/);
  assert.match(flagSource, /Default off so research UI never leaks into the normal production lane/);
  assert.match(profileSource, /PERSONALIZATION_RESEARCH_UI_ENABLED \?/);
  assert.match(profileSource, /BestFitsPreviewCard/);
  assert.match(profileSource, /SupportModeCard/);
  assert.match(profileSource, /RefinePicksDrawer/);
  assert.match(profileSource, /StackAuditCard/);
  assert.match(profileSource, /if \(!PERSONALIZATION_RESEARCH_UI_ENABLED \|\| !goalNavigatorSeedGoal\)/);
  assert.match(routeSource, /if \(!PERSONALIZATION_RESEARCH_UI_ENABLED\)/);
  assert.match(routeSource, /<Redirect href="\/main" \/>/);
  assert.doesNotMatch(homeSource, /SupportModeCard/);
  assert.doesNotMatch(homeSource, /buildHomeSupportSurface/);
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
  assert.match(stackAuditSource, /Why these picks\?/);
  assert.match(stackAuditSource, /See details/);
  assert.match(stackAuditSource, /Still forward/);
  assert.match(profileSource, /dietLanes=\{snapshot\.strategies\.dietLanes\}/);
  assert.match(profileSource, /activityPlan=\{snapshot\.strategies\.activityPlan\}/);
});
