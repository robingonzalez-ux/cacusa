#!/usr/bin/env python3
"""Genera el bloque <noscript> con el catálogo de productos para que los
crawlers sin JavaScript (GPTBot, etc.) vean los productos de la tienda.

Lee data/products.json y reemplaza el contenido entre los marcadores
<!--NOSCRIPT_PRODUCTS_START--> y <!--NOSCRIPT_PRODUCTS_END--> en
ui_kits/store/index.html. Si los marcadores no existen, inserta el bloque
justo después del <div class="prod-grid" ...></div>.

Uso:  python tools/gen_noscript.py
Re-ejecutar cada vez que cambie el catálogo de forma importante.
"""
import json, re, html, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS = os.path.join(ROOT, "data", "products.json")
STORE = os.path.join(ROOT, "ui_kits", "store", "index.html")
START = "<!--NOSCRIPT_PRODUCTS_START-->"
END = "<!--NOSCRIPT_PRODUCTS_END-->"


def esc(s):
    return html.escape(str(s or "").strip())


def build():
    data = json.load(open(PRODUCTS, encoding="utf-8"))
    products = [p for p in data.get("products", []) if p.get("available") is not False]

    # Agrupa por categoría para una estructura semántica navegable
    cats = {}
    for p in products:
        cats.setdefault(p.get("category") or "Joyería", []).append(p)

    rows = []
    rows.append('<noscript>')
    rows.append('<section aria-label="Catálogo de productos CACUSA by Taitus">')
    rows.append('<h2>Catálogo de joyería personalizada CACUSA by Taitus</h2>')
    rows.append('<p>Bisutería y joyería artesanal hecha a mano en plata 925, baño de oro 18k '
                'y acero inoxidable. Personalización con nombre, inicial, fecha o mensaje. '
                'Envíos a Ecuador y Estados Unidos.</p>')
    for cat, items in cats.items():
        rows.append(f'<h3>{esc(cat)}</h3>')
        rows.append('<ul>')
        for p in items:
            pid = esc(p.get("id"))
            name = esc(p.get("name"))
            name_en = esc(p.get("name_en"))
            price = p.get("price")
            desc = esc(p.get("description"))
            label = name if not name_en or name_en == name else f"{name} / {name_en}"
            price_txt = f" — ${price}" if price not in (None, "") else ""
            line = (f'<li><a href="?p={pid}">{label}</a>{price_txt}'
                    + (f". {desc}" if desc else "")
                    + '</li>')
            rows.append(line)
        rows.append('</ul>')
    rows.append('<p><a href="/">CACUSA by Taitus — página principal</a></p>')
    rows.append('</section>')
    rows.append('</noscript>')
    return "\n".join(rows)


def main():
    block = START + "\n" + build() + "\n" + END
    src = open(STORE, encoding="utf-8").read()
    if START in src and END in src:
        new = re.sub(re.escape(START) + ".*?" + re.escape(END), block, src, flags=re.S)
    else:
        # Inserta tras el cierre del prod-grid
        anchor = '<div class="prod-grid" id="prodGrid">'
        idx = src.find(anchor)
        close = src.find("</div>", idx) + len("</div>")
        new = src[:close] + "\n" + block + src[close:]
    open(STORE, "w", encoding="utf-8").write(new)
    n = block.count("<li>")
    print(f"noscript actualizado: {n} productos en {block.count('<h3>')} categorias")


if __name__ == "__main__":
    main()
