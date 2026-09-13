#!/usr/bin/env python3
"""
Genera el catálogo de respaldo dentro de <noscript> — el único contenido de
producto que ve un bot/IA que no ejecuta JavaScript — a partir de
data/products.json, y lo inyecta en ui_kits/store/index.html y
en/ui_kits/store/index.html entre los marcadores
<!--NOSCRIPT_PRODUCTS_START/END-->.

Por qué existe: ese bloque se había escrito a mano una sola vez y quedó
desactualizado según se agregaban/editaban/borraban productos desde el panel
admin (74 productos ahí vs. el catálogo real; y 68 de esos 74 tenían el
título en español mezclado con el nombre en inglés — "Nombre / Name" — un
error de cuando se generó la primera vez). Corre en el mismo GitHub Action
que ya regenera el JSON-LD y el sitemap (.github/workflows/product-schema.yml)
cada vez que cambia data/products.json, así este catálogo nunca vuelve a
quedarse atrás.

Reusa el mismo slugify()/product_param() que generate_product_schema.py —
deben producir siempre el mismo slug que el JS del cliente
(_slugify/_productParam en ui_kits/store/index.html).

No edites a mano el bloque entre los marcadores — se sobreescribe solo.
"""
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PRODUCTS_JSON = ROOT / "data" / "products.json"

MARKER_START = "<!--NOSCRIPT_PRODUCTS_START-->"
MARKER_END = "<!--NOSCRIPT_PRODUCTS_END-->"

# Mismo orden que config.categories en data/products.json, y misma traducción
# ES→EN que ya usa llms.txt — si se agrega una categoría nueva al catálogo,
# agregarla acá también.
CATEGORY_LABELS = {
    "Cadenas": "Chains",
    "Aretes": "Earrings",
    "Anillos": "Rings",
    "Hombres": "Men",
    "Pulseras": "Bracelets",
    "Ear cuff": "Ear Cuff",
    "Parejas": "Couples",
    "Juegos": "Sets",
    "Hand chain": "Hand Chain",
}

TARGETS = [
    {
        "path": ROOT / "ui_kits" / "store" / "index.html",
        "lang": "es",
        "aria_label": "Catálogo de productos CACUSA by Taitus",
        "h2": "Catálogo de joyería personalizada CACUSA by Taitus",
        "intro": (
            "Bisutería y joyería artesanal hecha a mano en plata 925, baño de oro 18k "
            "y acero inoxidable. Personalización con nombre, inicial, fecha o mensaje. "
            "Envíos a Ecuador y Estados Unidos."
        ),
        "home_href": "/",
        "home_text": "CACUSA by Taitus — página principal",
    },
    {
        "path": ROOT / "en" / "ui_kits" / "store" / "index.html",
        "lang": "en",
        "aria_label": "CACUSA by Taitus product catalog",
        "h2": "CACUSA by Taitus personalized jewelry catalog",
        "intro": (
            "Handmade artisanal jewelry in 925 silver, 18k gold plating and stainless "
            "steel. Personalization with name, initial, date or message. Shipping to "
            "the USA and Ecuador."
        ),
        "home_href": "/en/",
        "home_text": "CACUSA by Taitus — home page",
    },
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


def esc(s):
    return html.escape(str(s or ""), quote=False).replace("'", "&#x27;")


def group_by_category(products, categories_order):
    groups = {}
    for p in products:
        groups.setdefault(p.get("category") or "", []).append(p)
    ordered = [c for c in categories_order if c in groups]
    ordered += sorted(c for c in groups if c not in categories_order and c)
    return [(c, groups[c]) for c in ordered]


def build_catalog_block(products, categories_order, target):
    lang = target["lang"]
    lines = [
        MARKER_START,
        "<!-- Generado automáticamente desde data/products.json — no editar a mano, ver .github/workflows/product-schema.yml -->",
        "<noscript>",
        f'<section aria-label="{esc(target["aria_label"])}">',
        f'<h2>{esc(target["h2"])}</h2>',
        f"<p>{esc(target['intro'])}</p>",
    ]
    for category, items in group_by_category(products, categories_order):
        label = CATEGORY_LABELS.get(category, category) if lang == "en" else category
        lines.append(f"<h3>{esc(label)}</h3>")
        lines.append("<ul>")
        for p in items:
            name = p.get("name_en") if (lang == "en" and p.get("name_en")) else p.get("name")
            desc = p.get("description_en") if (lang == "en" and p.get("description_en")) else p.get("description")
            href = "?p=" + product_param(p, lang)
            price = p.get("price", "")
            bits = f'<li><a href="{esc(href)}">{esc(name)}</a> — ${esc(price)}.'
            if desc:
                bits += f" {esc(desc)}"
            bits += "</li>"
            lines.append(bits)
        lines.append("</ul>")
    lines.append(f'<p><a href="{esc(target["home_href"])}">{esc(target["home_text"])}</a></p>')
    lines.append("</section>")
    lines.append("</noscript>")
    lines.append(MARKER_END)
    return "\n".join(lines)


def inject(path: Path, block: str) -> bool:
    html_text = path.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END), re.DOTALL)
    if not pattern.search(html_text):
        raise RuntimeError(f"No se encontraron los marcadores NOSCRIPT_PRODUCTS en {path}")
    new_html = pattern.sub(lambda _: block, html_text)
    if new_html == html_text:
        return False
    path.write_text(new_html, encoding="utf-8")
    return True


def main():
    data = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))
    products = [p for p in data.get("products", []) if p.get("available") is not False]
    categories_order = data.get("config", {}).get("categories", [])
    changed_any = False
    for target in TARGETS:
        block = build_catalog_block(products, categories_order, target)
        changed = inject(target["path"], block)
        changed_any = changed_any or changed
        print(f"{target['path']}: {'actualizado' if changed else 'sin cambios'}")
    if "--check" in sys.argv:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    main()
