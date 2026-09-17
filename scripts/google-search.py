"""Fixed-origin Google transport. Credentials arrive on stdin, never in argv.

The mobile endpoint is also used by SearXNG's Google engine. This independent
transport uses curl_cffi's Android TLS profile; it executes no downloaded code.
"""
import json
import sys
from urllib.parse import urlsplit


def main():
    from curl_cffi import requests

    data = json.loads(sys.stdin.read(16_384))
    query, region, language = data["query"], data["region"], data["language"]
    proxy = data["proxy"]
    if not isinstance(query, str) or not 2 <= len(query) <= 160:
        raise ValueError("query")
    if not isinstance(region, str) or len(region) != 2 or not region.isalpha():
        raise ValueError("region")
    if language not in ("en", "zh-CN"):
        raise ValueError("language")
    if urlsplit(proxy).scheme not in ("http", "https"):
        raise ValueError("proxy")
    chunks, size = [], 0

    def receive(chunk):
        nonlocal size
        size += len(chunk)
        if size > 1_000_000:
            return 0
        chunks.append(chunk)
        return len(chunk)

    with requests.Session() as session:
        response = session.get(
            "https://www.google.com/wml/search",
            params={"q": query, "hl": language, "gl": region.lower(),
                    "ie": "utf8", "oe": "utf8", "sca_esv": "1"},
            headers={"User-Agent": "Nokia6230i/2.0 (03.80) Profile/MIDP-2.0 Configuration/CLDC-1.1",
                     "Accept": "*/*"},
            cookies=data.get("cookies", {}),
            proxy=proxy, impersonate="chrome99_android", timeout=25,
            allow_redirects=False, content_callback=receive,
        )
        print(json.dumps({
            "status": response.status_code,
            "bytes": response.download_size + response.header_size + response.request_size,
            "html": b"".join(chunks).decode("utf-8", errors="replace"),
            "cookies": {c.name: c.value for c in response.cookies.jar
                        if c.domain in (".google.com", "www.google.com", "google.com")},
        }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Provider exceptions can contain the authenticated proxy URL.
        print(json.dumps({"error": "search_transport"}))
