#!/usr/bin/env python3
"""Genera el bloque <noscript> con el catálogo de productos para que los
crawlers sin JavaScript (GPTBot, etc.) vean los productos de la tienda, y un
bloque <noscript> equivalente (más liviano, sin catálogo completo) para el
home.

Lee data/products.json y reemplaza el contenido entre los marcadores
<!--NOSCRIPT_PRODUCTS_START--> y <!--NOSCRIPT_PRODUCTS_END--> en
ui_kits/store/index.html (español) Y en en/ui_kits/store/index.html (inglés,
usando name_en/description_en con fallback al español si faltan); y entre
<!--NOSCRIPT_HOME_START--> / <!--NOSCRIPT_HOME_END--> en index.html y
en/index.html. Si los marcadores no existen en un archivo, inserta el bloque
justo después del <div class="prod-grid" ...></div> (tienda) o de <body>
(home) de ESE archivo.

Uso:  python tools/gen_noscript.py
Re-ejecutar cada vez que cambie el catálogo de forma importante — actualiza
las cuatro páginas (tienda ES/EN, home ES/EN) en una sola pasada.
"""
import json, re, html, os, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS = os.path.join(ROOT, "data", "products.json")
STORE = os.path.join(ROOT, "ui_kits", "store", "index.html")
STORE_EN = os.path.join(ROOT, "en", "ui_kits", "store", "index.html")
HOME = os.path.join(ROOT, "index.html")
HOME_EN = os.path.join(ROOT, "en", "index.html")
START = "<!--NOSCRIPT_PRODUCTS_START-->"
END = "<!--NOSCRIPT_PRODUCTS_END-->"
HOME_START = "<!--NOSCRIPT_HOME_START-->"
HOME_END = "<!--NOSCRIPT_HOME_END-->"

# Traducción de categorías conocidas — si aparece una categoría nueva que no
# está acá, se deja tal cual en español (no se inventa una traducción).
CATEGORY_EN = {
    "Anillos": "Rings",
    "Aretes": "Earrings",
    "Pulseras": "Bracelets",
    "Hombres": "Men",
    "Cadenas": "Chains",
    "Ear cuff": "Ear Cuffs",
    "Parejas": "Couples",
    "Juegos": "Sets",
    "Joyería": "Jewelry",
}


def esc(s):
    return html.escape(str(s or "").strip())


def slugify(s):
    s = str(s or "").lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60]


def product_param(p, lang):
    name = p.get("name_en") if lang == "en" and p.get("name_en") else p.get("name")
    slug = slugify(name)
    pid = str(p.get("id"))
    return f"{slug}-{pid}" if slug else pid


def build(lang="es"):
    data = json.load(open(PRODUCTS, encoding="utf-8"))
    products = [p for p in data.get("products", []) if p.get("available") is not False]

    # Agrupa por categoría para una estructura semántica navegable
    cats = {}
    for p in products:
        cats.setdefault(p.get("category") or "Joyería", []).append(p)

    rows = []
    rows.append('<noscript>')
    if lang == "en":
        rows.append('<section aria-label="CACUSA by Taitus product catalog">')
        rows.append('<h2>CACUSA by Taitus personalized jewelry catalog</h2>')
        rows.append('<p>Handmade artisanal jewelry in 925 silver, 18k gold plating '
                    'and stainless steel. Personalization with name, initial, date or '
                    'message. Shipping to the USA and Ecuador.</p>')
    else:
        rows.append('<section aria-label="Catálogo de productos CACUSA by Taitus">')
        rows.append('<h2>Catálogo de joyería personalizada CACUSA by Taitus</h2>')
        rows.append('<p>Bisutería y joyería artesanal hecha a mano en plata 925, baño de oro 18k '
                    'y acero inoxidable. Personalización con nombre, inicial, fecha o mensaje. '
                    'Envíos a Ecuador y Estados Unidos.</p>')
    for cat, items in cats.items():
        cat_label = CATEGORY_EN.get(cat, cat) if lang == "en" else cat
        rows.append(f'<h3>{esc(cat_label)}</h3>')
        rows.append('<ul>')
        for p in items:
            pparam = esc(product_param(p, lang))
            price = p.get("price")
            price_txt = f" — ${price}" if price not in (None, "") else ""
            if lang == "en":
                label = esc(p.get("name_en") or p.get("name"))
                desc = esc(p.get("description_en") or p.get("description"))
            else:
                name = esc(p.get("name"))
                name_en = esc(p.get("name_en"))
                label = name if not name_en or name_en == name else f"{name} / {name_en}"
                desc = esc(p.get("description"))
            line = (f'<li><a href="?p={pparam}">{label}</a>{price_txt}'
                    + (f". {desc}" if desc else "")
                    + '</li>')
            rows.append(line)
        rows.append('</ul>')
    if lang == "en":
        rows.append('<p><a href="/en/">CACUSA by Taitus — home page</a></p>')
    else:
        rows.append('<p><a href="/">CACUSA by Taitus — página principal</a></p>')
    rows.append('</section>')
    rows.append('</noscript>')
    return "\n".join(rows)


def build_home(lang="es"):
    data = json.load(open(PRODUCTS, encoding="utf-8"))
    products = [p for p in data.get("products", []) if p.get("available") is not False]
    cats = {}
    for p in products:
        cats.setdefault(p.get("category") or "Joyería", []).append(p)

    rows = []
    rows.append('<noscript>')
    if lang == "en":
        rows.append('<section aria-label="CACUSA by Taitus">')
        rows.append('<h1>CACUSA by Taitus — Personalized Jewelry</h1>')
        rows.append('<p>Handmade artisanal jewelry in 925 silver, 18k gold plating and '
                    'stainless steel. Personalization with name, initial, date or message '
                    'available via WhatsApp. Shipping to the USA and Ecuador.</p>')
        rows.append('<h2>Shop by category</h2>')
        rows.append('<ul>')
        for cat in cats:
            label = CATEGORY_EN.get(cat, cat)
            rows.append(f'<li><a href="./ui_kits/store/?cat={esc(cat)}">{esc(label)}</a></li>')
        rows.append('</ul>')
        rows.append('<p><a href="./ui_kits/store/">Browse the full store</a> · '
                    '<a href="./cacusa-lovers.html">Cacusa Lovers monthly subscription</a></p>')
    else:
        rows.append('<section aria-label="CACUSA by Taitus">')
        rows.append('<h1>CACUSA by Taitus — Joyería personalizada</h1>')
        rows.append('<p>Bisutería y joyería artesanal hecha a mano en plata 925, baño de oro 18k '
                    'y acero inoxidable. Personalización con nombre, inicial, fecha o mensaje '
                    'disponible por WhatsApp. Envíos a Ecuador y Estados Unidos.</p>')
        rows.append('<h2>Comprar por categoría</h2>')
        rows.append('<ul>')
        for cat in cats:
            rows.append(f'<li><a href="./ui_kits/store/?cat={esc(cat)}">{esc(cat)}</a></li>')
        rows.append('</ul>')
        rows.append('<p><a href="./ui_kits/store/">Ver toda la tienda</a> · '
                    '<a href="./cacusa-lovers.html">Cacusa Lovers, suscripción mensual</a></p>')
    rows.append('</section>')
    rows.append('</noscript>')
    return "\n".join(rows)


def write_home_block(path, lang):
    block = HOME_START + "\n" + build_home(lang) + "\n" + HOME_END
    src = open(path, encoding="utf-8").read()
    if HOME_START in src and HOME_END in src:
        new = re.sub(re.escape(HOME_START) + ".*?" + re.escape(HOME_END), block, src, flags=re.S)
    else:
        idx = src.find("<body>")
        insert_at = idx + len("<body>")
        new = src[:insert_at] + "\n" + block + src[insert_at:]
    open(path, "w", encoding="utf-8").write(new)
    print(f"{path}: bloque noscript del home actualizado ({lang})")


def write_block(path, lang):
    block = START + "\n" + build(lang) + "\n" + END
    src = open(path, encoding="utf-8").read()
    if START in src and END in src:
        new = re.sub(re.escape(START) + ".*?" + re.escape(END), block, src, flags=re.S)
    else:
        # Inserta tras el cierre del prod-grid
        anchor = '<div class="prod-grid" id="prodGrid">'
        idx = src.find(anchor)
        close = src.find("</div>", idx) + len("</div>")
        new = src[:close] + "\n" + block + src[close:]
    open(path, "w", encoding="utf-8").write(new)
    n = block.count("<li>")
    cats = block.count("<h3>")
    print(f"{path}: {n} productos en {cats} categorias ({lang})")


def main():
    write_block(STORE, "es")
    if os.path.exists(STORE_EN):
        write_block(STORE_EN, "en")
    if os.path.exists(HOME):
        write_home_block(HOME, "es")
    if os.path.exists(HOME_EN):
        write_home_block(HOME_EN, "en")


if __name__ == "__main__":
    main()
