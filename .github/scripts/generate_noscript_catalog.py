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
            "Bisutería y joyería artesanal hecha a mano en baño de oro 18k, acero "
            "inoxidable y gold filled. Personalización con nombre, inicial, fecha o mensaje. "
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
            "Handmade artisanal jewelry in 18k gold plating, stainless steel and gold "
            "filled. Personalization with name, initial, date or message. Shipping to "
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
    return html.escape(str(s or ""), quote=True)


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
            # Barrido SEO (19 sep): antes era "?p=<slug>" — GitHub Pages sirve el mismo HTML
            # sin importar el query string, así que esa URL nunca puede tener canonical
            # propio. Ahora apunta a la página estática real (generate_product_pages.py).
            store_path = "/en/ui_kits/store/" if lang == "en" else "/ui_kits/store/"
            href = store_path + "producto/" + product_param(p, lang) + "/"
            price = p.get("price", "")
            soldout = " (Sold out)" if (lang == "en" and p.get("available") is False) else                       " (Agotado)" if p.get("available") is False else ""
            bits = f'<li><a href="{esc(href)}">{esc(name)}</a>{soldout} — ${esc(price)}.'
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


# ─── Pre-render de la cabecera de la tienda (wave 1, CLS) ─────────────────────────
# La franja de temporada, el aviso de envío gratis y los chips de categoría los pinta el JS
# cuando llega data/products.json; antes aparecían de golpe y empujaban hacia abajo los
# filtros y la grilla (layout shift). Ahora salen ya pintados en el HTML con el MISMO markup
# que generan renderSeasonBanner()/renderFreeShippingBanner()/renderFilters() en
# ui_kits/store/app.js (y en/), así el JS solo los reemplaza por lo mismo. Si se cambia el
# markup de esas funciones, cambiar también este bloque.
BANNERS_START = "<!--STORE_BANNERS_START-->"
BANNERS_END = "<!--STORE_BANNERS_END-->"
FILTERS_START = "<!--FILTER_BTNS_START-->"
FILTERS_END = "<!--FILTER_BTNS_END-->"
MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
CAMPAIGN_DEFAULT = {  # mismo DEFAULT_CAMPAIGN de app.js
    "enabled": True, "endsAt": "2026-12-26", "title": "Regalos de Navidad", "title_en": "Christmas gifts",
    "banner": "", "banner_en": "", "deadlinePersonalEc": "2026-12-08", "deadlinePersonalUs": "2026-12-03",
    "deadlineStockEc": "2026-12-18", "deadlineStockUs": "2026-12-14",
}
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _today_iso():
    """Hoy en Ecuador (UTC-5, sin horario de verano) — CI corre en UTC."""
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%d")


def _campaign(raw):
    c = dict(CAMPAIGN_DEFAULT)
    r = raw if isinstance(raw, dict) else {}
    if isinstance(r.get("enabled"), bool):
        c["enabled"] = r["enabled"]
    for k in ("endsAt", "deadlinePersonalEc", "deadlinePersonalUs", "deadlineStockEc", "deadlineStockUs"):
        if isinstance(r.get(k), str) and ISO_RE.match(r[k]):
            c[k] = r[k]
    for k in ("title", "title_en"):
        if isinstance(r.get(k), str) and r[k].strip():
            c[k] = r[k].strip()
    for k in ("banner", "banner_en"):
        if isinstance(r.get(k), str):
            c[k] = r[k].strip()
    return c


def _fmt_date(iso, lang):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS_EN[m - 1]} {d}" if lang == "en" else f"{d} de {MONTHS_ES[m - 1]}"


def season_banner_text(cfg, lang, today=None):
    """Texto de la franja con país desconocido (fechas de EE.UU. y Ecuador), o None si la
    campaña está apagada/vencida — replica renderSeasonBanner() de app.js."""
    c = _campaign(cfg.get("campaign"))
    today = today or _today_iso()
    deadlines = [c["deadlinePersonalEc"], c["deadlinePersonalUs"], c["deadlineStockEc"], c["deadlineStockUs"]]
    if not c["enabled"] or today > c["endsAt"] or not any(d >= today for d in deadlines):
        return None
    lst = [(cc, c["deadlineStock" + ("Ec" if cc == "EC" else "Us")]) for cc in ("US", "EC")]
    lst = [(cc, d) for cc, d in lst if d and d >= today]
    if not lst:
        return None
    en = lang == "en"
    label = lambda cc: "Ecuador" if cc == "EC" else ("US" if en else "EE.UU.")
    custom = c["banner_en"] if en else c["banner"]
    if custom:
        fecha = (" or " if en else " o hasta el ").join(f"{_fmt_date(d, lang)} ({label(cc)})" for cc, d in lst)
        return re.sub(r"\{(fecha|date)\}", fecha, custom)
    title = c["title_en"] if en else c["title"]
    parts = []
    for i, (cc, d) in enumerate(lst):
        pre = ("by " if i else "order by ") if en else ("hasta el " if i else "pide hasta el ")
        parts.append(f"{label(cc)}: {pre}{_fmt_date(d, lang)}")
    return "✦ " + title + " · " + " · ".join(parts)


def build_banners_block(cfg, lang):
    href = "/en/guia-regalos.html" if lang == "en" else "/guia-regalos.html"
    text = season_banner_text(cfg, lang)
    season = (f'<a id="seasonBanner" class="season-banner" href="{href}">{esc(text)}</a>' if text
              else f'<a id="seasonBanner" class="season-banner" href="{href}" hidden></a>')
    try:
        ft = float((cfg.get("shipping") or {}).get("freeThreshold", 90))
    except (TypeError, ValueError):
        ft = 90.0
    thr = f"{ft:.0f}"
    free = f"Free shipping on orders ${thr}+" if lang == "en" else f"Envío gratis en pedidos desde ${thr}"
    return "\n".join([BANNERS_START, season, f'<div id="freeShippingBanner" style="display:block">{esc(free)}</div>', BANNERS_END])


def build_filters_block(cfg, lang):
    cats = cfg.get("categories") if isinstance(cfg.get("categories"), list) and cfg.get("categories") else \
        ["Cadenas", "Aretes", "Anillos", "Hombres", "Pulseras"]
    btns = ['<button class="filter-btn active" data-filter="all">' + ("All" if lang == "en" else "Todo") + "</button>"]
    for c in cats:
        label = CATEGORY_LABELS.get(c, c) if lang == "en" else c
        btns.append(f'<button class="filter-btn" data-filter="{esc(c)}">{esc(label)}</button>')
    return FILTERS_START + "".join(btns) + FILTERS_END


def inject_store_prerender(path: Path, cfg, lang) -> bool:
    html_text = path.read_text(encoding="utf-8")
    new_html = html_text
    for start, end, block in ((BANNERS_START, BANNERS_END, build_banners_block(cfg, lang)),
                              (FILTERS_START, FILTERS_END, build_filters_block(cfg, lang))):
        pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
        if not pattern.search(new_html):
            raise RuntimeError(f"No se encontraron los marcadores {start} en {path}")
        new_html = pattern.sub(lambda _: block, new_html)
    if new_html == html_text:
        return False
    path.write_text(new_html, encoding="utf-8")
    return True


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
    # Antes se excluía acá un producto agotado, así que un bot que no ejecuta
    # JS ni se enteraba de que existió. Ahora se incluyen todos, marcados
    # "(Agotado)"/"(Sold out)" junto al nombre (ver build_catalog_block).
    products = data.get("products", [])
    categories_order = data.get("config", {}).get("categories", [])
    changed_any = False
    for target in TARGETS:
        block = build_catalog_block(products, categories_order, target)
        changed = inject(target["path"], block)
        changed = inject_store_prerender(target["path"], data.get("config", {}), target["lang"]) or changed
        changed_any = changed_any or changed
        print(f"{target['path']}: {'actualizado' if changed else 'sin cambios'}")
    if "--check" in sys.argv:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    main()
