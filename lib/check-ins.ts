export const SUPPLEMENT_CHECKIN_PREFIX = 'supplement:';
export const LOCAL_CHECKIN_PREFIX = 'local:';

export const buildSupplementCheckInKey = (supplementId: string) =>
  `${SUPPLEMENT_CHECKIN_PREFIX}${supplementId}`;

export const buildCheckInKey = (input: { supplementId?: string | null; localId: string }) =>
  input.supplementId ? buildSupplementCheckInKey(input.supplementId) : `${LOCAL_CHECKIN_PREFIX}${input.localId}`;

export const isSupplementCheckInKey = (key: string) => key.startsWith(SUPPLEMENT_CHECKIN_PREFIX);
