# Onboarding Module Boundaries

This document defines the intended ownership boundaries for the onboarding surface in `/app/onboarding` and `/components/onboarding`.

The goal is not to force every file into a new folder immediately. The goal is to make it clear:

- which pieces are Welcome-only
- which pieces belong to the reusable question flow
- which pieces belong to summary/result pages
- which pieces are shared foundation and should stay generic

## Boundary Rules

### Welcome
Use this bucket for anything that is visually unique to the first onboarding screen and should not leak into the rest of onboarding.

Typical characteristics:

- brand-heavy hero treatment
- skia glow and Welcome-only CTA treatment
- custom motion that only exists on Welcome
- Welcome-only visual tokens

Current files:

- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/welcome.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/welcome/WelcomeHeroCarousel.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/welcome/WelcomeHeroGlow.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/welcome/WelcomePrimaryCTA.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/welcome/welcomeTokens.ts`

Archived Welcome design references:

- `/Users/howard07/NuTriApp/nutri-app/docs/design-archive/onboarding/welcome/welcome-hero-shell.png`
- `/Users/howard07/NuTriApp/nutri-app/docs/design-archive/onboarding/welcome/gemini-hero-card.png`
- `/Users/howard07/NuTriApp/nutri-app/docs/design-archive/onboarding/welcome/nutri-logo-pill.png`

Rules:

- Do not spread Welcome-specific hero logic, glow, CTA styling, or tokens into question/info/summary pages.
- If a component needs `welcomeTokens`, it is almost certainly Welcome-owned.
- Archived design assets are references only unless a future Welcome implementation explicitly opts back into them.
- If Welcome uses Skia, keep that dependency Welcome-only rather than leaking it into shared onboarding components.

### Question
Use this bucket for the standard onboarding Q&A flow: single-select, multi-select, grouped questions, progress flow, shared footer behavior.

Typical characteristics:

- one question per route
- progress mode top chrome
- continue and optional skip footer
- option rows and selection controls
- question title and subtitle layout

Current route files:

- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/age-range.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/sex.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/experience.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/goals.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/types.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/allergy.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/blocker.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/setup.tsx`

Current reusable question components:

- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/QuestionScreenShell.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/QuestionHeader.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/OptionRow.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/SelectionControl.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/StandardSingleSelectScreen.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/StandardMultiSelectScreen.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/question/standardQuestionTypes.ts`

Rules:

- New standard question pages should start from `StandardSingleSelectScreen` or `StandardMultiSelectScreen`.
- `QuestionOption` is the preferred interface for options. Do not assume `label === value`.
- Special question pages such as allergy can still own their own grouped scroll area, but should use `QuestionScreenShell`.

### Summary
Use this bucket for plan/result/evaluated-loop pages that explain the user’s first plan and next action.

Typical characteristics:

- summary or explanation panels
- accordion cards
- evaluated stack cards
- result-focused, content-dense layouts

Current route files:

- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/plan-preview.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/first-stack.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/done.tsx`

Current reusable summary components:

- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/summary/SummaryScreenShell.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/summary/SummarySectionHeader.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/summary/SummaryPanel.tsx`

Rules:

- Repeated `GlassSurface + section header` stacks should go through `SummaryPanel`.
- Summary pages own their own dense content and analytics logic, but should not rebuild outer chrome or headers from scratch.
- If a panel can appear on more than one result page, it should not be page-local.

### Info
Use this bucket for onboarding pages that are primarily explanatory rather than question-driven.

Current route files:

- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/data-trust.tsx`

Current reusable info components:

- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/InfoScreenShell.tsx`

Rules:

- Use `InfoScreenShell` when the page is mostly content and explanation, even if it still has a footer CTA.
- Do not force info pages through question abstractions unless they actually behave like questions.

### Shared Foundation
Use this bucket for pieces that underpin multiple onboarding modules and should remain visually generic.

Current files:

- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/GlassSurface.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/GuardrailScreenShell.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/PrimaryCTA.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/OnboardingTopChrome.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/ProgressBar.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/VerticalGlowScrollbar.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/theme.ts`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/FormInput.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/PermissionCard.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/UnitToggle.tsx`
- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/OnboardingContainer.tsx`

Current supporting state and flow files:

- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/_layout.tsx`
- `/Users/howard07/NuTriApp/nutri-app/app/onboarding/index.tsx`
- `/Users/howard07/NuTriApp/nutri-app/contexts/OnboardingContext.tsx`
- `/Users/howard07/NuTriApp/nutri-app/contexts/TransitionContext.tsx`
- `/Users/howard07/NuTriApp/nutri-app/contexts/PersonalizationContext.tsx`
- `/Users/howard07/NuTriApp/nutri-app/contexts/SavedSupplementsContext.tsx`
- `/Users/howard07/NuTriApp/nutri-app/lib/onboarding-v2.ts`

Rules:

- Shared foundation files should stay neutral. If a file becomes Welcome-specific, move that logic out.
- Theme and shell components should not contain route-specific business logic.

## Practical Ownership Guide

When adding or refactoring onboarding code, use this decision tree:

1. Is the thing visually unique to Welcome?
   Put it in Welcome.
2. Is it a standard question surface with options and a footer CTA?
   Put it in Question.
3. Is it a plan/result/explanation card?
   Put it in Summary.
4. Is it just chrome, tokens, shell, or generic interaction?
   Put it in Shared Foundation.

## Current Cross-Boundary Exceptions

These files are acceptable transitional exceptions for now:

- `/Users/howard07/NuTriApp/nutri-app/components/onboarding/shared/OnboardingContainer.tsx`
  Its long-term place depends on whether it remains shared or becomes legacy.

## Recommended Next Physical Moves

This document does not require immediate folder moves, but if we decide to align the file tree with the module boundaries, the next good moves are:

- create `components/onboarding/welcome/`
- create `components/onboarding/question/`
- create `components/onboarding/summary/`
- create `components/onboarding/shared/`

Suggested first candidates:

- `WelcomeHeroCarousel.tsx`, `WelcomeHeroGlow.tsx`, `WelcomePrimaryCTA.tsx`, `welcomeTokens.ts` now live in `welcome/`
- `QuestionScreenShell.tsx`, `QuestionHeader.tsx`, `OptionRow.tsx`, `SelectionControl.tsx`, `StandardSingleSelectScreen.tsx`, `StandardMultiSelectScreen.tsx`, `standardQuestionTypes.ts` now live in `question/`
- `SummaryScreenShell.tsx`, `SummarySectionHeader.tsx`, `SummaryPanel.tsx` now live in `summary/`
- keep `GlassSurface.tsx`, `GuardrailScreenShell.tsx`, `PrimaryCTA.tsx`, `theme.ts`, `ProgressBar.tsx`, `OnboardingTopChrome.tsx` in shared

## Why This Boundary Exists

The point of this split is not abstraction for its own sake.

It exists so that:

- Welcome fidelity work does not destabilize ordinary onboarding pages
- question pages can evolve together instead of drifting
- summary/result pages can share dense content patterns without duplicating shell code
- future Gemini/Figma-to-RN work has a predictable target layer
