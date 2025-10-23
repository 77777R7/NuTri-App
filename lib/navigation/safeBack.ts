import type { NavigationProp } from '@react-navigation/native';
import { router, usePathname, type Href } from 'expo-router';

export function safeBack(
  nav: NavigationProp<ReactNavigation.RootParamList> | undefined,
  opts?: { fallback?: Href },
) {
  const fallback = opts?.fallback ?? '/(auth)/gate';

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
        router.replace('/index');
      } else {
        router.replace('/onboarding/welcome');
      }
      return;
    }
  } catch {}

  router.replace(fallback);
}
