export type AuthModePolicyInput = {
  disableFromEnv: boolean;
  forceAuthFromEnv: boolean;
  disableFromExtra: boolean;
  forceAuthFromExtra: boolean;
  isExpoGo: boolean;
  disableForPrivateApiHost: boolean;
  isDevRuntime: boolean;
};

export const resolveAuthDisabled = (input: AuthModePolicyInput): boolean => {
  if (!input.isDevRuntime) return false;
  if (input.forceAuthFromEnv || input.forceAuthFromExtra) return false;
  return input.disableFromEnv || input.disableFromExtra || input.isExpoGo || input.disableForPrivateApiHost;
};
