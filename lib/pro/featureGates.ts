export type OfficialPaywallSource =
  | 'first_scan_result'
  | 'score'
  | 'overview'
  | 'science'
  | 'usage'
  | 'safety'
  | 'stack_safety'
  | 'scan_limit'
  | 'product_search'
  | 'saved_supplement_limit'
  | 'profile_upgrade';

export type ProFeatureKey =
  | 'scan_after_free_limit'
  | 'product_search'
  | 'saved_supplement_limit';

export const FREE_SCAN_LIMIT = 1;
export const FREE_SAVED_SUPPLEMENT_LIMIT = 1;

export type ProGateDecision = {
  feature: ProFeatureKey;
  allowed: boolean;
  paywallSource: OfficialPaywallSource | null;
  reason: 'premium' | 'free_allowance_remaining' | 'exempt_flow' | 'limit_reached';
};

export type SavedSupplementAddGateDecision =
  | {
      status: 'allowed';
      limit: typeof FREE_SAVED_SUPPLEMENT_LIMIT;
      savedCount: number;
    }
  | {
      status: 'duplicate';
      limit: typeof FREE_SAVED_SUPPLEMENT_LIMIT;
      savedCount: number;
    }
  | {
      status: 'limit_reached';
      limit: typeof FREE_SAVED_SUPPLEMENT_LIMIT;
      savedCount: number;
    };

export const getScanEntryGateDecision = ({
  isPremium,
  firstCompletedScanId,
  isOnboardingScan = false,
  isGuestScan = false,
}: {
  isPremium: boolean;
  firstCompletedScanId?: string | null;
  isOnboardingScan?: boolean;
  isGuestScan?: boolean;
}): ProGateDecision => {
  if (isPremium) {
    return {
      feature: 'scan_after_free_limit',
      allowed: true,
      paywallSource: null,
      reason: 'premium',
    };
  }

  if (isOnboardingScan || isGuestScan) {
    return {
      feature: 'scan_after_free_limit',
      allowed: true,
      paywallSource: null,
      reason: 'exempt_flow',
    };
  }

  if (!firstCompletedScanId) {
    return {
      feature: 'scan_after_free_limit',
      allowed: true,
      paywallSource: null,
      reason: 'free_allowance_remaining',
    };
  }

  return {
    feature: 'scan_after_free_limit',
    allowed: false,
    paywallSource: 'scan_limit',
    reason: 'limit_reached',
  };
};

export const getProductSearchGateDecision = ({
  isPremium,
}: {
  isPremium: boolean;
}): ProGateDecision => {
  if (isPremium) {
    return {
      feature: 'product_search',
      allowed: true,
      paywallSource: null,
      reason: 'premium',
    };
  }

  return {
    feature: 'product_search',
    allowed: false,
    paywallSource: 'product_search',
    reason: 'limit_reached',
  };
};

export const getSavedSupplementAddGateDecision = ({
  isPremium,
  savedCount,
  isDuplicate,
}: {
  isPremium: boolean;
  savedCount: number;
  isDuplicate: boolean;
}): SavedSupplementAddGateDecision => {
  if (isDuplicate) {
    return {
      status: 'duplicate',
      limit: FREE_SAVED_SUPPLEMENT_LIMIT,
      savedCount,
    };
  }

  if (isPremium || savedCount < FREE_SAVED_SUPPLEMENT_LIMIT) {
    return {
      status: 'allowed',
      limit: FREE_SAVED_SUPPLEMENT_LIMIT,
      savedCount,
    };
  }

  return {
    status: 'limit_reached',
    limit: FREE_SAVED_SUPPLEMENT_LIMIT,
    savedCount,
  };
};

export const buildOfficialPaywallParams = ({
  source,
  scanId,
  returnTo,
}: {
  source: OfficialPaywallSource;
  scanId?: string | null;
  returnTo?: string | null;
}) => ({
  source,
  ...(scanId ? { scanId } : {}),
  ...(returnTo ? { returnTo } : {}),
});

export const resolvePostPurchaseResumePath = ({
  source,
  returnTo,
}: {
  source: OfficialPaywallSource;
  returnTo?: string | null;
}): string => {
  switch (source) {
    case 'scan_limit':
      return '/scan/barcode';
    case 'product_search':
      return '/search';
    case 'saved_supplement_limit':
      return returnTo ?? '/main/Home-Page?tab=saved';
    case 'stack_safety':
      return returnTo ?? '/main/Home-Page?tab=saved';
    case 'profile_upgrade':
      return '/search';
    case 'score':
    case 'overview':
    case 'science':
    case 'usage':
    case 'safety':
    case 'first_scan_result':
      return returnTo ?? '/main/Home-Page';
    default:
      return returnTo ?? '/main/Home-Page';
  }
};
