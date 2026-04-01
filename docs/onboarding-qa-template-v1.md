# Onboarding QA Template v1

## 1. Purpose

This document defines the reusable QA-page template for NuTri onboarding after
the 2 intro slides.

It is based on:

- [docs/nutri-onboarding-visual-system-v2.md](/Users/howard07/NuTriApp/nutri-app/docs/nutri-onboarding-visual-system-v2.md)
- [docs/final-onboarding-ui-direction-v1.md](/Users/howard07/NuTriApp/nutri-app/docs/final-onboarding-ui-direction-v1.md)
- the OpenAI frontend design principles already adopted for this onboarding flow

This file should be used as the source of truth for all question-driven
onboarding pages after `data-trust`.

## 2. QA Design Thesis

NuTri QA pages should feel like:

- a premium selection board
- a guided concierge question
- an Apple-style preference screen

They should not feel like:

- a survey
- a medical intake form
- a default settings list
- stacked white cards inside a blank page

Each QA page should feel like:

- one focused decision
- one clear next action
- one controlled interaction zone

## 3. OpenAI-Aligned Principles

### 3.1 One screen, one job

Each QA page does one thing only:

- ask one question
- let the user answer it
- move them forward

No QA page should also try to explain the entire system.

### 3.2 Composition before components

The page should first read as a clean composition:

- top navigation
- question block
- answer block
- bottom action block

The page should not feel like generic components stacked vertically.

### 3.3 Real hierarchy over decoration

Hierarchy should come from:

- spacing
- typography
- alignment
- answer-card scale
- selected-state contrast

Not from:

- extra cards
- unnecessary badges
- loud background ornaments

### 3.4 Interaction surfaces should carry the feel

Glass belongs primarily on:

- answer choices
- selected states
- pressed states

The background should remain quiet.

### 3.5 Consistency with room for variation

QA pages should share one base skeleton, but question type can change:

- layout density
- choice geometry
- copy weight
- guardrail tone

## 4. Final Product Decisions

These choices are now locked for QA template v1.

### Overall mode

- premium selection board
- guided concierge question
- Apple-style preference screen

### Top bar

- back button
- very light progress only

### Title tone

- direct
- tool-like
- clear

Example:

- `Which age range are you in?`

### Support copy

- absent by default
- only used when necessary
- if present, it must be one short sentence

### Default answer styling

- light glass by default
- selected becomes brighter, more anchored, and slightly lifted

### Selection emphasis

Selected state should use all three, but with restraint:

- brighter fill
- clearer border
- slight lift / scale feedback

### CTA placement

- fixed near bottom safe area

### Disabled CTA

- clearly disabled
- still polished
- never visually broken or ghosted away

### Background complexity

- almost pure
- only very light haze or one restrained support shape if needed

### Motion emphasis

Use motion for:

- page transition
- answer selection feedback
- CTA activation state

All motion should remain calm and fast.

### Template consistency

- one shared skeleton
- page-to-page variation is allowed only when driven by question type

### Why-we-ask handling

- only show on sensitive or key pages
- never as a default paragraph on every screen

### Guardrail pages

- same skeleton
- visibly more restrained
- calmer tone

## 5. Shared QA Skeleton

Every standard QA page should follow this order:

1. Top bar
2. Question block
3. Answer block
4. Bottom CTA block

### 5.1 Top bar

Contents:

- back button on the left
- very light progress rail on the right

Rules:

- no logo
- no step label like `Step 3 of 13`
- no large status text
- no extra chips

The top bar should orient, not explain.

### 5.2 Question block

Contents:

- optional eyebrow
- headline
- optional one-line support

Rules:

- headline should be direct
- headline should usually fit in 2 lines or fewer
- support copy should be omitted unless it improves confidence
- no “Why we ask:” label on standard pages

### 5.3 Answer block

This is the visual center of the page.

Rules:

- answer choices must feel like the primary interaction surface
- choices should be large enough to feel premium
- answer block should visually dominate more than support copy
- answer area should not look like a default form or list

### 5.4 Bottom CTA block

Contents:

- one primary CTA

Rules:

- fixed near the bottom safe area
- CTA should always feel present
- disabled state should still look intentional
- no back button repeated at the bottom

## 6. Answer Surface System

## 6.1 Default answer state

Default answers should feel:

- present
- tappable
- calm
- lightly glassed

Recommended traits:

- soft blur or soft translucent plane
- restrained white or cool-tinted fill
- subtle border
- gentle shadow only if needed

## 6.2 Selected answer state

Selected answers should feel:

- brighter
- more stable
- more precise

Use all of these, lightly:

- stronger border
- brighter fill
- small lift or scale response
- stronger internal contrast

Do not:

- flood the whole tile with strong color
- use thick heavy outlines
- turn the page into a neon state machine

## 6.3 Pressed state

Pressed state should be tactile but brief:

- slight scale reduction
- small shadow change
- no dramatic bounce

## 7. Question Type Variants

QA template v1 supports these 3 explicit variants.

## 7.1 Variant A: Single-Select Standard

Use for:

- age range
- sex
- experience
- blocker

Recommended layout:

- default layout chosen by question type
- single column for denser verbal options
- 2-column selection board for short, high-scan answers

Rule:

- layout must be chosen intentionally, not arbitrarily

## 7.2 Variant B: Multi-Select Standard

Use for:

- goals
- types

Recommended layout:

- tile-based
- can use denser grouping than single-select
- still must remain visually calm

Rules:

- selection count should stay understandable at a glance
- screen should not become a chip cloud

## 7.3 Variant C: Guardrail / Safety

Use for:

- allergy
- avoidances
- similar safety-sensitive questions

Recommended traits:

- same overall skeleton
- more restrained material treatment
- calmer copy
- slightly more explanation if needed

Do not:

- make it look like a warning dashboard
- make it look like a hospital intake page

## 8. Layout Guidance by Question Type

### Short categorical answers

Examples:

- age range
- sex

Can use:

- 2-column premium tiles

Only if:

- labels are short
- scanning remains easy
- tap targets remain generous

### Longer verbal options

Examples:

- experience
- blocker

Should default to:

- single-column larger choice rows or boards

### Multi-select groups

Examples:

- goals
- types

Should use:

- grouped selection boards
- stronger sectioning if needed

### Safety / restriction pages

Examples:

- allergy

Should use:

- calmer tone
- more breathing room
- less visual drama

## 9. Typography Rules

### Headline

- direct
- 2 lines or fewer when possible
- bold, but not oversized

### Support

- one short sentence only
- smaller than intro-slide copy
- neutral and confidence-building

### Option labels

- strong enough to scan instantly
- not so large they dominate the whole tile

### Avoid

- multiple text blocks competing at once
- long explainer paragraphs
- tiny labels plus tiny subtitles plus tiny helper rows

## 10. Background Rules

QA backgrounds should be quieter than intro slides.

Allowed:

- a very light haze
- one restrained support orb if composition needs it
- subtle tonal variation

Avoid:

- multiple strong background circles
- decorative dot clusters unless they serve composition
- hero-like visual storytelling

The answers, not the background, should dominate.

## 11. CTA System

### Primary CTA

Should stay consistent with onboarding:

- blue
- polished
- stable
- fixed near the bottom

### Disabled CTA

Should look:

- intentionally inactive
- still premium
- still aligned with the live CTA

Do not:

- fade it into invisibility
- shrink it
- break the composition when disabled

## 12. Motion Rules

Motion should support:

- entering the new question
- choosing an answer
- enabling CTA

### Page transition

- smooth
- directional
- not carousel-like

### Selection motion

- quick
- tactile
- subtle

### CTA activation

- should feel like a natural readiness shift
- not a dramatic animation event

## 13. Do / Don't

### Do

- keep one visual center
- keep answer choices large and decisive
- keep support copy minimal
- keep top chrome light
- make selected state feel better, not louder

### Don't

- build QA pages as generic forms
- repeat `Why we ask` on every screen
- default to stacked white rows
- let support copy compete with answers
- let background shapes become the main idea

## 14. Implementation Guidance

When implementing QA pages:

1. Start from the shared skeleton
2. Pick the correct variant
3. Choose single-column or two-column intentionally
4. Keep answer surfaces as the main design object
5. Keep CTA consistent across QA pages
6. Tune background down before tuning answers up

## 15. First Rollout Plan

Use this template to redesign pages in this order:

1. `age-range`
2. `sex`
3. `experience`
4. `blocker`
5. `allergy`
6. `goals`
7. `types`

This order establishes the standard QA system before moving into denser
selection surfaces.

## 16. Acceptance Criteria

QA template v1 is successful if:

- pages no longer read as surveys
- answer choices feel like the main interaction
- CTA always feels intentional
- support copy never dominates
- guardrail pages feel calmer, not scarier
- the family resemblance between QA pages is obvious

