import asyncio
import os
from exa_py import Exa

exa = Exa(api_key=os.environ.get("EXA_API_KEY", ""))


async def search_company(query: str) -> list[dict]:
    """Search Exa for company profiles using the 'company' category."""
    try:
        res = await asyncio.to_thread(
            exa.search,
            query,
            category="company",
            num_results=3,
            contents={"text": {"max_characters": 1000}},
        )
        return [
            {
                "url": r.url,
                "title": r.title,
                "text": r.text[:1000] if r.text else ""
            }
            for r in getattr(res, "results", [])
        ]
    except Exception as e:
        print(f"Exa company search failed: {e}")
        return []


async def search_people(query: str) -> list[dict]:
    """Search Exa for people profiles using the 'people' category."""
    try:
        res = await asyncio.to_thread(
            exa.search,
            query,
            category="people",
            num_results=3,
            contents={"text": {"max_characters": 1000}},
        )
        return [
            {
                "url": r.url,
                "title": r.title,
                "text": r.text[:1000] if r.text else ""
            }
            for r in getattr(res, "results", [])
        ]
    except Exception as e:
        print(f"Exa people search failed: {e}")
        return []

