import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// StorTrack API credentials from secrets
const STORTRACK_BASEURL = Deno.env.get('STORTRACK_BASEURL') || '';
const STORTRACK_USERNAME = Deno.env.get('STORTRACK_USERNAME') || '';
const STORTRACK_PASSWORD = Deno.env.get('STORTRACK_PASSWORD') || '';

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getAuthToken(): Promise<string | null> {
  // Check if we have a valid cached token
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const authUrl = `${STORTRACK_BASEURL.replace(/\/$/, '')}/authtoken`;
  
  try {
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: STORTRACK_USERNAME,
        password: STORTRACK_PASSWORD,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const token = data.access_token || data.token;
      if (token) {
        cachedToken = `Bearer ${token}`;
        // Token expires in 1 hour, refresh 5 minutes early
        tokenExpiry = Date.now() + (55 * 60 * 1000);
        return cachedToken;
      }
    }
    console.error('Auth token fetch failed:', response.status, await response.text());
  } catch (error) {
    console.error('Auth token exception:', error);
  }
  return null;
}

async function findStoresByAddress(params: {
  country?: string;
  state?: string;
  city?: string;
  zip?: string;
  storename?: string;
  companyname?: string;
}) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Failed to authenticate with StorTrack API');
  }

  const url = `${STORTRACK_BASEURL.replace(/\/$/, '')}/storesbyaddress`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'authorization': token,
    },
    body: JSON.stringify({
      country: params.country || 'United States',
      state: params.state || '',
      city: params.city || '',
      zip: params.zip || '',
      storename: params.storename || '',
      companyname: params.companyname || '',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Find stores failed:', response.status, errorText);
    throw new Error(`StorTrack API error: ${response.status}`);
  }

  const result = await response.json();
  return result.stores || [];
}

async function findCompetitors(params: {
  storeid?: number;
  masterid?: number;
  coveragezone?: number;
}) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Failed to authenticate with StorTrack API');
  }

  const url = `${STORTRACK_BASEURL.replace(/\/$/, '')}/findcompetitors`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'authorization': token,
    },
    body: JSON.stringify({
      storeid: params.storeid ? [params.storeid] : [],
      masterid: params.masterid ? [params.masterid] : [],
      coveragezone: params.coveragezone || 5.0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Find competitors failed:', response.status, errorText);
    throw new Error(`StorTrack API error: ${response.status}`);
  }

  return await response.json();
}

async function fetchHistoricalData(params: {
  storeid: number;
  from: string;
  to: string;
}, maxRetries = 3) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('Failed to authenticate with StorTrack API');
  }

  const url = `${STORTRACK_BASEURL.replace(/\/$/, '')}/historicaldata`;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'authorization': token,
        },
        body: JSON.stringify({
          storeid: params.storeid,
          masterid: 0,
          from: params.from,
          to: params.to,
          requestyear: 0,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return Array.isArray(result) ? result : [result];
      }

      // Handle rate limiting
      if (response.status === 429) {
        console.warn(`Rate limited on attempt ${attempt + 1}, waiting...`);
        await new Promise(r => setTimeout(r, 60000)); // Wait 1 minute
        continue;
      }

      // Handle server errors with retry
      if ([500, 503, 404].includes(response.status)) {
        console.warn(`Got ${response.status} on attempt ${attempt + 1}`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
          continue;
        }
      }

      const errorText = await response.text();
      console.error('Historical data failed:', response.status, errorText);
      throw new Error(`StorTrack API error: ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  throw new Error('Max retries exceeded');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params } = await req.json();
    console.log(`StorTrack API action: ${action}`, params);

    let result;

    switch (action) {
      case 'findStoresByAddress':
        result = await findStoresByAddress(params);
        break;
      case 'findCompetitors':
        result = await findCompetitors(params);
        break;
      case 'fetchHistoricalData':
        result = await fetchHistoricalData(params);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('StorTrack API error:', error);
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
