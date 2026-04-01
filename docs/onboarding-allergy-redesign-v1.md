# Onboarding Allergy Redesign v1

## 1. Purpose

This document defines the final visual redesign direction for:

- [app/onboarding/allergy.tsx](/Users/howard07/NuTriApp/nutri-app/app/onboarding/allergy.tsx)

This step should become the model for how NuTri handles safety-oriented
questions inside onboarding without making the user feel like they are filling
out a medical form.

## 2. Page Role

The allergy page is a **safety guardrail step**.

Its role is to:

- help the user avoid obvious mismatches
- make NuTri feel careful and intelligent
- collect future conflict signals without creating friction

It is not:

- a risk warning page
- a compliance page
- a clinical screening form

## 3. Desired User Feeling

The user should feel:

- `NuTri is helping me avoid bad fits`
- `This feels thoughtful and safe`
- `This is optional and easy`

They should not feel:

- `I am filling in allergy paperwork`
- `This is getting medical`
- `This page is warning me about danger`

## 4. Current Screen Issues

The current version is a solid functional start, but it still reads more like
an option list than a designed safety step.

### What currently works

- the content is lightweight
- the options are supplement-relevant
- the step is optional
- the hierarchy is understandable

### What currently needs redesign

- the page still feels like a standard multi-section QA layout
- the material treatment is still mostly plain card structure
- the “Most common in supplements / Restrictions / Quick option” grouping is
  correct conceptually, but still too utilitarian visually
- the step needs a more distinct guardrail tone without becoming clinical

## 5. Visual Thesis

`A calm safety checkpoint with soft glass interaction, clear hierarchy, and zero medical-form energy.`

## 6. Structural Direction

## 6.1 Page structure

Recommended layout:

1. light progress hint
2. title
3. short supporting explanation
4. one compact safety reassurance line
5. option groups
6. lightweight secondary skip
7. clear primary CTA

## 6.2 Key layout rule

The user should still perceive this as:

- one question
- one flow

Not:

- three stacked forms
- several independent preference cards

## 7. Content Direction

## 7.1 Title

Keep:

- `Anything to avoid?`

This works because it is:

- calm
- human
- non-clinical

## 7.2 Supporting copy

Recommended:

- `We use this to flag ingredients that may not fit your routine.`

Optional support line:

- `You can skip this for now and add it later in Profile.`

The tone should sound like a product assistant, not a warning disclosure.

## 7.3 Guardrail microcopy

A small line near the option area can reinforce the page role:

- `We’ll use this only to catch obvious mismatches.`

This helps the page feel:

- helpful
- contained
- not overwhelming

## 8. Visual Tone

This page should be more restrained than:

- goals
- types

But more intentional than:

- blocker
- setup

It should visually signal:

- safety
- care
- precision

Without becoming:

- yellow warning UI
- red alert UI
- heavy medical gray UI

### Real context rule

This page should feel grounded in real supplement-use context.

It should not read like a generic safety settings page.

The user should understand that NuTri is helping avoid mismatches in real
supplement products, not collecting abstract medical metadata.

## 9. Material and Glass Rules

This page should use **lighter, quieter glass** than the welcome page.

## 9.1 Recommended glass usage

Use soft glass / liquid-glass behavior for:

- option surfaces
- selected states
- the optional “No known allergies” surface
- a light top reassurance strip if one is added

## 9.2 Glass intensity

Keep the material:

- subtle
- stable
- low-noise

This page should not have flashy refraction or dramatic floating overlays.

## 9.3 Selected-state feel

When an option is selected, it should feel:

- brighter
- slightly more lifted
- more focused
- softly illuminated

Not:

- neon
- overly colored
- noisy with borders and badges

## 10. Option Grouping Guidance

## 10.1 Primary group

The first visible set should stay supplement-first:

- Fish
- Shellfish
- Dairy
- Soy
- Gluten
- Gelatin / animal-based

This set should be presented as the most common supplement-relevant avoidances.

## 10.2 More group

The expanded group:

- Egg
- Sesame
- Tree nuts
- Peanuts
- Wheat

This should feel like:

- a gentle expansion

Not:

- a second full page
- a bulky accordion section

## 10.3 No known allergies

This should feel like a clean, valid fast path.

It should not feel like:

- a footnote
- a fallback afterthought

Recommended treatment:

- same visual family as the main options
- quieter but still clearly selectable

## 11. Layout Style Recommendation

The redesign should move away from:

- multiple boxed sections with equal visual weight

And move toward:

- one continuous page rhythm
- clearly separated clusters
- fewer heavy containers

### Recommended pattern

- the page background stays clean
- each option is a premium interactive surface
- group labels are light section dividers, not big boxed headers

In other words:

- interaction surfaces may feel card-like
- the page should not feel card-built

## 12. Animation Guidance

This page should feel more guided than dramatic.

## 12.1 Entry

Recommended motion:

- title and support copy settle in quickly
- option surfaces appear in a soft upward sequence
- no theatrical hero animation

## 12.2 Selection feedback

This is the most important motion on this page.

Selections should feel:

- tactile
- premium
- calm

Recommended behavior:

- brief brightness shift
- slight scale or settle animation
- soft internal glow

## 12.3 More expansion

The `More options` interaction should feel:

- smooth
- contained
- quiet

It should not feel like:

- a drawer
- a dramatic collapse animation

## 13. Color Guidance

This page should stay within the onboarding blue/navy system.

Suggested treatment:

- clean white/off-white base
- navy text
- muted cool-gray support copy
- blue-tinted glass selection states

Avoid:

- harsh warning yellow
- red safety tones
- multiple accent colors

## 14. Implementation Guidance

When redesigning this page:

- keep the option order supplement-first
- preserve `Skip for now`
- preserve `No known allergies`
- preserve multi-select behavior
- keep the page obviously optional

Likely files affected:

- [app/onboarding/allergy.tsx](/Users/howard07/NuTriApp/nutri-app/app/onboarding/allergy.tsx)
- [components/onboarding/question/OptionRow.tsx](/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/OptionRow.tsx)
- [lib/theme.ts](/Users/howard07/NuTriApp/nutri-app/lib/theme.ts)

Possible future additions:

- a glass-capable onboarding option component
- a softer grouped-divider component for onboarding QA pages

## 15. Pre-build Reference Requirements

Before redesigning this page, gather:

- 1-2 references for premium safety-oriented product UI
- one clear do / don't pair
- real supplement ingredient or label conflict examples
- the actual NuTri copy used on this step

This keeps the page grounded in real supplement context and prevents it from
drifting into generic settings UI.

## 16. Verification Requirements

Before sign-off, review:

- mobile readability
- glass contrast
- selected and unselected state clarity
- `More options` expansion behavior
- whether the page still reads as one question instead of multiple modules

## 17. Acceptance Criteria

The redesign is successful when:

- the step feels like a safety guardrail, not a clinical form
- the page still reads as one question, not multiple modules
- the interaction surfaces feel premium through subtle glass behavior
- `No known allergies` feels like a valid main choice
- the page remains skippable and low-friction
- readability remains strong

## 18. Explicit Anti-Goals

Do not redesign this page into:

- a warning panel
- a medical checklist
- a yellow caution screen
- a stack of equal-weight cards
- a dense explainer page
