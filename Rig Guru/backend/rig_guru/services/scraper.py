from __future__ import annotations

from typing import Dict
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup


def _fallback_payload(keyword: str) -> Dict[str, object]:
    return {
        "Product Name": keyword or "Unknown Product",
        "Price": 0.00,
        "Stock Status": "Unknown",
    }


async def fetch_live_data(keyword: str) -> Dict[str, object]:
    """
    Simulate searching a tech hardware site and return product market data.

    Returns:
        dict: {
            "Product Name": str,
            "Price": float,
            "Stock Status": str
        }
    """
    fallback = _fallback_payload(keyword)
    cleaned_keyword = (keyword or "").strip()

    if not cleaned_keyword:
        return fallback

    search_url = f"https://www.newegg.com/p/pl?d={quote_plus(cleaned_keyword)}"
    timeout = httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    }

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(search_url, headers=headers)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        product_name = fallback["Product Name"]
        price_value = fallback["Price"]
        stock_status = fallback["Stock Status"]

        title_node = (
            soup.select_one(".item-cell .item-title")
            or soup.select_one(".item-title")
            or soup.select_one("a.item-title")
            or soup.find("h1")
        )
        if title_node and title_node.get_text(strip=True):
            product_name = title_node.get_text(strip=True)

        price_node = (
            soup.select_one(".item-cell .price-current")
            or soup.select_one(".price-current")
            or soup.select_one("[data-test='product-price']")
            or soup.find(attrs={"class": lambda value: value and "price" in value.lower()})
        )
        if price_node:
            raw_price = price_node.get_text(" ", strip=True)
            normalized = (
                raw_price.replace("$", "")
                .replace(",", "")
                .replace("USD", "")
                .strip()
            )
            numeric_chars = "".join(ch for ch in normalized if ch.isdigit() or ch == ".")
            if numeric_chars:
                try:
                    price_value = float(numeric_chars)
                except ValueError:
                    price_value = fallback["Price"]

        stock_node = (
            soup.select_one(".item-cell .item-promo")
            or soup.select_one(".stock")
            or soup.select_one(".inventory")
            or soup.find(
                attrs={
                    "class": lambda value: value
                    and any(token in value.lower() for token in ["stock", "inventory", "availability"])
                }
            )
        )
        if stock_node and stock_node.get_text(strip=True):
            stock_status = stock_node.get_text(strip=True)

        return {
            "Product Name": product_name,
            "Price": price_value,
            "Stock Status": stock_status,
        }

    except (httpx.TimeoutException, httpx.RequestError, httpx.HTTPStatusError):
        return fallback
    except Exception:
        return fallback
