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
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PRODUCTS_JSON = ROOT / "data" / "products.json"
BASE_URL = "https://cacusabytaitus.com"
REVIEWS_URL = "https://cacusa-pos-default-rtdb.firebaseio.com/cacusa_reviews.json"

MARKER_START = "<!-- STATIC_PRODUCT_SCHEMA:START -->"
MARKER_END = "<!-- STATIC_PRODUCT_SCHEMA:END -->"

TARGETS = [
    {"path": ROOT / "ui_kits" / "store" / "index.html", "store_path": "/ui_kits/store/", "lang": "es"},
    {"path": ROOT / "en" / "ui_kits" / "store" / "index.html", "store_path": "/en/ui_kits/store/", "lang": "en"},
]

# Política de envíos/devoluciones — reales, no inventadas (ver envios.html /
# devoluciones.html). El flat rate sí viene de config.shipping.cost (mismo dato
# que ya edita el admin); handling/transit/return window no están en ningún
# config estructurado hoy, así que quedan acá — si cambian en envios.html o
# devoluciones.html, hay que actualizarlos acá también a mano.
def build_shipping_details(shipping_cost):
    rate = {"@type": "MonetaryAmount", "value": f"{float(shipping_cost):.2f}", "currency": "USD"}
    handling = {"@type": "QuantitativeValue", "minValue": 5, "maxValue": 10, "unitCode": "DAY"}
    return [
        {
            "@type": "OfferShippingDetails",
            "shippingRate": rate,
            "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "EC"},
            "deliveryTime": {
                "@type": "ShippingDeliveryTime",
                "handlingTime": handling,
                "transitTime": {"@type": "QuantitativeValue", "minValue": 0, "maxValue": 2, "unitCode": "DAY"},
            },
        },
        {
            "@type": "OfferShippingDetails",
            "shippingRate": rate,
            "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "US"},
            "deliveryTime": {
                "@type": "ShippingDeliveryTime",
                "handlingTime": handling,
                "transitTime": {"@type": "QuantitativeValue", "minValue": 2, "maxValue": 5, "unitCode": "DAY"},
            },
        },
    ]


# Solo defecto de fábrica, 48h, reparación/reemplazo sin costo (no reembolso en
# dinero) — ver devoluciones.html. MerchantReturnFiniteReturnWindow + 2 días es
# la representación más fiel que permite el vocabulario de schema.org para una
# ventana de 48h; ExchangeRefund refleja que es reparación/reemplazo, no dinero.
RETURN_POLICY = {
    "@type": "MerchantReturnPolicy",
    "applicableCountry": ["EC", "US"],
    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
    "merchantReturnDays": 2,
    "returnMethod": "https://schema.org/ReturnByMail",
    "returnFees": "https://schema.org/FreeReturn",
    "refundType": "https://schema.org/ExchangeRefund",
}


def fetch_reviews_by_product():
    """Reseñas reales desde Firebase (lectura pública, sin credenciales — mismo
    endpoint que ya usa el JS del cliente). Best-effort: si Firebase no responde,
    no debe romper la regeneración de precios/nombres de TODOS los productos —
    los productos simplemente quedan sin aggregateRating/review por esta corrida."""
    try:
        with urllib.request.urlopen(REVIEWS_URL, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"Aviso: no se pudieron traer reseñas de Firebase ({e}) — se omite aggregateRating/review esta corrida.")
        return {}


def build_review_fields(product_id, reviews_by_product):
    reviews = reviews_by_product.get(str(product_id))
    if not isinstance(reviews, dict) or not reviews:
        return None
    ratings = [float(rv.get("rating", 5)) for rv in reviews.values() if isinstance(rv, dict)]
    if not ratings:
        return None
    avg = sum(ratings) / len(ratings)
    items = sorted(reviews.values(), key=lambda rv: rv.get("date", ""), reverse=True)
    review_list = [
        {
            "@type": "Review",
            "author": {"@type": "Person", "name": rv.get("name") or "Anónimo"},
            "reviewRating": {"@type": "Rating", "ratingValue": str(rv.get("rating", 5)), "bestRating": "5", "worstRating": "1"},
            "reviewBody": rv.get("comment", ""),
            "datePublished": rv.get("date", ""),
        }
        for rv in items[:5]
        if isinstance(rv, dict)
    ]
    return {
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": f"{avg:.1f}",
            "reviewCount": len(ratings),
            "bestRating": "5",
            "worstRating": "1",
        },
        "review": review_list,
    }


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


def build_product_entry(p, lang, store_path, shipping_details, reviews_by_product):
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
            "shippingDetails": shipping_details,
            "hasMerchantReturnPolicy": RETURN_POLICY,
        },
    }
    images = product_images(p)
    if images:
        entry["image"] = images
    if p.get("material"):
        entry["material"] = p["material"]
    review_fields = build_review_fields(p.get("id"), reviews_by_product)
    if review_fields:
        entry.update(review_fields)
    return entry


def json_for_script_tag(obj):
    """Serializa a JSON seguro para incrustar dentro de <script>.

    El parser HTML corta el <script> en el primer `</script>` que ve, sin
    importar que esté dentro de una cadena JSON. Como acá entra texto que
    escribe cualquier persona desde internet (el nombre y el comentario de
    una reseña, que se guardan en Firebase sin moderación previa), una
    reseña con `</script><script>…</script>` cerraría este bloque e
    inyectaría código ejecutable en la tienda — y el Action lo comitearía a
    `main`, que GitHub Pages sirve de inmediato.

    `\\u003c` / `\\u003e` / `\\u0026` son escapes JSON válidos: el dato que
    lee Google es idéntico, pero el parser HTML ya no ve `</script>`.
    """
    return (
        json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )


def build_schema_block(products, lang, store_path, shipping_details, reviews_by_product):
    entries = [
        build_product_entry(p, lang, store_path, shipping_details, reviews_by_product)
        for p in products
        if p.get("available") is not False
    ]
    graph = {"@context": "https://schema.org", "@graph": entries}
    payload = json_for_script_tag(graph)
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
    shipping_cost = data.get("config", {}).get("shipping", {}).get("cost", 10)
    shipping_details = build_shipping_details(shipping_cost)
    reviews_by_product = fetch_reviews_by_product()
    changed_any = False
    for target in TARGETS:
        block = build_schema_block(products, target["lang"], target["store_path"], shipping_details, reviews_by_product)
        changed = inject(target["path"], block)
        changed_any = changed_any or changed
        print(f"{target['path']}: {'actualizado' if changed else 'sin cambios'}")
    if "--check" in sys.argv:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    main()
