import React, { PropsWithChildren, useEffect } from 'react';
import { SplashScreen, usePathname, useRouter } from 'expo-router';

import { getPostAuthDestination, useAuth } from '@/contexts/AuthContext';

export const ProtectedRoute: React.FC<PropsWithChildren> = ({ children }) => {
  const { session, loading, setPostAuthRedirect } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    SplashScreen.preventAutoHideAsync().catch(() => undefined);
    return () => {
      SplashScreen.hideAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [loading]);

  useEffect(() => {
    if (!loading && !session) {
      const destination = getPostAuthDestination(pathname);
      setPostAuthRedirect(String(destination));

      router.replace({
        pathname: '/auth/login',
        params: {
          redirect: encodeURIComponent(String(destination)),
        },
      });
    }
  }, [loading, session, pathname, router, setPostAuthRedirect]);

  if (loading || !session) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

