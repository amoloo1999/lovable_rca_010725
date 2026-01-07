import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import type {
  SearchCriteria,
  Store,
  StoreMetadata,
  StoreRankings,
  AdjustmentFactors,
  DateGap,
  FeatureCode,
  RateRecord,
  WizardStep,
  SalesforceMatch,
} from '@/types/rca';
import {
  searchStoresByAddress,
  findCompetitors,
  fetchHistoricalData,
  getTrailing12MonthRates,
  getSalesforceMetadataByAddress,
  getSalesforceMatches,
} from '@/lib/api';

export interface RCAWizardState {
  currentStep: number;
  searchCriteria: SearchCriteria;
  searchResults: Store[];
  subjectStore: Store | null;
  competitors: Store[];
  selectedStores: Store[];
  storeMetadata: Record<number, StoreMetadata>;
  storeRankings: Record<number, StoreRankings>;
  adjustmentFactors: AdjustmentFactors;
  customNames: Record<number, string>;
  dateGaps: DateGap[];
  apiStoreIds: number[];
  featureCodes: FeatureCode[];
  rateRecords: RateRecord[];
  isLoading: boolean;
  error: string | null;
}

const initialSearchCriteria: SearchCriteria = {
  streetAddress: '',
  country: 'United States',
  state: '',
  city: '',
  zipCode: '',
  storeName: '',
  companyName: '',
  radius: 5,
};

const initialAdjustmentFactors: AdjustmentFactors = {
  captiveMarketPremium: 0,
  lossToLease: 0,
  ccAdj: 0,
};

const defaultRankings: StoreRankings = {
  Location: 5,
  Age: 5,
  Accessibility: 5,
  VPD: 5,
  'Visibility & Signage': 5,
  Brand: 5,
  Quality: 5,
  Size: 5,
};

export const WIZARD_STEPS: WizardStep[] = [
  { id: 1, name: 'Search', description: 'Enter address to find stores', completed: false },
  { id: 2, name: 'Subject Store', description: 'Select subject store', completed: false },
  { id: 3, name: 'Competitors', description: 'View and select competitors', completed: false },
  { id: 4, name: 'Metadata', description: 'Enter Year Built & SF', completed: false },
  { id: 5, name: 'Rankings', description: 'Rate store attributes', completed: false },
  { id: 6, name: 'Adjustments', description: 'Set adjustment factors', completed: false },
  { id: 7, name: 'Names', description: 'Customize store names', completed: false },
  { id: 8, name: 'Data Gaps', description: 'Review database coverage', completed: false },
  { id: 9, name: 'Feature Codes', description: 'Assign unit codes', completed: false },
  { id: 10, name: 'Data Visualization', description: 'View and export data', completed: false },
];

export function useRCAWizard() {
  const [state, setState] = useState<RCAWizardState>({
    currentStep: 1,
    searchCriteria: initialSearchCriteria,
    searchResults: [],
    subjectStore: null,
    competitors: [],
    selectedStores: [],
    storeMetadata: {},
    storeRankings: {},
    adjustmentFactors: initialAdjustmentFactors,
    customNames: {},
    dateGaps: [],
    apiStoreIds: [],
    featureCodes: [],
    rateRecords: [],
    isLoading: false,
    error: null,
  });

  const setStep = useCallback((step: number) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, WIZARD_STEPS.length),
    }));
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 1),
    }));
  }, []);

  const updateSearchCriteria = useCallback((criteria: Partial<SearchCriteria>) => {
    setState((prev) => ({
      ...prev,
      searchCriteria: { ...prev.searchCriteria, ...criteria },
    }));
  }, []);

  // Real API call to search stores
  const searchStores = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const { state: currentState } = state.searchCriteria;
      const stores = await searchStoresByAddress({
        state: state.searchCriteria.state,
        city: state.searchCriteria.city,
        zip: state.searchCriteria.zipCode,
        storeName: state.searchCriteria.storeName,
        companyName: state.searchCriteria.companyName,
      });
      
      setState((prev) => ({
        ...prev,
        isLoading: false,
        searchResults: stores,
        error: null,
      }));
      
      toast.success(`Found ${stores.length} stores`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search stores';
      console.error('Search error:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
        searchResults: [],
      }));
      toast.error(message);
    }
  }, [state.searchCriteria]);

  // Select subject store and fetch competitors from API
  const selectSubjectStore = useCallback(async (store: Store) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const result = await findCompetitors({
        storeId: store.storeId,
        radius: state.searchCriteria.radius,
      });
      
      setState((prev) => ({
        ...prev,
        isLoading: false,
        subjectStore: { ...result.subject, distance: 0 },
        competitors: result.competitors,
        error: null,
      }));
      
      toast.success(`Found ${result.competitors.length} competitors`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to find competitors';
      console.error('Competitor search error:', error);
      
      // Fall back to using search results as competitors
      setState((prev) => {
        const competitors = prev.searchResults
          .filter((s) => s.storeId !== store.storeId)
          .sort((a, b) => (a.distance || 0) - (b.distance || 0));
        
        return {
          ...prev,
          isLoading: false,
          subjectStore: { ...store, distance: 0 },
          competitors,
          error: null,
        };
      });
      
      toast.warning('Using search results as competitors');
    }
  }, [state.searchCriteria.radius]);

  const selectStoresForAnalysis = useCallback(async (stores: Store[]) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    
    const selected = state.subjectStore ? [state.subjectStore, ...stores] : stores;
    const metadata: Record<number, StoreMetadata> = {};
    const rankings: Record<number, StoreRankings> = {};
    const customNames: Record<number, string> = {};
    
    // Initialize with empty metadata
    selected.forEach((store) => {
      metadata[store.storeId] = { yearBuilt: null, squareFootage: null, distance: store.distance };
      rankings[store.storeId] = { ...defaultRankings };
      customNames[store.storeId] = store.storeName;
    });
    
    // Fetch metadata from Salesforce_rawData for each store by matching address and name
    // Uses fuzzy matching logic like RCA_template.py
    const metadataPromises = selected.map(async (store) => {
      try {
        const result = await getSalesforceMetadataByAddress({
          street: store.address,
          city: store.city,
          state: store.state,
          postalCode: store.zip,
          storeName: store.storeName,
        });
        
        if (result && result.matched) {
          metadata[store.storeId] = {
            ...metadata[store.storeId],
            yearBuilt: result.yearBuilt,
            squareFootage: result.squareFootage,
          };
        }
      } catch (error) {
        console.warn(`Failed to fetch metadata for store ${store.storeId}:`, error);
      }
    });
    
    await Promise.all(metadataPromises);
    
    setState((prev) => ({
      ...prev,
      selectedStores: selected,
      storeMetadata: metadata,
      storeRankings: rankings,
      customNames,
      isLoading: false,
    }));
    
    const matchedCount = Object.values(metadata).filter(m => m.yearBuilt || m.squareFootage).length;
    if (matchedCount > 0) {
      toast.success(`Found metadata for ${matchedCount} of ${selected.length} stores`);
    }
  }, [state.subjectStore]);

  // Try to fetch metadata from Salesforce via MCP by address and name
  // Uses fuzzy matching logic like RCA_template.py
  const fetchStoreMetadata = useCallback(async (store: Store) => {
    try {
      const result = await getSalesforceMetadataByAddress({
        street: store.address,
        city: store.city,
        state: store.state,
        postalCode: store.zip,
        storeName: store.storeName,
      });
      
      if (result && result.matched) {
        setState((prev) => ({
          ...prev,
          storeMetadata: {
            ...prev.storeMetadata,
            [store.storeId]: {
              ...prev.storeMetadata[store.storeId],
              yearBuilt: result.yearBuilt,
              squareFootage: result.squareFootage,
            },
          },
        }));
        return result;
      }
    } catch (error) {
      console.error('Failed to fetch Salesforce metadata:', error);
    }
    return null;
  }, []);

  // Fetch all Salesforce matches for a store so user can select the correct one
  // Like RCA_template.py prompt_for_salesforce_match
  const fetchSalesforceMatchesForStore = useCallback(async (store: Store): Promise<SalesforceMatch[]> => {
    try {
      const matches = await getSalesforceMatches({
        street: store.address,
        city: store.city,
        state: store.state,
        postalCode: store.zip,
        storeName: store.storeName,
      });
      return matches;
    } catch (error) {
      console.error('Failed to fetch Salesforce matches:', error);
      return [];
    }
  }, []);

  const updateStoreMetadata = useCallback((storeId: number, metadata: Partial<StoreMetadata>) => {
    setState((prev) => ({
      ...prev,
      storeMetadata: {
        ...prev.storeMetadata,
        [storeId]: { ...prev.storeMetadata[storeId], ...metadata },
      },
    }));
  }, []);

  const updateStoreRankings = useCallback((storeId: number, rankings: Partial<StoreRankings>) => {
    setState((prev) => ({
      ...prev,
      storeRankings: {
        ...prev.storeRankings,
        [storeId]: { ...prev.storeRankings[storeId], ...rankings },
      },
    }));
  }, []);

  const updateAdjustmentFactors = useCallback((factors: Partial<AdjustmentFactors>) => {
    setState((prev) => ({
      ...prev,
      adjustmentFactors: { ...prev.adjustmentFactors, ...factors },
    }));
  }, []);

  const updateCustomName = useCallback((storeId: number, name: string) => {
    setState((prev) => ({
      ...prev,
      customNames: { ...prev.customNames, [storeId]: name },
    }));
  }, []);

  // Analyze data gaps using real API
  const analyzeGaps = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const storeIds = state.selectedStores.map((s) => s.storeId);
      const result = await getTrailing12MonthRates({ storeIds });
      
      // Calculate gaps based on actual data coverage
      const gaps: DateGap[] = state.selectedStores.map((store) => {
        const dates = result.datesByStore[store.storeId] || [];
        const totalExpectedDays = 365;
        const actualDays = dates.length;
        const missingDays = Math.max(0, totalExpectedDays - actualDays);
        
        return {
          storeId: store.storeId,
          storeName: store.storeName,
          missingDays,
          coveragePercent: Math.round((actualDays / totalExpectedDays) * 100 * 10) / 10,
          dateRanges: [], // Would need more detailed analysis
          yearsNeeded: missingDays > 30 ? [2024, 2025] : [],
          estimatedCost: missingDays > 30 ? 12.5 * Math.ceil(missingDays / 30) : 0,
        };
      });
      
      setState((prev) => ({
        ...prev,
        isLoading: false,
        dateGaps: gaps,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze gaps';
      console.error('Gap analysis error:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
        dateGaps: [],
      }));
      toast.error(message);
    }
  }, [state.selectedStores]);

  const setApiStoreIds = useCallback((ids: number[]) => {
    setState((prev) => ({ ...prev, apiStoreIds: ids }));
  }, []);

  const updateFeatureCode = useCallback((tag: string, code: string) => {
    setState((prev) => ({
      ...prev,
      featureCodes: prev.featureCodes.map((fc) =>
        fc.originalTag === tag ? { ...fc, code } : fc
      ),
    }));
  }, []);

  // Initialize feature codes from actual rate data
  const initializeFeatureCodes = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    
    try {
      // Fetch historical data to get unique tags
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setMonth(fromDate.getMonth() - 12);
      
      const allRecords: RateRecord[] = [];
      
      for (const store of state.selectedStores) {
        try {
          const records = await fetchHistoricalData({
            storeId: store.storeId,
            fromDate: fromDate.toISOString().split('T')[0],
            toDate: today.toISOString().split('T')[0],
          });
          allRecords.push(...records);
        } catch (e) {
          console.warn(`Failed to fetch data for store ${store.storeId}:`, e);
        }
      }
      
      // Extract unique tags and count occurrences
      const tagCounts: Record<string, number> = {};
      allRecords.forEach((record) => {
        const tag = record.tag || record.unitType || 'Unknown';
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
      
      // Convert to FeatureCode array
      const featureCodes: FeatureCode[] = Object.entries(tagCounts)
        .map(([tag, count]) => ({
          originalTag: tag,
          code: generateFeatureCode(tag),
          count,
        }))
        .sort((a, b) => b.count - a.count);
      
      setState((prev) => ({
        ...prev,
        isLoading: false,
        featureCodes,
        rateRecords: allRecords,
      }));
    } catch (error) {
      console.error('Failed to initialize feature codes:', error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        featureCodes: [],
      }));
      toast.error('Failed to load feature codes');
    }
  }, [state.selectedStores]);

  // Generate feature code from tag
  const generateFeatureCode = (tag: string): string => {
    const lowerTag = tag.toLowerCase();
    let code = '';
    
    if (lowerTag.includes('climate') || lowerTag.includes('cc')) code += 'CC';
    if (lowerTag.includes('drive') || lowerTag.includes('du')) code += 'DU';
    if (lowerTag.includes('ground') || lowerTag.includes('gl')) code += 'GL';
    if (lowerTag.includes('elevator') || lowerTag.includes('el')) code += 'EL';
    if (lowerTag.includes('outdoor')) code += 'OD';
    
    return code || tag.slice(0, 4).toUpperCase();
  };

  // Export real CSV data
  const exportCSV = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    
    try {
      // Fetch historical data for all selected stores
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setMonth(fromDate.getMonth() - 12);
      
      const allRecords: RateRecord[] = [];
      
      for (const store of state.selectedStores) {
        try {
          const records = await fetchHistoricalData({
            storeId: store.storeId,
            fromDate: fromDate.toISOString().split('T')[0],
            toDate: today.toISOString().split('T')[0],
          });
          allRecords.push(...records);
        } catch (e) {
          console.warn(`Failed to fetch data for store ${store.storeId}:`, e);
        }
      }
      
      if (allRecords.length === 0) {
        toast.error('No data available to export');
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }
      
      // Apply custom names
      const recordsWithNames = allRecords.map((record) => ({
        ...record,
        storeName: state.customNames[record.storeId] || record.storeName,
      }));
      
      // Generate CSV
      const headers = [
        'Store Name',
        'Address',
        'City',
        'State',
        'ZIP',
        'Unit Type',
        'Size',
        'Features',
        'Climate Controlled',
        'Drive Up',
        'Walk-In Price',
        'Online Price',
        'Date',
        'Promo',
      ];
      
      const rows = recordsWithNames.map((r) => [
        `"${r.storeName}"`,
        `"${r.address}"`,
        `"${r.city}"`,
        `"${r.state}"`,
        `"${r.zip}"`,
        `"${r.unitType}"`,
        `"${r.size}"`,
        `"${r.features || ''}"`,
        r.climateControlled ? 'Yes' : 'No',
        r.driveUp ? 'Yes' : 'No',
        r.walkInPrice || '',
        r.onlinePrice || '',
        r.date,
        `"${r.promo || ''}"`,
      ]);
      
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RCA_export_${new Date().toISOString().slice(0, 10)}_data.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success(`Exported ${recordsWithNames.length} records`);
      setState((prev) => ({ ...prev, isLoading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export data';
      console.error('Export error:', error);
      toast.error(message);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.selectedStores, state.customNames]);

  return {
    state,
    actions: {
      setStep,
      nextStep,
      prevStep,
      updateSearchCriteria,
      searchStores,
      selectSubjectStore,
      selectStoresForAnalysis,
      fetchStoreMetadata,
      fetchSalesforceMatchesForStore,
      updateStoreMetadata,
      updateStoreRankings,
      updateAdjustmentFactors,
      updateCustomName,
      analyzeGaps,
      setApiStoreIds,
      updateFeatureCode,
      initializeFeatureCodes,
      exportCSV,
    },
  };
}
