#!/usr/bin/env python3
"""
Genera una página estática REAL por producto y por categoría (ES + EN) —
ui_kits/store/producto/<slug>-<id>/index.html,
ui_kits/store/categoria/<slug>/index.html, y sus equivalentes en/.

Por qué existe: ?p=/?cat= son query strings sobre el mismo archivo
ui_kits/store/index.html — GitHub Pages sirve el mismo HTML sin importar
el query, así que canonical/hreflang/H1 nunca podían ser correctos desde
el primer byte para una ficha o categoría puntual (JavaScript los corregía
recién después de renderizar, cuando Google ya vio la versión genérica).
Auditoría SEO del 19 sep, hallazgos SEO-01/03/04/06.

Cada página generada es una copia del archivo de la tienda ya regenerado
(mismo CSS/JS/carrito/checkout — la SPA sigue funcionando igual una vez
que carga), con:
  - <title>, meta description, canonical, hreflang y H1 correctos para
    ESE producto/categoría desde el HTML crudo.
  - El bloque STATIC_PRODUCT_SCHEMA (todo el catálogo, ~150KB) reemplazado
    por un JSON-LD liviano de solo esa ficha/categoría — repetir el
    catálogo completo en cada una de estas ~172 páginas infla el peso de
    la página sin necesidad (hallazgo SEO-10 de la misma auditoría).
  - Un <script> chico al ppio del <head> con
    window.__CACUSA_STATIC_PRODUCT_ID / __CACUSA_STATIC_CATEGORY — el
    boot de la SPA (ui_kits/store/index.html) lo usa como respaldo de
    ?p=/?cat= para saber qué abrir/filtrar sin depender de un query
    string que esta URL ya no lleva.
  - Los 6-7 enlaces relativos (../../cuidados.html, etc.) corregidos para
    la profundidad extra de carpetas (producto/<algo>/, categoria/<algo>/
    cuelgan 2 niveles más abajo que ui_kits/store/).

Corre en el mismo GitHub Action que ya regenera JSON-LD/sitemap/noscript
(.github/workflows/product-schema.yml), DESPUÉS de generate_product_schema.py
(para partir del archivo base ya actualizado) y generate_sitemap_products.py
(para reusar las mismas URLs que ya quedaron en el sitemap).

No edites a mano ninguno de los archivos generados — se sobreescriben
enteros en cada corrida.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_product_schema import (  # noqa: E402
    BASE_URL,
    PRODUCTS_JSON,
    ROOT,
    build_product_entry,
    build_shipping_details,
    fetch_reviews_by_product,
    fetch_surcharges,
    json_for_script_tag,
    priced,
    product_page_url,
    product_param,
    slugify,
)
from generate_noscript_catalog import CATEGORY_LABELS  # noqa: E402

SCHEMA_MARKER_START = "<!-- STATIC_PRODUCT_SCHEMA:START -->"
SCHEMA_MARKER_END = "<!-- STATIC_PRODUCT_SCHEMA:END -->"

# Mismas descripciones que CATEGORY_DESC_ES/EN en ui_kits/store/index.html
# (_updateCategorySeo) — duplicadas a propósito, igual que CATEGORY_LABELS en
# generate_noscript_catalog.py: no hay forma de compartir el objeto entre el
# JS del cliente y este script sin un paso de build. Si se edita una acá,
# editar también la otra copia en el <script> de la tienda.
CATEGORY_DESC_ES = {
    "cadenas": "Cadenas y collares artesanales en plata 925, baño de oro 18k y acero inoxidable — con dijes y personalización disponible por WhatsApp.",
    "aretes": "Aretes artesanales personalizados en plata 925, baño de oro 18k y acero inoxidable — desde argollas hasta ear cuffs.",
    "anillos": "Anillos artesanales ajustables y de talla fija en plata 925, baño de oro 18k y acero inoxidable — grabado personalizado disponible.",
    "hombres": "Joyería para hombre: cadenas, anillos y pulseras en acero inoxidable y baño de oro 18k, resistentes para el uso diario.",
    "pulseras": "Pulseras artesanales tejidas y en cadena, en plata 925, baño de oro 18k y acero inoxidable — con opción de personalización.",
    "ear cuff": "Ear cuffs artesanales sin necesidad de perforación, en baño de oro 18k y acero inoxidable, para un look moderno.",
    "parejas": "Piezas a juego para parejas — anillos, cadenas y pulseras que se complementan, ideales para regalar en San Valentín o aniversario.",
    "juegos": "Juegos y sets de joyería a conjunto (aretes, cadena y pulsera) en plata 925 y baño de oro 18k, listos para regalar.",
    "hand chain": "Hand chains artesanales que combinan anillo y pulsera en una sola pieza, en baño de oro 18k y acero inoxidable.",
}
CATEGORY_DESC_EN = {
    "cadenas": "Handmade chains and necklaces in 925 silver, 18k gold plating and stainless steel — with charms and personalization available via WhatsApp.",
    "aretes": "Handmade personalized earrings in 925 silver, 18k gold plating and stainless steel — from hoops to ear cuffs.",
    "anillos": "Handmade adjustable and fixed-size rings in 925 silver, 18k gold plating and stainless steel — custom engraving available.",
    "hombres": "Men's jewelry: chains, rings and bracelets in stainless steel and 18k gold plating, built for everyday wear.",
    "pulseras": "Handmade woven and chain bracelets in 925 silver, 18k gold plating and stainless steel — personalization available.",
    "ear cuff": "Handmade ear cuffs with no piercing needed, in 18k gold plating and stainless steel, for a modern look.",
    "parejas": "Matching pieces for couples — rings, chains and bracelets that pair together, perfect for Valentine's Day or anniversaries.",
    "juegos": "Jewelry sets (earrings, chain and bracelet) in 925 silver and 18k gold plating, ready to gift.",
    "hand chain": "Handmade hand chains combining a ring and bracelet in one piece, in 18k gold plating and stainless steel.",
}

TARGETS = [
    {"base": ROOT / "ui_kits" / "store" / "index.html", "lang": "es", "store_path": "/ui_kits/store/"},
    {"base": ROOT / "en" / "ui_kits" / "store" / "index.html", "lang": "en", "store_path": "/en/ui_kits/store/"},
]


def attr_esc(s):
    return (
        str(s or "")
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def text_esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def set_title(html_text, value):
    return re.sub(r"<title>.*?</title>", "<title>" + text_esc(value) + "</title>", html_text, count=1, flags=re.DOTALL)


def set_meta_content(html_text, elem_id, value):
    pattern = re.compile(r'(id="' + re.escape(elem_id) + r'"[^>]*?content=")[^"]*(")')
    return pattern.sub(lambda m: m.group(1) + attr_esc(value) + m.group(2), html_text, count=1)


def set_link_href(html_text, elem_id, value):
    pattern = re.compile(r'(id="' + re.escape(elem_id) + r'"[^>]*?href=")[^"]*(")')
    return pattern.sub(lambda m: m.group(1) + attr_esc(value) + m.group(2), html_text, count=1)


def set_h1(html_text, value):
    return re.sub(
        r'(<h1 class="store-hero-h">)[^<]*(</h1>)',
        lambda m: m.group(1) + text_esc(value) + m.group(2),
        html_text,
        count=1,
    )


def fix_relative_depth(html_text, extra_levels):
    """Las páginas nuevas cuelgan `extra_levels` carpetas más abajo que el archivo
    base (ui_kits/store/index.html o en/ui_kits/store/index.html) — cada href/src
    relativo (../../cuidados.html, './', etc.) necesita esos mismos niveles de más
    para seguir apuntando al mismo destino de siempre."""
    prefix = "../" * extra_levels
    pattern = re.compile(r'((?:href|src)=["\'])(\.\.?/)')
    return pattern.sub(lambda m: m.group(1) + prefix + m.group(2), html_text)


def replace_schema_block(html_text, new_block):
    pattern = re.compile(re.escape(SCHEMA_MARKER_START) + r".*?" + re.escape(SCHEMA_MARKER_END), re.DOTALL)
    if not pattern.search(html_text):
        raise RuntimeError("No se encontró STATIC_PRODUCT_SCHEMA en el archivo base")
    return pattern.sub(lambda _: new_block, html_text)


def inject_static_var(html_text, js_line):
    return html_text.replace("<head>", "<head>\n  <script>" + js_line + "</script>", 1)


def build_product_page(base_html, p, lang, store_path, extra_levels, shipping_details, reviews_by_product, surcharges):
    name = p.get("name_en") if (lang == "en" and p.get("name_en")) else p.get("name")
    desc = p.get("description_en") if (lang == "en" and p.get("description_en")) else p.get("description")
    url = product_page_url(p, lang, store_path)
    title = f"{name} — CACUSA by Taitus"
    meta_desc = (desc or name or "")[:160]
    images = p.get("images") if isinstance(p.get("images"), list) and p.get("images") else (
        [p["imageUrl"]] if p.get("imageUrl") else []
    )
    store_label = "Store" if lang == "en" else "Tienda"
    entry = build_product_entry(p, lang, store_path, shipping_details, reviews_by_product, surcharges)
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "CACUSA", "item": BASE_URL},
                    {"@type": "ListItem", "position": 2, "name": store_label, "item": f"{BASE_URL}{store_path}"},
                    {"@type": "ListItem", "position": 3, "name": name, "item": url},
                ],
            },
            entry,
        ],
    }
    schema_block = (
        f"{SCHEMA_MARKER_START}\n"
        f"<!-- Generado automáticamente — no editar a mano, ver .github/workflows/product-schema.yml -->\n"
        f'<script type="application/ld+json" id="ld-product">{json_for_script_tag(graph)}</script>\n'
        f"{SCHEMA_MARKER_END}"
    )

    html_text = base_html
    html_text = set_title(html_text, title)
    html_text = set_meta_content(html_text, "meta-desc", meta_desc)
    html_text = set_link_href(html_text, "canonicalLink", url)
    es_slug = product_param(p, "es")
    en_slug = product_param(p, "en")
    es_url = product_page_url(p, "es", "/ui_kits/store/")
    en_url = product_page_url(p, "en", "/en/ui_kits/store/")
    html_text = set_link_href(html_text, "hreflangEs", es_url)
    html_text = set_link_href(html_text, "hreflangEn", en_url)
    html_text = set_link_href(html_text, "hreflangDefault", es_url)
    html_text = set_h1(html_text, name)
    html_text = set_meta_content(html_text, "og-url", url)
    html_text = set_meta_content(html_text, "og-title", title)
    html_text = set_meta_content(html_text, "og-description", desc or name or "")
    if images:
        html_text = set_meta_content(html_text, "og-image", images[0])
    html_text = set_meta_content(html_text, "tw-title", title)
    html_text = set_meta_content(html_text, "tw-description", desc or name or "")
    if images:
        html_text = set_meta_content(html_text, "tw-image", images[0])
    html_text = replace_schema_block(html_text, schema_block)
    html_text = inject_static_var(html_text, f"window.__CACUSA_STATIC_PRODUCT_ID = {json.dumps(str(p.get('id')))};")
    html_text = fix_relative_depth(html_text, extra_levels)
    return html_text


def build_category_page(base_html, cat, lang, store_path, extra_levels, products):
    key = cat.lower()
    label = CATEGORY_LABELS.get(cat, cat) if lang == "en" else cat
    desc = (CATEGORY_DESC_EN if lang == "en" else CATEGORY_DESC_ES).get(key) or (
        f"Handmade {label} — personalized jewelry in 925 silver, 18k gold plating and stainless steel."
        if lang == "en"
        else f"{label} artesanales — joyería personalizada en plata 925, baño de oro 18k y acero inoxidable."
    )
    cat_slug = slugify(cat)
    url = f"{BASE_URL}{store_path}categoria/{cat_slug}/"
    es_url = f"{BASE_URL}/ui_kits/store/categoria/{cat_slug}/"
    en_url = f"{BASE_URL}/en/ui_kits/store/categoria/{cat_slug}/"
    title = f"{label} — CACUSA by Taitus"
    cat_products = [p for p in products if p.get("category") == cat and p.get("available") is not False]
    first_img = None
    if cat_products:
        imgs = cat_products[0].get("images")
        first_img = (imgs[0] if isinstance(imgs, list) and imgs else cat_products[0].get("imageUrl"))
    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": i + 1,
                "url": product_page_url(p, lang, store_path),
                "name": (p.get("name_en") if (lang == "en" and p.get("name_en")) else p.get("name")),
            }
            for i, p in enumerate(cat_products[:30])
        ],
    }
    schema_block = (
        f"{SCHEMA_MARKER_START}\n"
        f"<!-- Generado automáticamente — no editar a mano, ver .github/workflows/product-schema.yml -->\n"
        f'<script type="application/ld+json" id="ld-storelist">{json_for_script_tag(item_list)}</script>\n'
        f"{SCHEMA_MARKER_END}"
    )

    html_text = base_html
    html_text = set_title(html_text, title)
    html_text = set_meta_content(html_text, "meta-desc", desc)
    html_text = set_link_href(html_text, "canonicalLink", url)
    html_text = set_link_href(html_text, "hreflangEs", es_url)
    html_text = set_link_href(html_text, "hreflangEn", en_url)
    html_text = set_link_href(html_text, "hreflangDefault", es_url)
    html_text = set_h1(html_text, label)
    html_text = set_meta_content(html_text, "og-url", url)
    html_text = set_meta_content(html_text, "og-title", title)
    html_text = set_meta_content(html_text, "og-description", desc)
    if first_img:
        html_text = set_meta_content(html_text, "og-image", first_img)
    html_text = set_meta_content(html_text, "tw-title", title)
    html_text = set_meta_content(html_text, "tw-description", desc)
    if first_img:
        html_text = set_meta_content(html_text, "tw-image", first_img)
    html_text = replace_schema_block(html_text, schema_block)
    html_text = inject_static_var(html_text, f"window.__CACUSA_STATIC_CATEGORY = {json.dumps(cat)};")
    html_text = fix_relative_depth(html_text, extra_levels)
    return html_text


def write_if_changed(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.write_text(content, encoding="utf-8")
    return True


def main():
    data = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))
    products = data.get("products", [])
    categories = data.get("config", {}).get("categories", [])
    shipping_details = build_shipping_details(data.get("config", {}).get("shipping", {}))
    reviews_by_product = fetch_reviews_by_product()
    surcharges = fetch_surcharges()

    changed_any = False
    written_dirs = set()
    for target in TARGETS:
        base_html = target["base"].read_text(encoding="utf-8")
        lang = target["lang"]
        store_path = target["store_path"]
        store_root = target["base"].parent

        for p in products:
            slug = product_param(p, lang)
            page = build_product_page(base_html, p, lang, store_path, 2, shipping_details, reviews_by_product, surcharges)
            out_path = store_root / "producto" / slug / "index.html"
            changed_any = write_if_changed(out_path, page) or changed_any
            written_dirs.add(out_path.parent)

        for cat in categories:
            cat_slug = slugify(cat)
            page = build_category_page(base_html, cat, lang, store_path, 2, products)
            out_path = store_root / "categoria" / cat_slug / "index.html"
            changed_any = write_if_changed(out_path, page) or changed_any
            written_dirs.add(out_path.parent)

    print(f"{len(written_dirs)} páginas estáticas generadas/verificadas ({'con cambios' if changed_any else 'sin cambios'}).")
    if "--check" in sys.argv:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    main()
