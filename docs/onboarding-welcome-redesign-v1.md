# Onboarding Welcome Redesign v1

## 1. Purpose

This document defines the final visual redesign direction for:

- [app/onboarding/welcome.tsx](/Users/howard07/NuTriApp/nutri-app/app/onboarding/welcome.tsx)

The goal is to turn the current welcome page from a functional onboarding
opening into a true brand-led first impression.

## 2. Page Role

The welcome page is not a form step.

It is a **brand poster + emotional entry point**.

Its job is to:

- establish NuTri as premium and trustworthy
- make the user feel guided, not surveyed
- create confidence that useful answers are coming soon
- launch the onboarding narrative with strong visual presence

## 3. Desired User Feeling

After 3 seconds on this screen, the user should feel:

- `This feels premium`
- `This app is thoughtful`
- `This looks like it will help me find what fits`

They should **not** feel:

- `I am about to fill out a long questionnaire`
- `This looks like a generic app onboarding`
- `This is mostly functional setup`

## 4. Current Screen Issues

The current screen has several useful foundations, but it is not yet hitting
the final direction.

### What currently works

- clear first step structure
- entrance animations exist
- brand is visible
- CTA is clear

### What currently misses

- the screen still reads like a structured onboarding page rather than a
  brand composition
- the middle “What you’ll see next” box makes it feel more explanatory than
  premium
- the color direction is still green/mint-led instead of aligning to the
  desired main-page blue/navy direction
- the badge/logo centerpiece feels functional rather than art-directed
- the CTA container is floating, but not yet convincingly liquid-glass

## 5. Visual Thesis

`A calm, premium launch poster with a deep-blue atmosphere and a soft liquid-glass action layer.`

## 6. Composition Direction

## 6.1 Screen structure

The screen should be treated as one composition, not a stack of onboarding
modules.

Recommended structure:

1. background visual field
2. brand and progress hint
3. hero statement
4. one supporting sentence
5. one dominant real product or context-led visual anchor
6. one liquid-glass CTA layer

## 6.2 First-screen hierarchy

Order of emphasis:

1. `NuTri`
2. hero promise
3. visual anchor
4. supporting sentence
5. CTA

The page should still feel unmistakably NuTri even if all small helper text is
removed.

## 6.3 What to remove from the current layout

The redesign should remove or heavily downplay:

- the “What you’ll see next” explainer card
- checklist-like bullets
- utility-heavy onboarding framing
- any card that makes the screen feel like a document

The welcome page should not explain the whole flow.

That belongs to later steps.

## 7. Content Direction

## 7.1 Brand

Brand presence should be medium-strong:

- stronger than current utility pages
- weaker than a full marketing splash page

Recommended treatment:

- `NuTri` should sit high in the hierarchy
- use strong wordmark styling rather than a simple circular badge as the main
  emotional anchor
- the wordmark must read as a hero-level signal, not a small utility app label

## 7.2 Headline

The headline should promise fit, not process.

Recommended direction:

- short
- confident
- outcome-led

Example directions:

- `Find what fits your body and your goals.`
- `Build a supplement setup that actually fits you.`
- `Better supplement decisions start here.`

The final version should stay within roughly 2–3 lines on mobile.

## 7.3 Supporting copy

Keep to one sentence.

Example direction:

- `Answer a few quick questions and NuTri will shape the clearest next picks for you.`

It should feel:

- guided
- useful
- calm

Not:

- mechanical
- overexplained
- marketing-heavy

## 7.4 CTA

Primary CTA:

- `Show me what fits`

No competing CTA should sit at the same visual level.

If secondary controls exist, they must feel clearly lighter.

## 8. Color and Material Direction

## 8.1 Palette

The welcome screen should shift away from the current mint-green onboarding
theme and move toward the main product direction:

- background: soft white / off-white base
- depth tones: deep navy
- accent: NuTri blue
- supporting glow: very restrained cool-blue haze

### Important rule

Do not introduce many colors.

This page should feel premium through:

- contrast
- spacing
- atmospheric layering

Not through colorful decoration.

## 8.2 Material usage

Use glass selectively:

- CTA housing
- one tightly integrated support plane if it directly strengthens the main
  composition
- possibly a progress capsule

Do **not** use glass for:

- the whole background
- large text panels
- explanatory cards
- detached badges
- floating chips
- promo-style callouts
- non-essential hero overlays

The page should feel like:

- clean planes first
- glass interaction second

## 9. Visual Anchor Direction

The dominant visual should not be:

- lifestyle photography
- icon grid
- dashboard preview

Recommended anchor direction:

- one real product or believable product-context anchor
- optionally supported by restrained abstract material treatment
- any dot-grid, ASCII-like, or texture-led styling must remain subtle and must
  not weaken object clarity
- visible connection to supplement fit / recommendation context
- enough specificity that the user understands NuTri's world at a glance

The anchor should feel:

- precise
- modern
- expensive
- relevant

Not:

- playful
- neon
- sci-fi
- generic

### Anchor guidance

If an abstract form is used, it should behave as support material only.

It should not become the entire hero idea.

The welcome screen needs a context-led anchor strong enough that the page does
not collapse into “premium but generic app onboarding.”

## 10. Motion Direction

This page should carry the strongest motion in the onboarding flow.

## 10.1 Entry sequence

Recommended motion order:

1. background glow / form settles in
2. brand fades and stabilizes
3. headline rises in
4. support copy follows
5. CTA liquid-glass layer settles last

This sequence should feel cinematic, not bouncy.

## 10.2 Transition to next page

This is one of the most important motions in the entire onboarding flow.

Recommended feeling:

- the welcome page should dissolve/slide into the trust page as if the user is
  being guided deeper into the same system
- avoid abrupt route-change energy

## 10.3 Motion characteristics

- smooth
- slightly pronounced
- premium
- low noise
- no springiness that feels toy-like

## 11. Layout Guidance

## 11.1 Safe structure on mobile

Recommended vertical rhythm:

- top safe area
- light progress hint
- brand
- hero copy
- visual anchor
- CTA layer near lower safe area

The CTA should feel anchored and calm, not jammed into the footer.

## 11.2 Progress treatment

Progress should be present but subtle.

Recommended:

- a thin progress bar
- a light step hint

Avoid making `Step 1 of 13` feel like a form counter.

## 12. Implementation Guidance

When this redesign is implemented:

- preserve existing route behavior
- preserve accessibility and tap target clarity
- keep the welcome page as a single strong composition
- do not reintroduce utility cards after styling starts
- do not add detached labels, chips, or floating callouts into the first
  viewport unless they are essential to the core interaction

### Component-level suggestions

Likely files affected:

- [app/onboarding/welcome.tsx](/Users/howard07/NuTriApp/nutri-app/app/onboarding/welcome.tsx)
- [components/BrandGradient.tsx](/Users/howard07/NuTriApp/nutri-app/components/BrandGradient.tsx)
- [lib/theme.ts](/Users/howard07/NuTriApp/nutri-app/lib/theme.ts)

Potential additions later:

- glass CTA wrapper
- reusable onboarding visual backdrop
- refined progress capsule component

## 13. Pre-build Reference Requirements

Before redesign work starts, gather:

- 1-2 visual references or a mood board
- one explicit do / don't pair
- real NuTri copy
- one real supplement / scan / recommendation context example

This is required to keep the hero grounded in real product meaning instead of
generic premium abstraction.

## 14. Verification Requirements

Before signing off on the welcome redesign, review:

- mobile first viewport
- safe areas
- transition into the next page
- CTA readability
- whether any overlay competes with brand, headline, or CTA

## 15. Acceptance Criteria

The redesign is successful when:

- the first screen feels brand-led, not form-led
- the screen can be understood in one glance
- the user sees one main promise and one main action
- the page no longer depends on a large explainer box
- the color/material direction aligns with the product’s blue/navy system
- the CTA feels premium through glass-like tactility
- the hero has a real product or context-led anchor, not only abstract
  atmosphere
- the first viewport stays clean and free of non-essential overlays

## 16. Explicit Anti-Goals

Do not redesign this page into:

- a SaaS hero
- a dashboard preview
- a survey intro page
- a marketing collage
- a gradient-only composition with no strong anchor
- a detached-overlay hero full of chips, badges, or callouts
