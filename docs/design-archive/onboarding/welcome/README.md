# Welcome Design Archive

These files are retained as design references for the Welcome hero only.

Kept:

- `welcome-hero-shell.png`
  Historical Figma-exported hero shell reference.
- `gemini-hero-card.png`
  Gemini/Web reference card used during visual matching.
- `nutri-logo-pill.png`
  Logo pill reference used during Welcome polish.

Removed from runtime assets:

- `welcome-hero-shell-display.png`
- `welcome-hero-glow.png`
- `welcome-hero-glow@2x.png`

Reason:

- Welcome now uses a single code-driven implementation through `WelcomeHeroCarousel`, `WelcomeHeroGlow`, `WelcomePrimaryCTA`, and `welcomeTokens`.
- These archived files are not loaded at runtime.
- If a future Welcome iteration reintroduces exported assets, it should do so intentionally and document the decision in `docs/onboarding-module-boundaries.md`.
