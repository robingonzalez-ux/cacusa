#!/usr/bin/env python3
"""Avisa a Bing (y demás buscadores de IndexNow) de todas las URLs de sitemap.xml.

IndexNow: https://www.indexnow.org — un POST con la lista de URLs; la llave es pública
por diseño (el archivo <llave>.txt en la raíz del sitio prueba que el dominio es nuestro).
Nunca falla el workflow: si IndexNow responde mal, solo lo imprime.

Uso: python3 .github/scripts/indexnow_ping.py [--dry-run]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

HOST = "cacusabytaitus.com"
KEY = "cacusa-indexnow-key-a3f8b2e1d4c7"
KEY_LOCATION = f"https://{HOST}/{KEY}.txt"
ENDPOINT = "https://api.indexnow.org/indexnow"
BATCH = 10000  # límite por pedido de IndexNow

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def sitemap_urls():
    with open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8") as f:
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", f.read())
    seen, out = set(), []
    for u in locs:
        # Solo URLs del propio dominio (IndexNow rechaza el lote entero si hay otro host).
        if u.startswith(f"https://{HOST}/") and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def main():
    dry = "--dry-run" in sys.argv
    urls = sitemap_urls()
    print(f"IndexNow: {len(urls)} URLs de sitemap.xml")
    if not urls:
        return 0
    for i in range(0, len(urls), BATCH):
        body = {"host": HOST, "key": KEY, "keyLocation": KEY_LOCATION, "urlList": urls[i:i + BATCH]}
        if dry:
            print(json.dumps({**body, "urlList": body["urlList"][:3] + ["…"]}, ensure_ascii=False, indent=2))
            continue
        req = urllib.request.Request(
            ENDPOINT, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json; charset=utf-8"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f"IndexNow: HTTP {r.status} ({len(body['urlList'])} URLs)")
        except urllib.error.HTTPError as e:
            print(f"IndexNow: HTTP {e.code} — {e.read().decode('utf-8', 'replace')[:300]}")
        except Exception as e:  # red caída, timeout, etc.
            print(f"IndexNow: no se pudo enviar ({e})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
