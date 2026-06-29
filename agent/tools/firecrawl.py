import asyncio
import os
from firecrawl import FirecrawlApp

# Initialize FirecrawlApp (will pick up FIRECRAWL_API_KEY from environment)
try:
    firecrawl_app = FirecrawlApp(api_key=os.environ.get("FIRECRAWL_API_KEY", ""))
except Exception:
    firecrawl_app = None

async def scrape_page(url: str) -> str:
    """
    Scrape a single page using Firecrawl (e.g., company website or LinkedIn profile).
    Returns the markdown content.
    """
    if not firecrawl_app:
        return "Firecrawl API not configured."
        
    try:
        res = await asyncio.to_thread(
            firecrawl_app.scrape_url, 
            url, 
            params={'formats': ['markdown']}
        )
        # Handle dict response
        if isinstance(res, dict):
            return res.get('markdown', str(res))
        return str(res)
    except Exception as e:
        return f"Error scraping {url}: {e}"
