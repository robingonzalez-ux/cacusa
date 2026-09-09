#!/usr/bin/env python3
"""
Genera el bloque estático de JSON-LD (schema.org Product) para cada producto
disponible, a partir de data/products.json, y lo inyecta directo en el HTML
de ui_kits/store/index.html y en/ui_kits/store/index.html — entre los
marcadores STATIC_PRODUCT_SCHEMA:START/END.

Por qué existe: antes, el schema de producto solo se generaba con JavaScript
cuando alguien abría el modal de un producto (_injectProductSchema en el
propio index.html) — un bot que no ejecuta JS nunca lo veía. Este script
corre en un GitHub Action (.github/workflows/product-schema.yml) cada vez
que cambia data/products.json, así el HTML servido por GitHub Pages ya
trae el schema de los productos disponibles sin depender de que se
ejecute JavaScript.

No edites a mano el bloque entre los marcadores — se sobreescribe solo.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PRODUCTS_JSON = ROOT / "data" / "products.json"
BASE_URL = "https://cacusabytaitus.com"

MARKER_START = "<!-- STATIC_PRODUCT_SCHEMA:START -->"
MARKER_END = "<!-- STATIC_PRODUCT_SCHEMA:END -->"

TARGETS = [
    {"path": ROOT / "ui_kits" / "store" / "index.html", "store_path": "/ui_kits/store/", "lang": "es"},
    {"path": ROOT / "en" / "ui_kits" / "store" / "index.html", "store_path": "/en/ui_kits/store/", "lang": "en"},
]


def slugify(s):
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s[:60]


def product_param(p, lang):
    name = p.get("name_en") if (lang == "en" and p.get("name_en")) else p.get("name")
    slug = slugify(name)
    pid = p.get("id")
    return (slug + "-" + str(pid)) if slug else str(pid)


def product_images(p):
    images = p.get("images")
    if isinstance(images, list) and images:
        return images
    if p.get("imageUrl"):
        return [p["imageUrl"]]
    return []


def build_product_entry(p, lang, store_path):
    name = p.get("name_en") if (lang == "en" and p.get("name_en")) else p.get("name")
    desc = p.get("description_en") if (lang == "en" and p.get("description_en")) else p.get("description")
    url = f"{BASE_URL}{store_path}?p={product_param(p, lang)}"
    entry = {
        "@type": "Product",
        "name": name or "",
        "description": desc or name or "",
        "url": url,
        "brand": {"@type": "Brand", "name": "CACUSA by Taitus"},
        "offers": {
            "@type": "Offer",
            "priceCurrency": "USD",
            "price": str(p.get("price", "")),
            "availability": "https://schema.org/InStock",
            "url": url,
        },
    }
    images = product_images(p)
    if images:
        entry["image"] = images
    if p.get("material"):
        entry["material"] = p["material"]
    return entry


def build_schema_block(products, lang, store_path):
    entries = [
        build_product_entry(p, lang, store_path)
        for p in products
        if p.get("available") is not False
    ]
    graph = {"@context": "https://schema.org", "@graph": entries}
    payload = json.dumps(graph, ensure_ascii=False, separators=(",", ":"))
    return (
        f'{MARKER_START}\n'
        f'<!-- Generado automáticamente desde data/products.json — no editar a mano, ver .github/workflows/product-schema.yml -->\n'
        f'<script type="application/ld+json" id="ld-products-static">{payload}</script>\n'
        f'{MARKER_END}'
    )


def inject(path: Path, block: str) -> bool:
    html = path.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END), re.DOTALL)
    if pattern.search(html):
        new_html = pattern.sub(lambda _: block, html)
    else:
        if "</head>" not in html:
            raise RuntimeError(f"No se encontró </head> en {path}")
        new_html = html.replace("</head>", block + "\n</head>", 1)
    if new_html == html:
        return False
    path.write_text(new_html, encoding="utf-8")
    return True


def main():
    data = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))
    products = data.get("products", [])
    changed_any = False
    for target in TARGETS:
        block = build_schema_block(products, target["lang"], target["store_path"])
        changed = inject(target["path"], block)
        changed_any = changed_any or changed
        print(f"{target['path']}: {'actualizado' if changed else 'sin cambios'}")
    if "--check" in sys.argv:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    main()
