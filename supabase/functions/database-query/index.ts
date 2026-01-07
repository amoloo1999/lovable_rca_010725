import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// WWG MCP Server REST API
const MCP_BASE_URL = 'https://mcp.wwgmcpserver.com';
const MCP_API_KEY = Deno.env.get('WWG_MCP_API_KEY') || '';

// Universal query using POST /query/universal endpoint with raw SQL
async function universalQuery(database: string, sqlQuery: string) {
  const url = `${MCP_BASE_URL}/query/universal`;
  
  const body = {
    database,
    query: sqlQuery
  };

  console.log(`MCP Universal Query: ${url}`, JSON.stringify(body));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': MCP_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`MCP API Error: ${response.status} - ${errorText}`);
    throw new Error(`MCP API error: ${response.status} - ${errorText}`);
  }

  const jsonResponse = await response.json();
  console.log(`MCP Universal Query response keys:`, Object.keys(jsonResponse));
  
  // Response format is { results: [...], row_count: N }
  if (jsonResponse.results && Array.isArray(jsonResponse.results)) {
    console.log(`MCP response has ${jsonResponse.results.length} results`);
    return jsonResponse.results;
  }
  
  // Fallback for other formats
  if (Array.isArray(jsonResponse)) {
    return jsonResponse;
  } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
    return jsonResponse.data;
  }
  
  return jsonResponse;
}

async function mcpRequest(endpoint: string, params?: Record<string, string>) {
  const url = new URL(`${MCP_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
  }

  console.log(`MCP Request: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-API-Key': MCP_API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`MCP API Error: ${response.status} - ${errorText}`);
    throw new Error(`MCP API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Health check for the MCP server
async function healthCheck() {
  const response = await fetch(`${MCP_BASE_URL}/health`);
  return { healthy: response.ok, status: response.status };
}

// Get list of available databases
async function getDatabases() {
  return await mcpRequest('/databases');
}

// Get sites with optional filtering
async function getSites(params?: { state?: string; city?: string }) {
  return await mcpRequest('/sites', params as Record<string, string>);
}

// Get Stortrack data
async function getStortrackData(endpoint: string, params?: Record<string, string>) {
  return await mcpRequest(`/stortrack${endpoint}`, params);
}

// Query a specific database/table using universal query with SQL
async function queryDatabase(database: string, table: string, filters?: Record<string, any>, limit?: number) {
  // Build SQL query from table and filters
  let sql = `SELECT TOP ${limit || 1000} * FROM dbo.${table}`;
  
  if (filters && Object.keys(filters).length > 0) {
    const whereClauses = Object.entries(filters)
      .map(([key, value]) => `${key} = '${value}'`)
      .join(' AND ');
    sql += ` WHERE ${whereClauses}`;
  }
  
  return await universalQuery(database, sql);
}

// Get analytics data
async function getAnalytics(type: string) {
  return await mcpRequest(`/analytics/${type}`);
}

// Get StorEDGE live data
async function getStorEdgeData(endpoint: string, params?: Record<string, string>) {
  return await mcpRequest(`/storedge/${endpoint}`, params);
}

// Helper: Parse Python dict string to object (handles single quotes and None/True/False)
function parsePythonDict(dictStr: string): Record<string, any> | null {
  if (!dictStr || typeof dictStr !== 'string') return null;
  
  try {
    // First try standard JSON parse
    return JSON.parse(dictStr);
  } catch (e) {
    try {
      // Handle Python dict format: single quotes and None/True/False values
      const jsonString = dictStr
        .replace(/'/g, '"')           // Single quotes to double quotes
        .replace(/None/g, 'null')     // Python None to JSON null
        .replace(/True/g, 'true')     // Python True to JSON true
        .replace(/False/g, 'false');  // Python False to JSON false
      return JSON.parse(jsonString);
    } catch (e2) {
      return null;
    }
  }
}

// Helper: Calculate fuzzy match score between two strings (0-1)
function fuzzyMatchScore(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  
  // Simple Levenshtein-based similarity
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1;
  
  // Check if one contains the other
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }
  
  // Calculate edit distance
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  
  return (longer.length - costs[s2.length]) / longer.length;
}

// Helper: Normalize address string for comparison
function normalizeAddress(addr: string): string {
  return (addr || '')
    .toLowerCase()
    .trim()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g, 'rd')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    .replace(/\bnortheast\b/g, 'ne')
    .replace(/\bnorthwest\b/g, 'nw')
    .replace(/\bsoutheast\b/g, 'se')
    .replace(/\bsouthwest\b/g, 'sw');
}

// Simple Salesforce lookup by store name (like RCA_template.py lines 656-665)
async function getSalesforceByName(storeName: string) {
  console.log('Querying Salesforce_rawData by name:', storeName);
  
  // Use SQL LIKE query to find matching stores by name
  const sql = `
    SELECT TOP 5 Name, Year_Built__c, Net_RSF__c, ShippingAddress
    FROM dbo.Salesforce_rawData
    WHERE Name LIKE '%${storeName.replace(/'/g, "''")}%'
      AND (Year_Built__c IS NOT NULL OR Net_RSF__c IS NOT NULL)
  `;
  
  const results = await universalQuery('Sites', sql);
  
  if (!results || !Array.isArray(results) || results.length === 0) {
    console.log('No results from Salesforce_rawData by name');
    return [];
  }
  
  console.log(`Found ${results.length} records matching name`);
  return results.map((record: any) => ({
    Year_Built__c: record.Year_Built__c,
    Net_RSF__c: record.Net_RSF__c,
    Name: record.Name,
    ShippingAddress: record.ShippingAddress,
  }));
}

// Get Salesforce metadata by address - match against ShippingAddress JSON field
// Matches RCA_template.py fetch_salesforce_matches logic
async function getSalesforceMetadataByAddress(params: { 
  street: string; 
  city: string; 
  state: string; 
  postalCode: string;
  storeName?: string;
}) {
  console.log('Querying Salesforce_rawData for address:', params);
  
  // Query records that have Year Built or Square Footage data
  const sql = `
    SELECT Name, Year_Built__c, Net_RSF__c, ShippingAddress
    FROM dbo.Salesforce_rawData
    WHERE (Net_RSF__c IS NOT NULL OR Year_Built__c IS NOT NULL)
      AND Name IS NOT NULL
  `;
  const results = await universalQuery('Sites', sql);
  
  if (!results || !Array.isArray(results) || results.length === 0) {
    console.log('No results from Salesforce_rawData');
    return [];
  }
  
  console.log(`Retrieved ${results.length} records from Salesforce_rawData`);
  
  const targetStreet = normalizeAddress(params.street);
  const targetStoreName = (params.storeName || '').toLowerCase().trim();
  
  const scoredMatches: Array<{
    Name: string;
    Year_Built__c: any;
    Net_RSF__c: any;
    ShippingAddress: any;
    nameScore: number;
    addressScore: number;
    combinedScore: number;
    parsedStoreName: string;
    parsedAddress: string;
  }> = [];
  
  for (const record of results) {
    const sfName = record.Name || '';
    
    // Extract store brand from Name field (before the dash) - like RCA_template.py
    const sfStoreBrand = sfName.includes(' - ') ? sfName.split(' - ')[0].trim() : sfName;
    
    // Parse ShippingAddress to get street
    let sfStreet = '';
    const shippingAddress = parsePythonDict(record.ShippingAddress);
    
    if (shippingAddress && shippingAddress.street) {
      sfStreet = shippingAddress.street;
    } else if (sfName.includes(' - ')) {
      // Fallback: try to extract address from Name field (like RCA_template.py)
      const nameParts = sfName.split(' - ');
      if (nameParts.length >= 2) {
        const potentialAddress = nameParts[1].trim();
        // Check if it looks like an address
        if (/\d+/.test(potentialAddress) || 
            /(st|ave|rd|blvd|dr|way|lane|court)/i.test(potentialAddress)) {
          sfStreet = potentialAddress;
        }
      }
    }
    
    if (!sfStreet) continue;
    
    // Calculate fuzzy match scores (like RCA_template.py)
    const nameScoreFull = fuzzyMatchScore(targetStoreName, sfName.toLowerCase());
    const nameScoreBrand = fuzzyMatchScore(targetStoreName, sfStoreBrand.toLowerCase());
    const nameScore = Math.max(nameScoreFull, nameScoreBrand);
    
    const normalizedSfStreet = normalizeAddress(sfStreet);
    const addressScore = fuzzyMatchScore(targetStreet, normalizedSfStreet);
    
    // Combined score: 40% name, 60% address (like RCA_template.py)
    const combinedScore = (nameScore * 0.4) + (addressScore * 0.6);
    
    // Only include matches with some relevance
    if (combinedScore > 0.3 || addressScore > 0.5) {
      scoredMatches.push({
        Name: sfName,
        Year_Built__c: record.Year_Built__c,
        Net_RSF__c: record.Net_RSF__c,
        ShippingAddress: record.ShippingAddress,
        nameScore,
        addressScore,
        combinedScore,
        parsedStoreName: sfStoreBrand,
        parsedAddress: sfStreet,
      });
    }
  }
  
  // Sort by combined score descending and return top matches
  scoredMatches.sort((a, b) => b.combinedScore - a.combinedScore);
  
  console.log(`Found ${scoredMatches.length} matching records for address`);
  
  return scoredMatches.slice(0, 10);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params } = await req.json();
    console.log(`Database query action: ${action}`, params);

    let result;

    switch (action) {
      case 'healthCheck':
        result = await healthCheck();
        break;
      
      case 'getDatabases':
        result = await getDatabases();
        break;
      
      case 'getSites':
        result = await getSites(params);
        break;
      
      case 'getStortrackData':
        result = await getStortrackData(params.endpoint, params.queryParams);
        break;
      
      case 'queryDatabase':
        result = await queryDatabase(params.database, params.table, params.filters, params.limit);
        break;
      
      case 'getAnalytics':
        result = await getAnalytics(params.type);
        break;
      
      case 'getStorEdgeData':
        result = await getStorEdgeData(params.endpoint, params.queryParams);
        break;

      case 'getSalesforceMetadataByAddress':
        result = await getSalesforceMetadataByAddress(params);
        break;

      case 'getSalesforceByName':
        result = await getSalesforceByName(params.storeName);
        break;

      // Legacy actions mapped to SQL queries via universalQuery
      case 'getTrailing12MonthRates':
        {
          // Query rate data from Stortrack.dbo.Rates and Stores
          const storeIds = params.storeIds || [];
          if (storeIds.length === 0) {
            throw new Error('storeIds is required for getTrailing12MonthRates');
          }
          const storeIdList = storeIds.map((id: string | number) => `'${id}'`).join(',');
          const fromDate = params.fromDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const toDate = params.toDate || new Date().toISOString().split('T')[0];
          
          // Query rates with store info joined
          const rateSql = `
            SELECT 
              r.Store_ID,
              s.Name as Store_Name,
              s.Street_Address,
              s.City,
              s.State,
              s.Zip,
              r.Size,
              r.Width,
              r.Length,
              r.Spacetype,
              r.CC as Climate_Controlled,
              r.Humidity_Controlled,
              r.Drive_Up,
              r.Elevator,
              r.Outdoor_Access,
              r.Regular_Rate,
              r.Online_Rate,
              r.Promo,
              r.Date_Collected
            FROM dbo.Rates r
            LEFT JOIN dbo.Stores s ON r.Store_ID = s.ID
            WHERE r.Store_ID IN (${storeIdList})
            AND r.Date_Collected >= '${fromDate}'
            AND r.Date_Collected <= '${toDate}'
            ORDER BY r.Store_ID, r.Date_Collected DESC, r.Width, r.Length
          `;
          
          const rawResult = await universalQuery('Stortrack', rateSql);
          const rows = rawResult.results || [];
          
          // Transform to expected format: { ratesByStore, datesByStore }
          const ratesByStore: Record<number, any[]> = {};
          const datesByStore: Record<number, Set<string>> = {};
          
          for (const row of rows) {
            const storeId = row.Store_ID;
            
            if (!ratesByStore[storeId]) {
              ratesByStore[storeId] = [];
              datesByStore[storeId] = new Set();
            }
            
            // Build features string
            const features: string[] = [];
            if (row.Climate_Controlled) features.push('Climate Controlled');
            if (row.Humidity_Controlled) features.push('Humidity Controlled');
            if (row.Drive_Up) features.push('Drive Up');
            if (row.Elevator) features.push('Elevator');
            if (row.Outdoor_Access) features.push('Outdoor Access');
            
            // Add rate record in the expected format
            ratesByStore[storeId].push({
              storeId: storeId,
              storeName: row.Store_Name || '',
              address: row.Street_Address || '',
              city: row.City || '',
              state: row.State || '',
              zip: row.Zip || '',
              unitType: row.Spacetype || 'Standard',
              size: row.Size || '',
              width: row.Width,
              length: row.Length,
              features: features.join(', '),
              tag: row.Spacetype || 'Standard',
              climateControlled: !!row.Climate_Controlled,
              humidityControlled: !!row.Humidity_Controlled,
              driveUp: !!row.Drive_Up,
              elevator: !!row.Elevator,
              outdoorAccess: !!row.Outdoor_Access,
              walkInPrice: row.Regular_Rate,
              onlinePrice: row.Online_Rate,
              pctDifference: row.Regular_Rate && row.Online_Rate 
                ? ((row.Regular_Rate - row.Online_Rate) / row.Regular_Rate) * 100 
                : 0,
              date: row.Date_Collected || '',
              promo: row.Promo || '',
              source: 'Database' as const,
            });
            
            if (row.Date_Collected) {
              datesByStore[storeId].add(row.Date_Collected);
            }
          }
          
          // Convert datesByStore Sets to sorted arrays
          const datesByStoreArrays: Record<number, string[]> = {};
          for (const [storeId, dates] of Object.entries(datesByStore)) {
            datesByStoreArrays[Number(storeId)] = Array.from(dates).sort().reverse();
          }
          
          result = { ratesByStore, datesByStore: datesByStoreArrays };
        }
        break;
      
      case 'getStoreInfo':
        {
          // Query store info from Stortrack.dbo.Stores
          const storeIds = params.storeIds || [];
          if (storeIds.length === 0) {
            throw new Error('storeIds is required for getStoreInfo');
          }
          const storeIdList = storeIds.map((id: string | number) => `'${id}'`).join(',');
          
          const storeSql = `
            SELECT 
              ID as Store_ID,
              Name,
              Street_Address,
              City,
              State,
              Zip,
              Country,
              Phone,
              Latitude,
              Longitude
            FROM dbo.Stores
            WHERE ID IN (${storeIdList})
          `;
          result = await universalQuery('Stortrack', storeSql);
        }
        break;
      
      case 'getSalesforceMatches':
        // Use the improved fuzzy matching logic like RCA_template.py
        result = await getSalesforceMetadataByAddress({
          street: params.streetAddress || '',
          city: '',
          state: '',
          postalCode: '',
          storeName: params.storeName,
        });
        break;
      
      case 'getLatestRates':
        {
          // Query latest rates within a date range
          const storeIds = params.storeIds || [];
          if (storeIds.length === 0) {
            throw new Error('storeIds is required for getLatestRates');
          }
          const storeIdList = storeIds.map((id: string | number) => `'${id}'`).join(',');
          const daysBack = params.daysBack || 7;
          
          const latestRateSql = `
            SELECT 
              r.Store_ID,
              s.Name as Store_Name,
              s.Street_Address,
              s.City,
              s.State,
              s.Zip,
              r.Size,
              r.Width,
              r.Length,
              r.Spacetype,
              r.CC as Climate_Controlled,
              r.Humidity_Controlled,
              r.Drive_Up,
              r.Elevator,
              r.Outdoor_Access,
              r.Regular_Rate,
              r.Online_Rate,
              r.Promo,
              r.Date_Collected
            FROM dbo.Rates r
            LEFT JOIN dbo.Stores s ON r.Store_ID = s.ID
            WHERE r.Store_ID IN (${storeIdList})
            AND r.Date_Collected >= DATEADD(day, -${daysBack}, GETDATE())
            ORDER BY r.Store_ID, r.Date_Collected DESC, r.Width, r.Length
          `;
          result = await universalQuery('Stortrack', latestRateSql);
        }
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Database query error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
