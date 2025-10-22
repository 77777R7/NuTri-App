import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function QAScreen() {
  const { session, setPostAuthRedirect } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!session) {
      setPostAuthRedirect('/qa');
      router.replace({
        pathname: '/auth/login',
        params: { redirect: encodeURIComponent('/qa') },
      });
    }
  }, [session, router, setPostAuthRedirect]);

  if (!session) return null;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Q&amp;A content</Text>
    </View>
  );
}
