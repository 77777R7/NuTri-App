# Onboarding Scan-First Handoff Design

**Date:** 2026-04-16  
**Status:** Proposed and user-approved in chat  
**Owner:** Codex + Howard

## Goal

Increase first real-use conversion by reshaping the `plan-preview -> first-stack -> scan` handoff so the user feels understood and is pushed into one clear first action: scanning their first supplement.

## Product Outcome

This round is not about making onboarding feel more animated or more informational. It is about increasing the share of users who move from the end of onboarding into their first real product action.

The desired emotional sequence is:

1. "NuTri understood what I told it."
2. "NuTri already figured out the easiest first move."
3. "I want to do that now."

## North Star

Primary success target: **higher first real-use conversion**.

This specifically means better conversion from:

- `plan-preview` -> `first-stack`
- `first-stack` -> `scan`
- onboarding completion -> first meaningful scan/start action

## Current Problem

The current flow has real wiring into personalization, but the user does not strongly feel that in the final onboarding handoff.

Observed product problem:

- `first-stack` still behaves too much like a choice page
- emotional momentum is weak after `plan-preview`
- the page asks the user to decide how to start instead of confidently suggesting the first move
- the strongest visible linkage today is still mostly `goals` and `allergy`, even though more onboarding inputs are already wired into personalization

This creates a psychological pause exactly where the product should be creating momentum.

## Current Wiring We Are Building On

The flow already has useful foundations:

- onboarding answers feed the personalization snapshot
- `first-stack` already reads personalized data such as goals, schedule template, and evaluated item count
- onboarding completion already routes users into `scan`, `search`, or `home`

This design intentionally builds on those existing links rather than introducing a new personalization engine.

## Design Decision

Adopt a **Scan-first Hero** handoff.

`first-stack` should stop behaving like a three-way branching selector and instead become the final momentum page of onboarding:

- prove that the recommendation is based on the user's inputs
- strongly recommend one first action
- keep alternatives available, but visually subordinate

## Core Design Principles

1. **One strong path**
   The page should present a single obvious next step: scan first.

2. **Personalization as proof, not as branching logic**
   Existing onboarding inputs should be used to justify the recommendation, not to create a complex choose-your-own-path decision model.

3. **Momentum over explanation**
   The page should reduce hesitation, not add more reading burden.

4. **Retain user control without splitting attention**
   Secondary paths can stay, but they must no longer compete with the main action.

## Proposed Flow

### Before

`plan-preview`  
-> user sees plan language  
-> `first-stack` asks how they want to start  
-> user chooses `scan` / `search` / `later`  
-> user presses `Finish setup`

### After

`plan-preview`  
-> user sees personalized setup summary  
-> `first-stack` confirms "this is based on you"  
-> page presents one clear hero CTA: `Scan my first supplement`  
-> tap immediately routes into scan

Secondary exits remain available:

- `Search instead`
- `Do this later`

But they are no longer equal peers of the main action.

## First-Stack Page Role

The page should no longer function primarily as a settings decision page.

Its new role is:

1. confirm that NuTri remembers what matters to the user
2. translate that into one concrete first move
3. convert setup completion into real usage

This is the last onboarding page, but psychologically it should feel like the first page of actual product use.

## Information Hierarchy

The page should read top-to-bottom in this order:

1. **Personalized conclusion**
   A direct statement that the best first move is to scan.

2. **Short evidence block**
   Two or three lightweight proof points based on the user's onboarding choices.

3. **Single primary CTA**
   `Scan my first supplement`

4. **Secondary alternatives**
   `Search instead` and `Do this later`

This sequence should create the mental progression:

"This is based on me"  
-> "I understand why"  
-> "The first step is already decided"  
-> "I'll do it now"

## CTA Structure

### Primary

- Label should be action-forward, not setup-forward
- Preferred copy:
  - `Scan my first supplement`
  - acceptable fallback: `Start with a scan`

### Secondary

- `Search instead`
- lower visual weight than the primary CTA

### Tertiary

- `Do this later`
- lowest visual weight, likely text link treatment

### Interaction Model

The page should collapse the current two-step pattern into one step.

Instead of:

- select an option
- press continue

Use:

- tap the main CTA
- immediately enter scan

This removes a second moment of hesitation.

## Copy Direction

Tone should be:

- understanding, not clinical
- confident, not pushy
- activating, not instructional

The page should sound like:

- "We got what matters to you."
- "Here's the easiest first move."
- "Start now."

It should avoid sounding like:

- a settings screen
- a recommendation engine explanation
- a multi-option form

### Copy Pattern

1. lead with the conclusion
2. support with brief personalized reasons
3. end with an immediate start action

### Proof Inputs To Surface

Use only the most user-legible signals, such as:

- goals
- preferred types
- blocker / simplicity preference
- maybe experience level when it helps confidence

Do not over-surface technical or low-signal fields just because they exist in the profile.

## Personalization Strategy

This design does **not** require a dynamic primary CTA model in this round.

Recommendation:

- primary CTA is almost always `scan first`
- personalization changes the reasoning and proof language, not the main branch

Rationale:

- better for conversion
- simpler to explain
- lower implementation and QA risk
- matches the user's stated preference for a mostly universal scan-first path

## Scope

### In Scope

- `plan-preview -> first-stack` emotional handoff
- `first-stack` information hierarchy
- `first-stack` CTA structure
- personalized proof language on `first-stack`
- reducing friction between `first-stack` and entering scan
- instrumentation updates needed to measure conversion

### Out of Scope

- re-architecting the broader personalization system
- dynamic primary CTA routing by profile segment
- scan result experience redesign
- barcode result page behavior changes
- deep scan pipeline or scan network flow changes

## Protected-Scope Boundary

Because barcode scan is a release-sensitive area, this design should avoid modifying protected scan UX unless explicitly required and approved.

Default implementation boundary:

- onboarding and handoff pages can change
- routing into scan can change only as needed for the handoff
- scan result behavior should remain untouched
- scan-side logic should remain untouched unless a minimal handoff change is unavoidable

## Metrics

### Primary Metrics

- `first-stack` hero CTA click-through rate
- `first-stack` -> scan entry rate
- onboarding completion -> first real-use action rate

### Secondary Metrics

- `plan-preview` -> `first-stack` continuation rate
- `Search instead` usage rate
- `Do this later` usage rate

### Qualitative Success

Users should report that the page feels:

- more personal
- more decisive
- easier to act on

## Risks

1. **Too much push, not enough proof**
   If the page pushes scan too hard without enough personalized evidence, it will feel generic or coercive.

2. **Too much proof, not enough momentum**
   If the page tries to explain too many fields, it will become cognitively heavy again.

3. **Secondary exits become too weak**
   If `Search instead` or `Do this later` are buried too hard, users who cannot scan immediately may feel blocked.

## Validation Plan

This design should be considered successful only if the implementation improves real-use movement, not just aesthetics.

Validation should include:

- event-level funnel comparison before and after
- simulator walkthrough of `setup -> plan-preview -> first-stack -> scan`
- copy and layout review on multiple device sizes
- confirmation that the scan handoff still routes correctly

## Recommended Implementation Shape

Implementation should likely proceed in this order:

1. redefine `first-stack` page responsibility
2. replace three-way equal-choice UI with scan-first hero layout
3. rewrite CTA model from two-step to one-step
4. inject concise personalized proof signals
5. update analytics and verify funnel behavior

## Open Decision Already Resolved

The following questions were resolved during planning:

- primary goal for this round: **increase first real-use conversion**
- biggest weak point: **`plan-preview -> first-stack`**
- biggest emotional gap: **not enough momentum**
- desired feeling: **users feel understood and motivated**
- CTA model: **one clearly recommended primary action**
- primary action policy: **almost always scan first**

## Summary

The recommended move is not to make `first-stack` more elaborate. It is to make it more decisive.

NuTri should use existing personalization to prove relevance, then immediately turn that relevance into one strong next step:

**scan your first supplement now.**
