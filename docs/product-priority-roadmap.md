# NuTri Product Priority Roadmap

Last updated: 2026-03-24

## Purpose

This file is the working source of truth for the current product optimization direction.

Use this file when:
- planning the next implementation wave
- recovering context after a long thread
- deciding whether a task belongs to the production lane or the research lane

This roadmap should be updated as priorities change. It is expected to evolve.

## Current Working Principles

- Keep immature personalization research UI out of the production lane unless explicitly re-approved.
- Treat barcode scan as a release-sensitive surface. Any scan changes must stay minimal and deliberate.
- Prioritize investor/demo-safe flows first, especially scan stability, My Saved schedule flows, and QA polish.
- Prefer shipping validated user value over exposing more system intelligence too early.

## Current Product Reality

These points reflect the repo state as of this update:

- `My Saved` already has strong schedule functionality:
  - single-item `Start date`
  - single-item `Days of week`
  - batch `Edit schedule`
  - batch apply flow for multiple supplements
- `Recently Scanned` already exists on Home.
- `Achievements` already exist in the Progress screen, but still need product/UI finalization.
- `Profile` exists and is functional, but still needs final product-definition polish.
- The newer personalization research UI has been hidden behind a research-only gate and should stay there for now.
- Barcode scan is working against Render and is suitable for release hardening, but scan remains a protected area.
- OCR/text-scan-related backend/runtime pieces still exist in the codebase, so "remove text scan" should be interpreted as removing user-facing QA entry points and production exposure first, not assuming the underlying OCR stack is already gone.

## Priority List

## First Priority

### 1. Barcode scan: manual entering (bug fix)

Goal:
- Make manual barcode entry reliable and production-safe.

Current state:
- Manual barcode handling exists in backend/fallback logic.
- A clear, production-ready frontend manual-entry path is not yet confirmed as complete and bug-free.

Planned work:
- Audit the current barcode screen and any manual-entry path.
- Reproduce the bug.
- Apply the smallest safe fix inside the scan lane.
- Re-test with Render-backed flows before release.

Acceptance:
- User can manually enter a barcode when camera scan is not available or fails.
- Manual entry resolves to the same result path as camera scan.
- No crash, no dead-end state, no hanging first result.

### 2. Text scan completely removed (from all places) in QA

Goal:
- Remove text scan from all user-facing QA surfaces.

Current state:
- OCR/text-scan infrastructure still exists in backend/runtime.
- User-facing QA entry points need explicit audit.

Planned work:
- Inventory all visible entry points for text scan.
- Remove or hide them from QA/release surfaces.
- Keep backend OCR internals only if still needed by non-user-facing pipelines.

Acceptance:
- No visible text scan button, route, or CTA in QA builds.
- No confusing copy suggesting text/photo scan is still available.

### 3. Finalize QA (UI, function), plus user guide page

Goal:
- Turn the current demo/release candidate into a clean, explainable experience.

Current state:
- QA is partially documented across multiple files and recent session checks.
- There is no single lightweight user guide page yet.

Planned work:
- Create a unified QA checklist for release/demo.
- Add one lightweight user guide surface.
- Format can be one of:
  - slides
  - picture-based walkthrough
  - short video

Acceptance:
- Core flows are tested with one concise checklist.
- A first-time user/investor can understand the main journey quickly.

### 4. Paywall (research, decision making)

Goal:
- Decide the paywall strategy before implementation pressure forces bad UX.

Current state:
- Not yet the main implementation lane.

Planned work:
- Research pricing/placement strategy.
- Decide what belongs behind the paywall and what must remain in free core utility.

Acceptance:
- A clear paywall decision memo exists before heavy implementation starts.

## Product Finalization

### 5. Achievement finalized

Goal:
- Finalize both the meaning and presentation of achievements.

Current state:
- Achievement/streak badge logic already exists.
- Product and visual framing still need tightening.

Planned work:
- Confirm what achievements matter.
- Simplify labels and visuals.
- Ensure they support retention without clutter.

Acceptance:
- Achievement UX feels intentional, not placeholder.

### 6. Personal Profile finalized (function + UI)

Goal:
- Make Profile feel complete and stable.

Current state:
- Profile screen exists and is functional.
- It still needs final polish and clearer role boundaries.

Planned work:
- Finalize account/profile sections.
- Keep research-only personalization UI hidden unless deliberately reintroduced.
- Make sure Profile does not become an overloaded experiments surface.

Acceptance:
- Profile has a clean, stable production role.

## Main Function

Important note:
- Future work in this section should land in the production results lane, not by re-exposing the hidden personalization research UI.

### 7. If it fits your goal

Goal:
- Clearly tell the user whether the selected product matches the goals they set.

Current state:
- Deterministic goal-fit infrastructure exists.
- Prior experimental UI for this was intentionally hidden because it was not ready for production.

Planned work:
- Reintroduce this as a cleaner production results feature.
- Validate input/output against user goal selection.
- Keep explanation clear and decision-oriented.

Acceptance:
- A user can immediately understand if a product fits their goal.

### 8. Personal insight

Goal:
- Show what the product supports and whether it conflicts with saved supplements.

Details to include:
- support summary
- conflict summary
- expandable details
- active and non-active ingredient conflict detail

Current state:
- Some of the underlying comparison/safety logic exists.
- Production-ready surface for this is not finalized.

Planned work:
- Define a production contract for personal insight.
- Connect it to saved supplements data.
- Add expandable conflict detail.

Acceptance:
- User can see both benefit and conflict in one understandable section.

### 9. QA allergy section connected to personal insight

Goal:
- Add allergy-aware reasoning to the result experience.

Current state:
- Allergen-related backend concepts exist.
- A production-facing allergy section is not yet finalized.

Planned work:
- Add allergy data to QA coverage.
- Connect allergy detection to personal insight.
- Flag relevant ingredients when matched.

Acceptance:
- If an ingredient is allergy-relevant, the result surface clearly shows it.

### 10. Recommended dosage vs selected supplement dosage

Goal:
- Compare recommended dosage against the product's actual dosage.

Current state:
- Dose/facts infrastructure exists in multiple areas.
- This comparison is not yet productized in the main result experience.

Planned work:
- Define a clear dosage comparison surface.
- Keep wording practical and non-medical.

Acceptance:
- User can quickly understand whether the selected product's dosage looks aligned, low, or unclear.

### 11. Organization: move safety card before all other detailed sections

Status:
- Completed

Goal:
- Put safety first in the detailed reading order.

Current state:
- Safety is now positioned before secondary deep-dive sections in the intended detailed reading order.

Planned work:
- None.

Acceptance:
- Safety is seen before secondary deep-dive sections.

### 12. Comparison with other products

Goal:
- Show how the selected product stands relative to similar products, then recommend better options.

Desired UX:
- first show level/standing
- for example: above average or percentile
- then show 3-4 higher Nutri Score alternatives

Current state:
- The comparison direction exists conceptually.
- A clean production standing/alternatives surface is not yet finalized.

Planned work:
- Define standing language
- define benchmark logic
- show a small number of better alternatives

Acceptance:
- User can see whether the product is strong, average, or weak relative to similar products.
- Better alternatives are actionable, not overwhelming.

## Save Section

### 13. Overview replaced with result section

Goal:
- Replace the current saved-item overview with the result-oriented section.

Current state:
- My Saved currently has strong scheduling controls and detailed item surfaces.
- The desired final information hierarchy still needs redesign.

Planned work:
- Redefine the primary saved-item content hierarchy.

Acceptance:
- Saved item detail starts with the most decision-useful result content.

### 14. Two tabs in this order

Desired order:
- `Alarm / Schedule`
- `Result`

Current state:
- Schedule functionality is already strong.
- Final tab structure still needs product design work.

Planned work:
- Implement the two-tab structure.
- Put schedule first because it is already a strong production feature.

Acceptance:
- Saved item detail has a clear two-tab model.

### 15. Design brainstorm: format or reorganize for clarity

Goal:
- Make My Saved easier to scan and understand.

Planned work:
- Rework grouping, spacing, and content order without weakening the schedule flow.

Acceptance:
- My Saved feels clearer and less dense.

## Main Page

### 16. Remove the function of can't check in the previous day

Goal:
- Remove this restriction from the product flow.

Current state:
- Needs confirmation and implementation review in check-in logic and UI.

Planned work:
- Audit check-in rules and remove the previous-day block.

Acceptance:
- User is no longer blocked from prior-day completion in the targeted scope.

### 17. Add mark all as taken

Goal:
- Add one-tap completion for today's supplements.

Current state:
- Not yet implemented as a visible Home action.

Planned work:
- Define scope
- add bulk complete action
- confirm safe behavior with schedules and streaks

Acceptance:
- User can mark all due items as taken in one step.

### 18. Put Today's Supplement Progress, Daily Tip, and Streak in one section

Goal:
- Make this area feel like one coherent carousel section.

Desired behavior:
- horizontal swipe between cards
- swiping further right reveals `7-Day Trend`

Current state:
- These modules exist, but the final grouped interaction is not yet the defined production pattern.

Planned work:
- Convert them into one clear horizontal section.
- Keep the information hierarchy calm and readable.

Acceptance:
- User can swipe between the cards naturally and discover trend content without clutter.

### 19. Recently Scanned

Goal:
- Keep and improve this as a useful quick-return surface.

Current state:
- Recently Scanned already exists on Home.

Planned work:
- Validate whether layout, actions, and retention value are strong enough.

Acceptance:
- Recently Scanned feels useful, not just decorative.

### 20. Add unsaved button

Goal:
- Give users a direct way to unsave from the relevant surface.

Current state:
- Needs final product placement and behavior definition.

Planned work:
- Decide the correct location and interaction pattern.

Acceptance:
- Unsaving is easy, obvious, and safe.

## Recommended Execution Order

Based on the current repo state, this is the recommended order:

1. Barcode scan manual entry bug fix
2. Text scan removal from QA surfaces
3. Final QA pass plus user guide page
4. My Saved information architecture cleanup
5. Main Page quick wins:
   - remove previous-day block
   - add mark all as taken
   - reorganize the progress/tip/streak/trend section
6. Achievement finalization
7. Profile finalization
8. Main Function production lane:
   - if it fits your goal
   - personal insight
   - allergy connection
   - dosage comparison
   - product standing and alternatives
9. Paywall strategy research and decision

## Execution Buckets

This section translates the roadmap into an engineering-oriented working queue.

## Now

These are the highest-priority tasks because they are closest to release quality, investor/demo safety, or already have strong implementation foundations.

### 1. Barcode scan: manual entering (bug fix)

Why now:
- Scan is release-critical.
- This is a direct recovery path when camera flow fails.
- It is a contained, high-ROI fix.

Expected output:
- manual barcode entry works cleanly
- same result path as camera scan
- validated against Render

### 2. Text scan removed from all QA-visible surfaces

Why now:
- It reduces confusion before release/demo.
- It is easier to remove visible affordances now than later after more flows depend on them.

Expected output:
- no user-facing text/photo scan entry points in QA
- no leftover copy suggesting text scan is still active

### 3. Final QA pass plus user guide page

Why now:
- Current product value is already strong enough to demo, but the surrounding guidance is fragmented.
- A release/demo candidate should have one clear sanity checklist and one lightweight guide.

Expected output:
- one concise QA checklist
- one user guide surface or asset

### 4. Main Function production lane

Scope:
- `If it fits your goal`
- `Personal insight`
- `QA allergy section connected to personal insight`
- `Recommended dosage vs selected supplement dosage`
- `Comparison with other products`

Why now:
- This is the core product value layer you want to prioritize now.
- It directly answers whether a product is right for the user, why, and what better options exist.
- It is the most important production results lane after scan reliability and QA cleanup.

Expected output:
- a production result surface that clearly shows:
  - whether the product fits the user's goal
  - what it supports
  - whether it conflicts with saved supplements
  - allergy-relevant flags
  - dosage context
  - higher-quality alternatives

Important:
- This work should land in the production results lane.
- Do not solve it by re-enabling the hidden research personalization UI.

## Next

These are important, but should follow after the release/demo-safe foundation above is stable.

### 5. My Saved: restructure around the strongest production value

Scope:
- `Overview replaced with result section`
- `Two tabs: Alarm / Schedule, Result`
- `Design brainstorm: reorganize for clarity`

Why next:
- My Saved already has strong schedule functionality.
- It should still be improved, but your current direction puts the main result lane ahead of saved-surface reorganization.

Expected output:
- schedule-first saved item flow
- result content organized as a second tab
- clearer detail hierarchy

### 6. Main Page quick wins

Scope:
- remove previous-day check-in restriction
- add `Mark all as taken`
- group `Today's Supplement Progress`, `Daily Tip`, and `Streak` into one swipeable section with `7-Day Trend`
- validate `Recently Scanned`
- add unsaved button if placement is straightforward

Why next:
- These are meaningful daily-use improvements.
- They should follow the core scan + QA + main result work you want prioritized first.

Expected output:
- smoother daily routine interactions
- clearer home information architecture

### 7. Achievement finalized

Why next:
- The logic exists already.
- This is mostly product-definition and UI tightening, not a blocker for current release confidence.

### 8. Personal Profile finalized (function + UI)

Why next:
- Profile already exists and works.
- It needs final role clarity, but it should not interrupt higher-priority scan and My Saved work.

## Later

These are real roadmap items, but they depend on earlier UX, contract, and release work landing first.

### 9. Paywall research and decision

Why later:
- It matters strategically, but it should not distort near-term product cleanup.
- Better to decide after the core free utility and result surfaces are more stable.

## Blocked / Need Decision

These items are not necessarily blocked by engineering difficulty. They need product decisions, scope confirmation, or clearer success criteria before implementation should accelerate.

### A. Paywall definition

Need decision on:
- what exactly is free
- what exactly is premium
- where the paywall appears
- what the upgrade story is

### B. "If it fits your goal" production surface shape

Need decision on:
- where this lives
- whether it belongs in scan results, saved detail, or both
- how much explanation appears by default

Important:
- do not solve this by re-enabling the hidden research personalization UI

### C. Personal insight contract

Need decision on:
- exact support/conflict schema
- how detailed active vs non-active ingredient conflict disclosure should be
- how allergies should appear in the same section

### D. Product standing/comparison framing

Need decision on:
- whether to use `above average`, `percentile`, tier labels, or another standing model
- whether this is shown as a score framing, a standing card, or a recommendation list

### E. User guide format

Need decision on:
- slides
- static images
- lightweight page
- video

### F. Home carousel section interaction

Need decision on:
- whether the grouped section is paged cards, a free horizontal rail, or a snap carousel
- what card order is canonical
- whether `Recently Scanned` belongs inside or outside that cluster

## Explicit Guardrails

- Do not re-enable the hidden research personalization UI by accident.
- Do not let production Profile become an experiments container.
- Keep scan work minimal and deliberate because scan is still release-sensitive.
- Prefer decision-useful production surfaces over exposing more internal intelligence.

## Update Rule

Whenever priorities change, update this file instead of spreading the roadmap across chat only.
