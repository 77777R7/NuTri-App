# Base44 Onboarding Flow (Expo)

This directory hosts the Expo/React Native implementation of the Base44 Q&A onboarding sequence.
The original Vite + React web code was fully ported to run inside the existing NuTri expo-router
application, with mobile-native components, navigation, and persistence.

## Highlights

- Seven screens (`welcome` → `privacy`) mapped under `app/base44/` with expo-router stack navigation.
- Shared UI rebuilt for React Native in `components/base44/qa/` (neumorphic cards, buttons, select options, progress bar).
- Reuses NuTri's `OnboardingContainer`, `StepSlide`, and theming tokens for consistent look and feel.
- Async persistence through `lib/base44/client.ts` (using `@react-native-async-storage/async-storage`).
- Gentle haptic feedback applied to key interactions with `expo-haptics`.
- Icons provided via `lucide-react-native`.

## Running the flow

1. Install dependencies (once):

   ```bash
   npm install
   ```

2. Start Expo:

   ```bash
   npx expo start
   ```

3. In the Expo dev UI, open the `base44/welcome` route. You can reach it quickly from the console:

   ```bash
   # With the Metro dev server running
   open exp://localhost:8081/--/base44/welcome
   ```

   or browse to `http://localhost:8081/?platform=ios` and use the "Link" text input (`/base44/welcome`).

## Notes

- Data written during the flow is stored locally via AsyncStorage (stubbed Base44 API). Clearing the
  Expo app’s storage resets the flow.
- Privacy step requires opting into data collection to finish. All other consents are optional and
  can be toggled at any time.
- Existing NuTri flows remain untouched; these screens live alongside the primary onboarding system
  and leverage the shared transition context for animated slides.

## Next steps

- Integrate the Base44 entry point into the marketing/feature toggle once product is ready.
- Swap the stub API client for Base44’s real SDK when credentials are available.
- Add end-to-end tests (Detox / Maestro) to cover the new multi-step journey.
