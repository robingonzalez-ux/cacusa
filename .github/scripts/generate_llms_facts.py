#!/usr/bin/env python3
"""
Regenera los datos NUMÉRICOS de llms.txt (rango de precios, lista de
materiales, umbral de envío gratis, precios de Cacusa Lovers) a partir de
data/products.json, entre marcadores inline <!--LLMS:NOMBRE-->...
<!--/LLMS:NOMBRE-->.

Por qué existe: llms.txt es el resumen del negocio que leen las IAs
(ChatGPT, Claude, Perplexity, etc.) para responder preguntas sobre CACUSA.
Varios de sus datos (precios, materiales) viven también en el panel admin
vía data/products.json — si alguien sube el precio de envío gratis o
agrega un material nuevo desde el admin, llms.txt quedaba desactualizado
hasta que alguien se acordaba de pedirle a Claude que lo revisara a mano.

Qué SÍ se automatiza acá (datos que realmente viven en data/products.json):
- Rango de precios (min/max de productos disponibles)
- Lista de materiales (config.materials)
- Umbral y costo de envío gratis (config.shipping)
- Precios mensual/anual de Cacusa Lovers + % de descuento anual (calculado)

Qué NO se automatiza (no vive en data/products.json, es texto/código fijo
en el sitio — hay que seguir actualizándolo a mano si cambia):
- El 4% de descuento por Zelle/transferencia (hardcodeado en el JS de la
  tienda, no es un campo de config)
- El 10% de descuento de primera compra y el 10% del programa de
  referidos (hardcodeados en el JS de la tienda / admin-worker.js)
- Los 5-10 días hábiles de elaboración y las 48h de acceso VIP anual
- Toda la prosa: WhatsApp, redes sociales, descripciones de guías,
  políticas, estructura del documento

Corre en el mismo GitHub Action que ya regenera el JSON-LD, el sitemap y
el catálogo <noscript> (.github/workflows/product-schema.yml) cada vez que
cambia data/products.json.

No edites a mano el texto entre marcadores <!--LLMS:X-->...<!--/LLMS:X-->
en llms.txt — se sobreescribe solo. El resto del archivo (todo lo que no
está entre marcadores) es prosa manual y no se toca.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PRODUCTS_JSON = ROOT / "data" / "products.json"
LLMS_TXT = ROOT / "llms.txt"

# Traducción ES→EN y forma "detallada" (para la lista de materiales) y
# "corta" (para menciones en prosa/FAQ) de cada material que puede
# aparecer en config.materials. Si se agrega un material nuevo desde el
# admin y no está en este diccionario, se usa el texto en español tal
# cual como respaldo en inglés (y el script avisa por consola) — hay que
# agregarlo acá a mano la primera vez.
MATERIAL_LABELS = {
    "Plata 925": {
        "detail_es": "Plata 925 (plata de ley genuina)",
        "detail_en": "925 sterling silver (genuine solid silver)",
        "brand_es": "plata 925 (plata de ley)",
        "brand_en": "925 sterling silver",
        "short_es": "plata 925",
        "short_en": "925 silver",
    },
    "Baño de oro 18k": {
        "detail_es": "Baño de oro 18k",
        "detail_en": "18k gold plating",
        "brand_es": "baño de oro 18k",
        "brand_en": "18k gold plating",
        "short_es": "baño de oro 18k",
        "short_en": "18k gold plating",
    },
    "Gold filled": {
        "detail_es": "Gold filled 18k (más grueso y duradero que el baño de oro)",
        "detail_en": "18k gold filled (thicker and more durable than gold plating)",
        "brand_es": "gold filled 18k",
        "brand_en": "18k gold filled",
        "short_es": "gold filled 18k",
        "short_en": "18k gold filled",
    },
    "Baño de Rodio": {
        "detail_es": "Baño de rodio",
        "detail_en": "Rhodium plating",
        "brand_es": "baño de rodio",
        "brand_en": "rhodium plating",
        "short_es": "baño de rodio",
        "short_en": "rhodium plating",
    },
    "Acero inoxidable": {
        "detail_es": "Acero inoxidable hipoalergénico",
        "detail_en": "Hypoallergenic stainless steel",
        "brand_es": "acero inoxidable",
        "brand_en": "stainless steel",
        "short_es": "acero inoxidable",
        "short_en": "stainless steel",
    },
}

# Materiales de config.materials que son combinaciones de los de arriba
# (ej. "plata + baño de oro") y no necesitan su propia línea — ya están
# cubiertos por los materiales base.
SKIP_MATERIALS = {"Plata 925 con un baño de oro de 18k"}

# Orden de exhibición fijo (no necesariamente el orden de config.materials)
DISPLAY_ORDER = ["Plata 925", "Baño de oro 18k", "Gold filled", "Baño de Rodio", "Acero inoxidable"]


def load_materials(config_materials):
    ordered = [m for m in DISPLAY_ORDER if m in config_materials]
    extra = [m for m in config_materials if m not in DISPLAY_ORDER and m not in SKIP_MATERIALS]
    for m in extra:
        print(f"AVISO: material '{m}' no está en MATERIAL_LABELS de generate_llms_facts.py — "
              f"agrégalo al diccionario para que tenga traducción/detalle propios. Por ahora "
              f"se usa el texto en español tal cual.", file=sys.stderr)
    return ordered + extra


def material_label(m, field):
    if m in MATERIAL_LABELS:
        return MATERIAL_LABELS[m][field]
    return m  # respaldo: texto en español tal cual si no está mapeado


def build_materials_list_block(materials):
    lines = []
    for m in materials:
        es = material_label(m, "detail_es")
        en = material_label(m, "detail_en")
        lines.append(f"- {es} / {en}")
    return "\n".join(lines)


def build_materials_prose(materials, field):
    parts = [material_label(m, field) for m in materials]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    is_es = field.endswith("_es")
    if len(parts) == 2:
        return (" y " if is_es else " and ").join(parts)
    joiner = " y " if is_es else ", and "
    return ", ".join(parts[:-1]) + joiner + parts[-1]


FACTS = {}  # nombre de marcador -> texto de reemplazo, se llena en main()


def replace_marker(text, name, replacement):
    pattern = re.compile(
        re.escape(f"<!--LLMS:{name}-->") + r".*?" + re.escape(f"<!--/LLMS:{name}-->"),
        re.DOTALL,
    )
    if not pattern.search(text):
        raise RuntimeError(f"No se encontró el marcador LLMS:{name} en {LLMS_TXT}")
    return pattern.sub(lambda _: f"<!--LLMS:{name}-->{replacement}<!--/LLMS:{name}-->", text)


def main():
    data = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))
    config = data.get("config", {})
    products = [p for p in data.get("products", []) if p.get("available")]

    prices = [p["price"] for p in products if isinstance(p.get("price"), (int, float))]
    price_min, price_max = (min(prices), max(prices)) if prices else (0, 0)

    materials = load_materials(config.get("materials", []))

    shipping = config.get("shipping", {})
    free_threshold = shipping.get("freeThreshold")
    ship_cost = shipping.get("cost")

    lovers = config.get("lovers", {})
    monthly = lovers.get("monthlyPrice")
    annual = lovers.get("annualPrice")
    annual_pct = None
    if monthly and annual:
        annual_pct = round((1 - annual / (monthly * 12)) * 100)

    def money(n):
        return f"{n:g}"

    FACTS["MATERIALS_LIST"] = "\n" + build_materials_list_block(materials) + "\n"
    FACTS["MATERIALS_BRAND_ES"] = build_materials_prose(materials, "brand_es")
    FACTS["MATERIALS_BRAND_EN"] = build_materials_prose(materials, "brand_en")
    FACTS["MATERIALS_FAQ_ES"] = build_materials_prose(materials, "short_es")
    FACTS["MATERIALS_FAQ_EN"] = build_materials_prose(materials, "short_en")

    FACTS["PRICE_RANGE"] = (
        f"\nDesde ${money(price_min)} hasta aproximadamente ${money(price_max)} USD según la pieza y el material.\n"
        f"From ${money(price_min)} to approximately ${money(price_max)} USD depending on the piece and material.\n"
    )
    FACTS["PRICE_FAQ_ES"] = f"${money(price_min)} a ${money(price_max)}"
    FACTS["PRICE_FAQ_EN"] = f"${money(price_min)} to ${money(price_max)}"

    if free_threshold is not None and ship_cost is not None:
        FACTS["SHIPPING_FREE"] = (
            f"\n- Envío gratis en compras desde ${money(free_threshold)} USD; por debajo de ese monto el envío\n"
            f"  cuesta ${money(ship_cost)} USD / Free shipping on orders from ${money(free_threshold)} USD; below that,\n"
            f"  shipping costs ${money(ship_cost)} USD\n"
        )
        FACTS["SHIPPING_FAQ_ES"] = (
            f"Gratis en compras desde ${money(free_threshold)} USD; por debajo de ese monto cuesta ${money(ship_cost)} USD."
        )
        FACTS["SHIPPING_FAQ_EN"] = (
            f"Free on orders from ${money(free_threshold)} USD; below that, it costs ${money(ship_cost)} USD."
        )

    if monthly is not None and annual is not None and annual_pct is not None:
        FACTS["LOVERS_PRICE_ES"] = (
            f"Plan mensual: ${money(monthly)}/mes. Plan anual: ${money(annual)}/año ({annual_pct}% de\n"
            f"descuento vs. pagar mes a mes)"
        )
        FACTS["LOVERS_PRICE_EN"] = (
            f"Monthly plan: ${money(monthly)}/month. Annual plan: ${money(annual)}/year\n"
            f"({annual_pct}% off vs. paying month to month)"
        )

    text = LLMS_TXT.read_text(encoding="utf-8")
    original = text
    for name, replacement in FACTS.items():
        text = replace_marker(text, name, replacement)

    changed = text != original
    if changed:
        LLMS_TXT.write_text(text, encoding="utf-8")
    print(f"{LLMS_TXT}: {'actualizado' if changed else 'sin cambios'}")
    if "--check" in sys.argv:
        sys.exit(1 if changed else 0)


if __name__ == "__main__":
    main()
