# Final Onboarding UI Direction v1

## 1. Purpose

This document defines the final visual and interaction direction for NuTri's
onboarding experience.

It is intended to guide:

- UI redesign
- motion design
- copy decisions
- future implementation work

This document should be treated as the design source of truth for onboarding
until a later revision replaces it.

## 2. Core Product Intent

NuTri onboarding should feel like:

- premium
- clean
- guided
- science-aware
- trustworthy

It should **not** feel like:

- a survey
- a hospital intake form
- a generic startup onboarding flow
- a stack of interchangeable cards

The user should feel:

- `NuTri understands me`
- `This feels premium and trustworthy`
- `This will help me make better supplement decisions`

The experience should feel like a professional matching journey, not a form.

## 3. Visual Thesis

### Visual thesis

`Clinical precision with premium calm, softened by light liquid-glass interactions.`

### Content plan

1. Brand-led welcome
2. Trust and explanation
3. Focused matching questions
4. Payoff and guided next step

### Interaction thesis

1. Welcome should open with a strong poster-like animated transition
2. Each QA page should feel like a guided step forward, not a hard cut
3. Selection should feel tactile through subtle liquid-glass state shifts

## 4. Design Principles

These principles are based on the final NuTri direction and are consistent with
the OpenAI guidance in:

- [Designing delightful frontends with GPT-5.4](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4)

### 4.1 One job per screen

Each onboarding screen should do one thing only:

- establish trust
- ask one question
- preview the plan
- guide the next action

No screen should try to explain too much and ask too much at the same time.

### 4.2 First screen should feel like a composition, not a layout

The welcome page should read like a complete visual statement:

- strong hierarchy
- one dominant visual idea
- one primary CTA
- no dashboard feeling

### 4.3 Restraint over UI clutter

Onboarding should avoid:

- card mosaics
- stacked utility modules
- icon rows with no narrative purpose
- multiple accent colors
- noisy badge clusters

### 4.4 Brand and outcome before mechanics

The user should feel the product promise first.

They should not feel that they are entering data for the system’s sake.

### 4.5 Motion should guide, not decorate

Animation should support:

- forward momentum
- emotional engagement
- perceived quality
- clear selection feedback

It should not feel ornamental or game-like.

### 4.6 Real context should anchor the design

Abstract visual language can support the product mood, but it should not be the
only thing carrying meaning.

Where possible, onboarding should be grounded in real NuTri context:

- supplement decision-making
- scan or recommendation context
- believable product-use signals
- real product language rather than empty premium atmosphere

Abstract material treatment should support the core idea, not replace it.

## 5. Color and Material System

## 5.1 Base palette

The onboarding palette should stay aligned with the main page.

Recommended direction:

- background: same family as main page background
- primary dark: deep navy
- primary accent: NuTri blue
- surface: clean white or lightly tinted white
- text: navy / charcoal, never pure harsh black where softer contrast works
- muted text: cool gray-blue

### Rules

- keep the palette tight
- avoid introducing many new colors
- default to one real accent color
- avoid purple bias
- avoid wellness-rainbow palettes

## 5.2 Material system

Onboarding should use a hybrid material language:

- clean background planes
- soft surface hierarchy
- selective frosted-glass interaction layers

This should feel:

- polished
- fluid
- premium

It should not feel:

- flashy
- cyber
- glossy for the sake of it

## 6. Glass Usage Rules

NuTri onboarding should use glass as an **interaction material**, not as a
global decorative style.

## 6.1 Where glass is encouraged

### Welcome page

Use liquid-glass or frosted layers for:

- CTA container
- one tightly integrated support plane if it directly serves the main
  composition

### QA selections

Use glass for:

- tappable choice surfaces
- selected states
- focus and pressed feedback

### Progress hinting

Use subtle glass treatment for:

- progress track
- lightweight progress capsule

### Explanation pages

Use restrained glass panels for:

- plan summary
- first-stack summary
- trust explanation blocks

## 6.2 Where glass should be limited

Do **not** overuse glass in:

- long-form copy blocks
- every background layer
- every section on every screen
- safety-heavy pages that need very high readability
- detached badges
- floating chips
- promo-like callouts
- non-essential hero overlays

## 6.3 Glass behavior rules

- text must always remain highly readable
- blur should be soft, not muddy
- selected states should feel brighter and more anchored
- unselected states should feel present but quiet
- glass should not replace hierarchy

## 6.4 Safety page nuance

The allergy step should use a more restrained version of the material system.

It should feel like:

- a calm guardrail
- careful and supportive

It should not feel like:

- a warning dashboard
- a danger screen
- a clinical alert form

## 7. Typography Direction

Typography should be:

- very clean
- modern sans
- slightly scientific
- not cold

Recommended feel:

- system-intelligent, not corporate
- premium, not editorial-dramatic
- confident, not aggressive

### Type hierarchy

Keep the system tight:

- `display`
- `headline`
- `body`
- `caption`

### Rules

- strong headlines
- short support copy
- minimal font role sprawl
- avoid overly friendly rounded wellness typography
- avoid sterile enterprise typography

## 8. Progress and Navigation Guidance

Progress should be visible, but not dominant.

Recommended approach:

- light progress indicator
- small step label
- avoid making `Step 1 of 13` the hero

The user should feel guided, not burdened by step count.

Back and skip controls should feel lightweight and secondary.

## 9. Page-by-Page Guidance

## 9.1 Welcome

### Role

Brand-led visual hook.

### Purpose

- establish NuTri identity
- create desire to continue
- signal that the app will help find what fits

### Layout

- one dominant visual composition
- strong brand presence
- short supporting line
- one main CTA

### CTA tone

- `Show me what fits`

### Visual behavior

- strongest animation in the flow
- real product or context-led visual anchor
- restrained abstract material treatment may support that anchor
- not a feature list
- not a utility screen

## 9.2 Data trust

### Role

Explain trust and reduce resistance.

### Purpose

- reassure the user
- clarify how their inputs help improve relevance
- keep them moving

### Visual behavior

- explanation-led
- elegant, restrained paneling
- no dense compliance-feeling layout

## 9.3 QA question screens

Includes:

- age range
- sex
- experience
- goals
- types
- blocker
- setup

### Role

Fast matching input.

### Layout

- one question
- one short reason
- large tappable options
- single main CTA

### Rules

- no multiple modules on one screen
- no survey table feeling
- no small form elements when large options can work

## 9.4 Allergy

### Role

Safety guardrail step.

### Purpose

- help the user avoid obvious mismatches
- gather future conflict data
- keep the step optional and lightweight

### Visual behavior

- calmer than goals/types
- slightly more guarded tone
- still clean and reassuring

### Key rule

It should feel like:

- `we’ll help avoid bad fits`

Not:

- `please complete this medical screening`

## 9.5 Plan preview

### Role

Payoff preview.

### Purpose

- show the user that their answers are turning into something useful
- create confidence that NuTri is personalized

### Visual behavior

- explanation-led
- premium summary panel
- clearer hierarchy than the current utility-heavy layout

## 9.6 First stack

### Role

Guided action handoff.

### Purpose

- keep the user from stalling
- turn personalization into a next action

### Visual behavior

- one focused summary
- one action-led question
- no card sprawl

## 9.7 Done

### Role

Transition into the product.

### Purpose

- close the onboarding loop
- reinforce readiness
- point the user to the clearest next action

## 10. Animation Guidance

Animation should feel intentional and noticeable, especially early in the
flow.

## 10.1 Priority moments

### Welcome entrance

- strongest motion in the system
- should feel cinematic and premium

### Welcome to next page transition

- should feel like one world flowing into the next
- not like separate screens swapping

### Step transitions

- use directional movement to reinforce progress
- transitions should feel smooth and confident

### Selection feedback

- options should respond with a fluid, glass-like state change
- selection should feel satisfying and tactile

### Payoff screens

- summary panels can softly rise, fade, or settle into place

## 10.2 Motion rules

- motion should strengthen hierarchy
- motion should support user confidence
- motion should be smooth on mobile
- motion should not compete with reading
- avoid too many simultaneous animated elements

## 11. Pre-build Reference Package

Before redesigning onboarding or asking a model to generate visual direction,
prepare a compact reference package.

### Required inputs

- 1-2 visual references or a small mood board
- a clear do / don't pair
- real NuTri copy
- real supplement / scan / recommendation context
- at least one concrete example of what NuTri helps the user do

### Why this matters

This prevents the system from drifting into:

- generic premium glass UI
- contextless gradients
- beautiful but non-specific onboarding art direction

## 12. Verification Requirements

Every onboarding redesign should be checked against real implementation
constraints before it is considered final.

### Required checks

- mobile-first review
- desktop sanity check when applicable
- safe-area review
- transition review
- CTA readability review
- check that no overlay covers key text or the main CTA

### Verification expectations

- the first viewport reads clearly at a glance
- the hero keeps brand and purpose legible during motion
- glass does not reduce text clarity
- selection states remain obvious even without relying only on color

## 13. Copy Tone Guidance

The copy should feel:

- intelligent
- concise
- helpful
- premium

It should not feel:

- corporate
- salesy
- clinical
- overexplained

### Copy rules

- lead with utility
- keep support copy short
- avoid repetition
- avoid system-language in user-facing UI
- keep QA prompts natural and easy to answer

## 14. What To Avoid

These are hard anti-goals.

### Do not make onboarding feel like a survey

Avoid:

- repetitive layouts with no emotional pacing
- too many similar choice screens with no visual distinction
- overly literal form treatment

### Do not make onboarding feel like a medical intake form

Avoid:

- cold warnings everywhere
- heavy compliance language
- dense question blocks
- clinical or hospital-like layout patterns

### Do not make it look like a generic startup app

Avoid:

- card grids
- SaaS-style component mosaics
- purple-on-white defaults
- interchangeable hero patterns

### Do not let glass become visual noise

Avoid:

- glass everywhere
- weak contrast over blur
- style-first glass with no functional purpose

### Do not build the first screen like a document

Avoid:

- multiple competing content blocks
- long text stacks
- weak brand presence
- no clear visual anchor

### Do not use detached hero overlays

Avoid:

- floating badges
- detached chips
- promo-style stickers
- hovering labels
- extra callouts in the first viewport that are not essential to the main
  action

## 15. Litmus Checks

Before approving a redesigned onboarding screen, ask:

- Does this feel like guided matching instead of data entry?
- Is the first screen unmistakably NuTri?
- Is there one clear job for this screen?
- Would the layout still feel premium if shadows were removed?
- Is glass being used with purpose?
- Does the screen feel closer to Apple Health restraint than startup-template clutter?
- Does the user feel closer to an answer after this step?

## 16. Immediate Design Priorities

The first pages to redesign should be:

1. `welcome`
2. `allergy`
3. `plan-preview`

Reason:

- `welcome` defines the emotional and visual system
- `allergy` defines the new safety-guardrail pattern
- `plan-preview` defines the payoff pattern

Once those are right, the other QA pages can be aligned under the same system
more easily.
