export const linkup = {
  search: async (params: { query: string; depth: string; outputType?: string }) => {
    try {
      const response = await fetch('https://api.linkup.so/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINKUP_API_KEY}`
        },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        throw new Error(`Linkup search error: ${response.statusText}`);
      }
      return await response.json();
    } catch (e) {
      console.error('[Linkup Search]', e);
      return { results: [] };
    }
  },

  fetch: async (params: { url: string; renderJS?: boolean }) => {
    // Note: This endpoint simulates linkup's content extraction (or generic fetch)
    try {
      // Assuming linkup provides a /v1/fetch endpoint or similar
      const response = await fetch('https://api.linkup.so/v1/fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINKUP_API_KEY}`
        },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        throw new Error(`Linkup fetch error: ${response.statusText}`);
      }
      return await response.json();
    } catch (e) {
      console.error('[Linkup Fetch]', e);
      return { content: "" };
    }
  }
};
