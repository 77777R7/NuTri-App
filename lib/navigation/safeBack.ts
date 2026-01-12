import type { NavigationProp } from '@react-navigation/native';
import { router, usePathname, type Href } from 'expo-router';
import { AUTH_FALLBACK_PATH } from '@/lib/auth-mode';

export function safeBack(
  nav: NavigationProp<ReactNavigation.RootParamList> | undefined,
  opts?: { fallback?: Href },
) {
  const fallback = opts?.fallback ?? AUTH_FALLBACK_PATH;

  try {
    if (nav?.canGoBack?.()) {
      nav.goBack();
      return;
    }
  } catch {}

  try {
    if (router.canGoBack?.()) {
      router.back();
      return;
    }
  } catch {}

  try {
    const pathname = usePathname?.() as string | undefined;
    if (pathname?.startsWith('/onboarding/')) {
      if (pathname === '/onboarding/welcome') {
        router.replace('/');
      } else {
        router.replace('/onboarding/welcome');
      }
      return;
    }
  } catch {}

  router.replace(fallback);
}
