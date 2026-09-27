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
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_product_schema import (  # noqa: E402
    BASE_URL,
    PRODUCTS_JSON,
    ROOT,
    build_product_entry,
    build_shipping_details,
    category_page_url,
    fetch_reviews_by_product,
    fetch_surcharges,
    json_for_script_tag,
    priced,
    product_page_url,
    product_param,
    slugify,
)
from generate_noscript_catalog import CATEGORY_LABELS  # noqa: E402
from category_copy import (  # noqa: E402
    CATEGORY_INTRO_EN,
    CATEGORY_INTRO_ES,
    CATEGORY_TITLE_EN,
    CATEGORY_TITLE_ES,
)

SCHEMA_MARKER_START = "<!-- STATIC_PRODUCT_SCHEMA:START -->"
SCHEMA_MARKER_END = "<!-- STATIC_PRODUCT_SCHEMA:END -->"
NOSCRIPT_MARKER_RE = re.compile(r"<!--NOSCRIPT_PRODUCTS_START-->.*?<!--NOSCRIPT_PRODUCTS_END-->", re.DOTALL)
# El cierre del bloque .store-hero del archivo base: el contenido estático de cada
# ficha/categoría se inserta justo debajo (ver insert_static_section).
HERO_END_RE = re.compile(r'(<p class="store-hero-value">.*?</p>\s*</div>)', re.DOTALL)
# Nodo BreadcrumbList genérico (CACUSA > Tienda) del @graph del archivo base — en una
# ficha/categoría compite con la ruta completa que arma este script, así que se saca.
BASE_BREADCRUMB_RE = re.compile(
    r'\n    \{"@type":"BreadcrumbList","itemListElement":\[\s*\{"@type":"ListItem","position":1,.*?"position":2,[^\]]*\]\},',
    re.DOTALL,
)

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
    # Reemplazo con función: un `\` en el nombre (ej. `\d`) rompía re.sub como plantilla
    title = "<title>" + text_esc(value) + "</title>"
    return re.sub(r"<title>.*?</title>", lambda _: title, html_text, count=1, flags=re.DOTALL)


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


CSP_META_RE = re.compile(r'<meta\s+http-equiv="Content-Security-Policy"[^>]*>', re.IGNORECASE)


def inject_static_var(html_text, var_name, value):
    # Va DESPUÉS del meta CSP (y del charset) — antes de cualquier otro <script> del
    # head, que es lo que lee la variable. json_for_script_tag evita cerrar el <script>.
    tag = "\n  <script>window." + var_name + " = " + json_for_script_tag(value) + ";</script>"
    m = CSP_META_RE.search(html_text)
    if not m:
        raise RuntimeError("No se encontró el meta Content-Security-Policy en el archivo base")
    return html_text[: m.end()] + tag + html_text[m.end():]


UI = {
    "es": {"home": "Inicio", "store": "Tienda", "crumbs": "Ruta de navegación", "material": "Material",
           "in_stock": "Disponible", "out": "Agotado", "view": "Ver detalles y comprar",
           "more": "Ver más {cat}", "perso": "Se puede personalizar con nombre, inicial o fecha: escríbenos por WhatsApp y te damos el precio final. Listo en 5 a 10 días hábiles.",
           "ship": "Envío a Ecuador y Estados Unidos. Gratis en compras desde $90."},
    "en": {"home": "Home", "store": "Store", "crumbs": "Breadcrumb", "material": "Material",
           "in_stock": "In stock", "out": "Sold out", "view": "View details and buy",
           "more": "See more {cat}", "perso": "Can be personalized with a name, initial or date: message us on WhatsApp for the final price. Ready in 5 to 10 business days.",
           "ship": "Ships to Ecuador and the United States. Free on orders over $90."},
}

# Material viene en español desde el panel; en las páginas /en/ se traduce con este
# mapa (clave en minúsculas). Un material que no esté acá se muestra tal cual.
MATERIAL_EN = {
    "baño de oro 18k": "18k gold plating",
    "acero inoxidable": "Stainless steel",
    "gold filled": "Gold filled",
    "baño de rodio": "Rhodium plating",
    "plata 925": "925 silver",
    "plata 925 con un baño de oro de 18k": "925 silver with 18k gold plating",
}


def clean(s):
    """Nombres del catálogo con espacios de más (42 terminaban en espacio → "Anillo  —")."""
    return re.sub(r"\s+", " ", str(s or "")).strip()


def category_label(cat, lang):
    return CATEGORY_LABELS.get(cat, cat) if lang == "en" else cat


def home_path(lang):
    return "/en/" if lang == "en" else "/"


def crumbs_html(items, lang):
    """items: [(label, url|None)] — el último es la página actual (sin enlace)."""
    lis = []
    for label, href in items:
        if href:
            lis.append(f'<li><a href="{attr_esc(href)}">{text_esc(label)}</a></li>')
        else:
            lis.append(f'<li aria-current="page">{text_esc(label)}</li>')
    return f'<nav class="static-crumbs" aria-label="{UI[lang]["crumbs"]}"><ol>{"".join(lis)}</ol></nav>'


def breadcrumb_ld(items):
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": label, "item": url}
            for i, (label, url) in enumerate(items)
        ],
    }


def money(x):
    try:
        return f"${float(x):.2f}"
    except (TypeError, ValueError):
        return ""


def insert_static_section(html_text, section_html):
    if not HERO_END_RE.search(html_text):
        raise RuntimeError("No se encontró el cierre de .store-hero en el archivo base")
    return HERO_END_RE.sub(lambda m: m.group(1) + "\n" + section_html, html_text, count=1)


def page_meta_fixes(html_text, og_type):
    """og:type correcto y sin og:image:width/height fijos (1200x630 es la medida de la
    imagen genérica de la tienda, no la de la foto del producto que la reemplaza)."""
    html_text = html_text.replace('<meta property="og:type" content="website">',
                                  f'<meta property="og:type" content="{og_type}">', 1)
    html_text = re.sub(r'\s*<meta property="og:image:(?:width|height)" content="\d+">', "", html_text)
    return html_text


def strip_page_specific_blocks(html_text):
    # El <noscript> con los 93 productos se queda solo en la tienda general: repetido
    # en cada ficha/categoría inflaba ~200 páginas con el mismo catálogo.
    html_text = NOSCRIPT_MARKER_RE.sub("", html_text, count=1)
    return BASE_BREADCRUMB_RE.sub("", html_text, count=1)


def build_product_page(base_html, p, lang, store_path, extra_levels, shipping_details, reviews_by_product, surcharges):
    name = clean(p.get("name_en") if (lang == "en" and p.get("name_en")) else p.get("name"))
    desc = clean(p.get("description_en") if (lang == "en" and p.get("description_en")) else p.get("description"))
    url = product_page_url(p, lang, store_path)
    title = f"{name} — CACUSA by Taitus"
    meta_desc = (desc or name or "")[:160]
    images = p.get("images") if isinstance(p.get("images"), list) and p.get("images") else (
        [p["imageUrl"]] if p.get("imageUrl") else []
    )
    store_label = "Store" if lang == "en" else "Tienda"
    cat = p.get("category") or ""
    cat_label = category_label(cat, lang)
    cat_url = category_page_url(cat, lang, store_path) if cat else None
    crumb_items_ld = [("CACUSA", BASE_URL + home_path(lang)), (store_label, f"{BASE_URL}{store_path}")]
    crumb_items = [(UI[lang]["home"], home_path(lang)), (store_label, store_path)]
    if cat_url:
        crumb_items_ld.append((cat_label, cat_url))
        crumb_items.append((cat_label, cat_url[len(BASE_URL):]))
    crumb_items_ld.append((name, url))
    crumb_items.append((name, None))
    entry = build_product_entry(p, lang, store_path, shipping_details, reviews_by_product, surcharges)
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1, "name": label, "item": item_url}
                    for i, (label, item_url) in enumerate(crumb_items_ld)
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
    html_text = strip_page_specific_blocks(html_text)
    html_text = page_meta_fixes(html_text, "product")
    html_text = insert_static_section(html_text, product_section_html(
        p, lang, name, desc, images, crumb_items, cat_label, cat_url, surcharges))
    html_text = inject_static_var(html_text, "__CACUSA_STATIC_PRODUCT_ID", str(p.get("id")))
    html_text = fix_relative_depth(html_text, extra_levels)
    return html_text


def product_section_html(p, lang, name, desc, images, crumb_items, cat_label, cat_url, surcharges):
    t = UI[lang]
    img = ""
    if images:
        img = (f'<img class="static-pdp-img" src="{attr_esc(images[0])}" alt="{attr_esc(name)} — CACUSA by Taitus" '
               f'width="600" height="600" decoding="async" fetchpriority="high">')
    price = money(priced(p, surcharges))
    old = p.get("oldPrice")
    old_html = f' <s class="static-pdp-old">{money(old)}</s>' if old and money(old) != price else ""
    material = clean(p.get("material"))
    if material and lang == "en":
        material = MATERIAL_EN.get(material.lower(), material)
    stock = t["out"] if p.get("available") is False else t["in_stock"]
    meta = " · ".join(x for x in [f'{t["material"]}: {material}' if material else "", stock] if x)
    perso = f'<p class="static-pdp-note">{text_esc(t["perso"])}</p>' if p.get("personalized") else ""
    more = (f'<a class="static-pdp-more" href="{attr_esc(cat_url[len(BASE_URL):])}">'
            f'{text_esc(t["more"].format(cat=cat_label.lower()))}</a>') if cat_url else ""
    pid = json_for_script_tag(p.get("id"))
    return (
        f'<section class="static-pdp">{crumbs_html(crumb_items, lang)}'
        f'<div class="static-pdp-grid">{img}<div class="static-pdp-info">'
        f'<p class="static-pdp-price">{price}{old_html}</p>'
        f'<p class="static-pdp-meta">{text_esc(meta)}</p>'
        f'<p class="static-pdp-desc">{text_esc(desc or name)}</p>{perso}'
        f'<p class="static-pdp-ship">{text_esc(t["ship"])}</p>'
        f'<div class="static-pdp-actions"><button type="button" class="static-pdp-cta" '
        f'onclick="openModal({attr_esc(pid)})">{text_esc(t["view"])}</button>{more}</div>'
        f'</div></div></section>'
    )


def build_category_page(base_html, cat, lang, store_path, extra_levels, products):
    key = cat.lower()
    label = category_label(cat, lang)
    desc = (CATEGORY_DESC_EN if lang == "en" else CATEGORY_DESC_ES).get(key) or (
        f"Handmade {label} — personalized jewelry in 925 silver, 18k gold plating and stainless steel."
        if lang == "en"
        else f"{label} artesanales — joyería personalizada en plata 925, baño de oro 18k y acero inoxidable."
    )
    cat_slug = slugify(cat)
    url = category_page_url(cat, lang, store_path)
    es_url = category_page_url(cat, "es", "/ui_kits/store/")
    en_url = category_page_url(cat, "en", "/en/ui_kits/store/")
    title = (CATEGORY_TITLE_EN if lang == "en" else CATEGORY_TITLE_ES).get(key) or f"{label} — CACUSA by Taitus"
    intro = (CATEGORY_INTRO_EN if lang == "en" else CATEGORY_INTRO_ES).get(key) or desc
    store_label = "Store" if lang == "en" else "Tienda"
    crumbs = crumbs_html([(UI[lang]["home"], home_path(lang)), (store_label, store_path), (label, None)], lang)
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
    # Migas en su propio <script>: renderStoreItemListLd() del JS de la tienda reescribe
    # #ld-storelist entero al cargar, y se llevaría la BreadcrumbList si fueran juntas.
    crumbs_graph = {"@context": "https://schema.org", **breadcrumb_ld(
        [("CACUSA", BASE_URL + home_path(lang)), (store_label, f"{BASE_URL}{store_path}"), (label, url)])}
    schema_block = (
        f"{SCHEMA_MARKER_START}\n"
        f"<!-- Generado automáticamente — no editar a mano, ver .github/workflows/product-schema.yml -->\n"
        f'<script type="application/ld+json" id="ld-storelist">{json_for_script_tag(item_list)}</script>\n'
        f'<script type="application/ld+json" id="ld-breadcrumb">{json_for_script_tag(crumbs_graph)}</script>\n'
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
    html_text = strip_page_specific_blocks(html_text)
    html_text = page_meta_fixes(html_text, "website")
    html_text = insert_static_section(
        html_text,
        f'<section class="static-cat">{crumbs}<p class="static-cat-intro">{text_esc(intro)}</p></section>',
    )
    html_text = inject_static_var(html_text, "__CACUSA_STATIC_CATEGORY", cat)
    html_text = fix_relative_depth(html_text, extra_levels)
    return html_text


def write_if_changed(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.write_text(content, encoding="utf-8")
    return True


def remove_stale_dirs(base_dir: Path, expected: set) -> int:
    """Borra las carpetas de producto/categoría que ya no corresponden a nada en
    data/products.json (producto eliminado, o categoría renombrada/quitada) —
    antes se quedaban publicadas para siempre con contenido viejo (URL de
    imagen incluida) porque esta función no existía, ver CLAUDE.md 19 sep."""
    if not base_dir.exists():
        return 0
    removed = 0
    for child in sorted(base_dir.iterdir()):
        if child.is_dir() and child not in expected:
            shutil.rmtree(child)
            print(f"Eliminada (ya no existe en el catálogo): {child}")
            removed += 1
    return removed


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

        expected_producto = set()
        expected_categoria = set()

        for p in products:
            slug = product_param(p, lang)
            page = build_product_page(base_html, p, lang, store_path, 2, shipping_details, reviews_by_product, surcharges)
            out_path = store_root / "producto" / slug / "index.html"
            changed_any = write_if_changed(out_path, page) or changed_any
            written_dirs.add(out_path.parent)
            expected_producto.add(out_path.parent)

        for cat in categories:
            cat_slug = slugify(cat)
            page = build_category_page(base_html, cat, lang, store_path, 2, products)
            out_path = store_root / "categoria" / cat_slug / "index.html"
            changed_any = write_if_changed(out_path, page) or changed_any
            written_dirs.add(out_path.parent)
            expected_categoria.add(out_path.parent)

        removed = remove_stale_dirs(store_root / "producto", expected_producto)
        removed += remove_stale_dirs(store_root / "categoria", expected_categoria)
        changed_any = changed_any or removed > 0

    print(f"{len(written_dirs)} páginas estáticas generadas/verificadas ({'con cambios' if changed_any else 'sin cambios'}).")
    if "--check" in sys.argv:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    main()
