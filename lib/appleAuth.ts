import { appleAuth, appleAuthAndroid } from '@invertase/react-native-apple-authentication';

// NOTE: This module is intentionally platform-overridable.
// - Native (default): exports the real Apple auth implementation.
// - Web: `lib/appleAuth.web.ts` provides stubs so Metro can bundle web.
export { appleAuth, appleAuthAndroid };

