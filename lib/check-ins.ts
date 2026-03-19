export const SUPPLEMENT_CHECKIN_PREFIX = 'supplement:';
export const LOCAL_CHECKIN_PREFIX = 'local:';

export const buildSupplementCheckInKey = (supplementId: string) =>
  `${SUPPLEMENT_CHECKIN_PREFIX}${supplementId}`;

export const buildCheckInKey = (input: { supplementId?: string | null; localId: string }) =>
  input.supplementId ? buildSupplementCheckInKey(input.supplementId) : `${LOCAL_CHECKIN_PREFIX}${input.localId}`;

export const isSupplementCheckInKey = (key: string) => key.startsWith(SUPPLEMENT_CHECKIN_PREFIX);

export const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isDateKeyAfter = (dateKey: string, referenceKey: string) => dateKey > referenceKey;
