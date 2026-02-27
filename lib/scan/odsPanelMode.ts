export type OdsPanelMode = 'science' | 'safety';

type ResolveOdsPanelSectionsParams = {
  mode: OdsPanelMode;
  hasOverview: boolean;
  whatItDoesCount: number;
  watchOutsCount: number;
  interactionCount: number;
  ulCount: number;
};

export type OdsPanelSections = {
  showOverview: boolean;
  showWhatItDoes: boolean;
  showWatchOuts: boolean;
  showInteractions: boolean;
  showUl: boolean;
};

export const resolveOdsPanelSections = (
  params: ResolveOdsPanelSectionsParams,
): OdsPanelSections => {
  const isScience = params.mode === 'science';
  const isSafety = params.mode === 'safety';

  return {
    showOverview: isScience && params.hasOverview,
    showWhatItDoes: isScience && params.whatItDoesCount > 0,
    showWatchOuts: isSafety && params.watchOutsCount > 0,
    showInteractions: isSafety && params.interactionCount > 0,
    showUl: isSafety && params.ulCount > 0,
  };
};
