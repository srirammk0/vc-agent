import os
from firecrawl import FirecrawlApp

app = FirecrawlApp(api_key=os.environ["FIRECRAWL_API_KEY"])


async def firecrawl_scrape(url: str) -> dict:
    """Scrape a startup's website or profile page for structured details."""
    result = app.scrape_url(
        url,
        params={
            "formats": ["markdown"],
            "actions": [],
        },
    )
    return {
        "url": url,
        "content": result.get("markdown", "")[:4000],
    }
