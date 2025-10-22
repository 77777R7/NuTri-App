import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { apiClient } from './api-client';
import { parseAuthRedirectParams } from './auth-session';

export type AuthProvider = 'google' | 'apple';

export type AuthTokens = {
  token: string;
  expiresAt: string;
};

export const signInWithProvider = async (provider: AuthProvider) => {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'nutri',
    path: 'auth-callback',
  });

  const start = await apiClient.authStart(provider, redirectUri);

  const result = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, redirectUri);

  if (result.type !== 'success' || !result.url) {
    throw new Error('用户取消或未完成登录');
  }

  const params = parseAuthRedirectParams(result.url);
  const returnedState = params.state;
  const status = params.status;

  if (returnedState !== start.state || status !== 'success') {
    throw new Error('登录状态验证失败');
  }

  const exchange = await apiClient.authExchange({
    state: start.state,
    codeVerifier: start.codeVerifier,
  });

  return {
    token: exchange.token,
    expiresAt: exchange.expiresAt,
    user: exchange.user,
  };
};
