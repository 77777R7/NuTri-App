import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildAnalysisTopSectionPresentation } from '../../lib/scan/analysisTopSectionPresentation';

const TOP_SECTION_PATH = path.join(process.cwd(), 'components/scan/AnalysisTopSectionRedesign.tsx');
const DASHBOARD_PATH = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const topSectionSource = fs.readFileSync(TOP_SECTION_PATH, 'utf8');
const dashboardSource = fs.readFileSync(DASHBOARD_PATH, 'utf8');

test('missing goal and allergy settings render the two coached personalization spots', () => {
  const presentation = buildAnalysisTopSectionPresentation({
    goal: {},
    personalInsight: {
      supportLabels: [],
      hasSavedGoals: false,
    },
    allergy: {
      hasSavedPreferences: false,
      matchedLabels: [],
      evidenceTexts: [],
    },
    dose: {},
    safety: {},
  });

  const goalRow = presentation.insights.find((row) => row.key === 'personal_support');
  assert.equal(goalRow?.collapsedTitle, 'Goal fit');
  assert.equal(goalRow?.subtitle, 'Add your goal to see how this supplement fits your needs.');
  assert.equal(goalRow?.coachSpot, 'goal_fit');

  const allergyRow = presentation.insights.find((row) => row.key === 'allergy_insight');
  assert.equal(allergyRow?.collapsedTitle, 'Allergy check');
  assert.equal(
    allergyRow?.subtitle,
    'Add your allergies to see if any ingredients may not be right for you.',
  );
  assert.equal(allergyRow?.coachSpot, 'allergy_check');
});

test('the scan result coach dims the page, highlights both rows, and dismisses on tap', () => {
  assert.match(topSectionSource, /showPersonalizationCoach/);
  assert.match(topSectionSource, /personalizationCoachPageScrim/);
  assert.match(topSectionSource, /personalizationCoachSpotRow/);
  assert.match(topSectionSource, /personalizationCoachTapLayer/);
  assert.match(topSectionSource, /onPersonalizationCoachLayout/);
  assert.match(dashboardSource, /scrollContainerRef/);
  assert.match(dashboardSource, /scrollTo\?\.\(\{ y: targetY, animated: true \}\)/);
  assert.match(topSectionSource, /setPersonalizationCoachDismissed\(true\)/);
  assert.match(topSectionSource, /fit for your goal/);
  assert.match(topSectionSource, /anything you should avoid/);
  assert.match(topSectionSource, /Your answers are applied here/);
  assert.match(topSectionSource, /personalizationCoachMode\?: "applied" \| "hidden" \| null/);
  assert.match(topSectionSource, /\(isAppliedCoach \|\| !lockedPreview\)/);
  assert.match(dashboardSource, /const findGoalCoverageByLabel/);
  assert.match(dashboardSource, /const lowerFirst/);
  assert.match(dashboardSource, /const isOmegaAggregateLine = isOmega3TotalLineName\(displayName\);/);
  assert.match(dashboardSource, /const isOmega3AggregateLineName = isOmega3TotalLineName/);
});
