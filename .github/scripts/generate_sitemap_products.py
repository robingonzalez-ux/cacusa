#!/usr/bin/env python3
"""
Agrega/actualiza en sitemap.xml una URL propia por cada producto disponible
(ES + EN), a partir de data/products.json — entre los marcadores
STATIC_PRODUCT_URLS:START/END.

Reusa exactamente la misma lógica de slugs que generate_product_schema.py
(product_param), así las URLs del sitemap coinciden 1:1 con las que ya
genera el JavaScript del lado del cliente (_productParam en ui_kits/store).

Corre automático vía .github/workflows/product-schema.yml cada vez que
cambia data/products.json — así cuando Tita o Robin agregan o eliminan un
producto desde el panel admin, el sitemap se actualiza solo, sin que nadie
tenga que acordarse de tocarlo a mano.

No edites a mano el bloque entre los marcadores — se sobreescribe solo.
"""
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_product_schema import BASE_URL, PRODUCTS_JSON, ROOT, product_param  # noqa: E402
import json

SITEMAP = ROOT / "sitemap.xml"
MARKER_START = "  <!-- STATIC_PRODUCT_URLS:START -->"
MARKER_END = "  <!-- STATIC_PRODUCT_URLS:END -->"


def url_entry(loc, es_url, en_url, lastmod):
    return (
        "  <url>\n"
        f"    <loc>{loc}</loc>\n"
        f'    <xhtml:link rel="alternate" hreflang="es" href="{es_url}"/>\n'
        f'    <xhtml:link rel="alternate" hreflang="en" href="{en_url}"/>\n'
        f'    <xhtml:link rel="alternate" hreflang="x-default" href="{es_url}"/>\n'
        f"    <lastmod>{lastmod}</lastmod>\n"
        "    <changefreq>weekly</changefreq>\n"
        "    <priority>0.6</priority>\n"
        "  </url>"
    )


def build_block(products, lastmod):
    parts = []
    for p in products:
        es_url = f"{BASE_URL}/ui_kits/store/?p={product_param(p, 'es')}"
        en_url = f"{BASE_URL}/en/ui_kits/store/?p={product_param(p, 'en')}"
        parts.append(url_entry(es_url, es_url, en_url, lastmod))
        parts.append(url_entry(en_url, es_url, en_url, lastmod))
    return MARKER_START + "\n" + "\n\n".join(parts) + "\n" + MARKER_END


def inject(path: Path, block: str) -> bool:
    xml = path.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END), re.DOTALL)
    if pattern.search(xml):
        new_xml = pattern.sub(lambda _: block, xml)
    else:
        if "</urlset>" not in xml:
            raise RuntimeError(f"No se encontró </urlset> en {path}")
        new_xml = xml.replace("</urlset>", block + "\n\n</urlset>", 1)
    if new_xml == xml:
        return False
    path.write_text(new_xml, encoding="utf-8")
    return True


def main():
    data = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))
    products = [p for p in data.get("products", []) if p.get("available") is not False]
    lastmod = date.today().isoformat()
    block = build_block(products, lastmod)
    changed = inject(SITEMAP, block)
    print(f"{SITEMAP}: {'actualizado' if changed else 'sin cambios'} ({len(products)} productos)")
    if "--check" in sys.argv:
        sys.exit(1 if changed else 0)


if __name__ == "__main__":
    main()
