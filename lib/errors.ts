import type { AuthError } from '@supabase/supabase-js';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'The email or password you entered is incorrect.',
  invalid_grant: 'Your credentials are invalid. Please try again.',
  email_not_confirmed: 'Please confirm your email address before signing in.',
  user_not_found: 'We could not find an account with that email address.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  over_request_rate_limit: 'Too many requests. Please wait a moment before trying again.',
  provider_not_enabled: 'This sign-in provider is not enabled.',
};

export class RateLimitError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

const isSupabaseAuthError = (error: unknown): error is AuthError & { code?: string } => {
  if (!error || typeof error !== 'object') return false;
  return 'message' in error && 'name' in error;
};

export const isRateLimitError = (error: unknown): error is RateLimitError =>
  error instanceof RateLimitError;

export const getAuthErrorMessage = (error: unknown): string => {
  if (isRateLimitError(error)) {
    const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return `${error.message} Try again in ~${seconds} seconds.`;
  }

  if (isSupabaseAuthError(error)) {
    const code = (error as { code?: string }).code ?? '';
    if (code && AUTH_ERROR_MESSAGES[code]) {
      return AUTH_ERROR_MESSAGES[code];
    }

    const normalized = error.message?.toLowerCase() ?? '';

    const match = Object.entries(AUTH_ERROR_MESSAGES).find(([, message]) =>
      normalized.includes(message.toLowerCase().slice(0, 8)),
    );

    if (match) {
      return match[1];
    }

    if (normalized.includes('invalid login credentials')) {
      return AUTH_ERROR_MESSAGES.invalid_credentials;
    }

    if (normalized.includes('signups not allowed')) {
      return 'Sign-ups are currently disabled. Please contact support.';
    }

    return error.message ?? 'Authentication failed. Please try again.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
};
