"""Fixed-origin Google / DuckDuckGo transport. Credentials arrive on stdin, never in argv.

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
    engine = data.get("engine", "google")
    if engine not in ("google", "duckduckgo"):
        raise ValueError("engine")
    if not isinstance(query, str) or not 2 <= len(query) <= 160:
        raise ValueError("query")
    if not isinstance(region, str) or len(region) != 2 or not region.isalpha():
        raise ValueError("region")
    if language not in ("en", "zh-CN"):
        raise ValueError("language")
    if urlsplit(proxy).scheme not in ("http", "https"):
        raise ValueError("proxy")
    timeout_ms = data.get("timeoutMs", 18000)
    if not isinstance(timeout_ms, int) or not 1000 <= timeout_ms <= 18000:
        raise ValueError("timeout")
    chunks, size = [], 0

    def receive(chunk):
        nonlocal size
        size += len(chunk)
        if size > 1_000_000:
            return 0
        chunks.append(chunk)
        return len(chunk)

    if engine == "google":
        endpoint = "https://www.google.com/wml/search"
        params = {"q": query, "hl": language, "gl": region.lower(),
                  "ie": "utf8", "oe": "utf8", "sca_esv": "1"}
        headers = {"User-Agent": "Nokia6230i/2.0 (03.80) Profile/MIDP-2.0 Configuration/CLDC-1.1",
                   "Accept": "*/*"}
        profile = "chrome99_android"
        cookies = {"CONSENT": "YES+"}
    else:
        endpoint = "https://lite.duckduckgo.com/lite/"
        # kl is a supported market, not an arbitrary country/language pairing.
        # Other requested regions use worldwide results, identified in the report.
        markets = {"US": "us-en", "GB": "uk-en", "CA": "ca-en", "AU": "au-en",
                   "CN": "cn-zh", "TW": "tw-tzh", "HK": "hk-tzh", "DE": "de-de",
                   "FR": "fr-fr", "JP": "jp-jp", "KR": "kr-kr", "IN": "in-en"}
        params = {"q": query, "kl": markets.get(region.upper(), "wt-wt")}
        headers = {"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5" if language == "zh-CN" else "en-US,en;q=0.9"}
        profile = "chrome"
        cookies = {}
    with requests.Session() as session:
        response = session.get(
            endpoint, params=params, headers=headers, cookies=cookies,
            proxy=proxy, impersonate=profile, timeout=timeout_ms / 1000,
            allow_redirects=False, content_callback=receive,
        )
        print(json.dumps({
            "status": response.status_code,
            "region": region.upper() if engine == "google" or region.upper() in markets else "GLOBAL",
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
