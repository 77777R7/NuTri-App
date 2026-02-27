import type { NavigationProp } from '@react-navigation/native';
import { router, type Href } from 'expo-router';
import { AUTH_FALLBACK_PATH } from '@/lib/auth-mode';

export function safeBack(
  _nav: NavigationProp<ReactNavigation.RootParamList> | undefined,
  opts?: { fallback?: Href },
) {
  const fallback = opts?.fallback ?? AUTH_FALLBACK_PATH;
  router.replace(fallback);
}
