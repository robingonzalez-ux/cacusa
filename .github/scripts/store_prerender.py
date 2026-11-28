#!/usr/bin/env python3
"""
Piezas compartidas del pre-render de la tienda (wave 2, "vender más"):

  - Variantes responsivas de las fotos del catálogo: CI genera <nombre>-320/-640/-960.webp
    junto a cada foto (generate_image_variants.py) y acá se arma el mismo srcset que arma
    _imgSrcset() en ui_kits/store/app.js (y en/).
  - Tarjetas de producto pre-pintadas en el HTML (primera fila de la tienda y de cada página
    de categoría): MISMO marcado que _pcardHtml() de app.js, así el primer pintado del JS solo
    las reemplaza por lo mismo (sin salto de diseño) y la foto de la primera tarjeta empieza a
    bajar con el HTML, sin esperar a app.js + products.json (LCP).
  - Acordeones de la ficha estática (Envío y devoluciones / Materiales y cuidado / Medidas y
    talla) con el mismo texto que _accShipHtml/_accCareHtml/_accSizeHtml de app.js.

Si se cambia el marcado de una de esas funciones del JS, cambiar también la copia de acá.
Todo dato de products.json que entra al HTML pasa por esc(): nunca HTML crudo.
"""
import html
import math
import re
import struct
from datetime import datetime, timezone
from pathlib import Path

from generate_product_schema import js_round2, product_param

IMG_WIDTHS = (320, 640, 960)
OWN_IMG_RE = re.compile(r'^(?:https://cacusabytaitus\.com)?/ui_kits/store/images/[^/?#"\'<>\s]+\.(?:webp|jpe?g|png)$', re.I)
VARIANT_RE = re.compile(r'-(?:320|640|960)\.webp$', re.I)
SIZES_CARD = "(max-width:600px) 48vw, (max-width:1280px) 23vw, 290px"
SIZES_PDP = "(max-width:768px) 92vw, 360px"
SIZES_HERO = "(max-width:768px) 92vw, 66vw"
HOME_N = 8

GRID_START = "<!--GRID_PRERENDER_START-->"
GRID_END = "<!--GRID_PRERENDER_END-->"
SKELETON = '    <div class="pcard-skeleton"><div class="sk-img"></div><div class="sk-line"></div><div class="sk-line short"></div></div>'

COLOR_GRADS = {
    "rose": "linear-gradient(135deg,#F9A8C9,#EE6FA8,#FCE8F3)",
    "gold": "linear-gradient(135deg,#FEF0E4,#F4C430,#F5C8A8)",
    "violet": "linear-gradient(135deg,#EEE4FA,#C4A0EC,#88C8F0)",
    "sky": "linear-gradient(135deg,#DCF0FC,#88C8F0,#EEE4FA)",
    "plum": "linear-gradient(135deg,#2D1B2E,#4A1942,#9B5DE5)",
}
DEFAULT_GRAD = "linear-gradient(135deg,#F5C8A8,#EE6FA8,#C4A0EC)"
CAT_EN = {"cadenas": "Chains", "aretes": "Earrings", "anillos": "Rings", "hombres": "Men", "pulseras": "Bracelets",
          "ear cuff": "Ear Cuff", "parejas": "Couples", "juegos": "Sets", "hand chain": "Hand Chain",
          "personalizado": "Custom", "gold edition": "Gold Edition", "colección": "Collection"}
HEART_PATH = ("M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23"
              "l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z")


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def js_num(n):
    """Número como lo escribe JS al concatenarlo (50 → "50", 33.5 → "33.5")."""
    n = float(n)
    return str(int(n)) if n.is_integer() else repr(n)


def js_round(x):
    return math.floor(x + 0.5)


def focal(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 50
    return max(0.0, min(100.0, n)) if math.isfinite(n) else 50


def zoom(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 1
    return max(1.0, min(4.0, n)) if math.isfinite(n) else 1


# ─── Imágenes ───────────────────────────────────────────────────────────────
def variant_url(url, w):
    return re.sub(r"\.(?:webp|jpe?g|png)$", f"-{w}.webp", str(url), flags=re.I)


def srcset(url):
    if not url or not OWN_IMG_RE.match(str(url)) or VARIANT_RE.search(str(url)):
        return ""
    return ", ".join(f"{variant_url(url, w)} {w}w" for w in IMG_WIDTHS)


def img_attrs(url, sizes):
    ss = srcset(url)
    out = f'src="{esc(url)}"'
    if ss:
        out += f' srcset="{esc(ss)}" sizes="{esc(sizes)}" data-src-orig="{esc(url)}"'
    return out


def local_image_path(root: Path, url):
    m = re.match(r"^(?:https://cacusabytaitus\.com)?(/ui_kits/store/images/[^/?#]+)$", str(url or ""))
    return (root / m.group(1).lstrip("/")) if m else None


def image_size(path):
    """(ancho, alto) de un WebP/PNG/JPEG leyendo solo la cabecera (sin Pillow: este script
    corre en CI sin dependencias). None si no se reconoce."""
    try:
        with open(path, "rb") as f:
            head = f.read(64 * 1024)
    except OSError:
        return None
    try:
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            chunk = head[12:16]
            if chunk == b"VP8X":
                w = 1 + int.from_bytes(head[24:27], "little")
                h = 1 + int.from_bytes(head[27:30], "little")
                return w, h
            if chunk == b"VP8 ":
                w, h = struct.unpack("<HH", head[26:30])
                return w & 0x3FFF, h & 0x3FFF
            if chunk == b"VP8L":
                b = head[21:25]
                w = 1 + (((b[1] & 0x3F) << 8) | b[0])
                h = 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
                return w, h
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", head[16:24])
        if head[:2] == b"\xff\xd8":
            i = 2
            while i < len(head) - 9:
                if head[i] != 0xFF:
                    i += 1
                    continue
                marker = head[i + 1]
                if marker in (0xC0, 0xC1, 0xC2):
                    h, w = struct.unpack(">HH", head[i + 5:i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", head[i + 2:i + 4])[0]
    except (struct.error, IndexError):
        return None
    return None


# ─── Precio / etiqueta como los calcula app.js (normalizeProd + _applyPricing) ──
def _promo_active(p, now):
    pr = p.get("promo")
    if not isinstance(pr, dict) or not pr.get("price"):
        return False
    ends = pr.get("endsAt")
    if ends:
        try:
            dt = datetime.fromisoformat(str(ends).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < now:
                return False
        except ValueError:
            pass
    return True


def card_view(p, surcharges, now=None):
    now = now or datetime.now(timezone.utc)
    tag = p.get("tag") or None
    badge = p.get("badge") or None
    if not badge and tag:
        t = str(tag).lower()
        badge = "badge-best" if t in ("bestseller", "best seller") else "badge-new" if t in ("nuevo", "new") else "badge-sale"
    base = float(p.get("price") or 0)
    price, original, is_promo = base, None, False
    if surcharges.get(str(p.get("id"))) is True:
        price = js_round2(base * 1.04)
    if _promo_active(p, now):
        original, price, is_promo = base, float(p["promo"]["price"]), True
        tag = p["promo"].get("label") or "Oferta"
        badge = "badge-promo"
    return {"price": price, "original": original, "is_promo": is_promo, "tag": tag, "badge": badge}


def tag_label(tag, lang):
    if not tag:
        return ""
    lc = str(tag).lower()
    if lc in ("nuevo", "new"):
        return "New" if lang == "en" else "Nuevo"
    if lc in ("bestseller", "best seller"):
        return "Bestseller" if lang == "en" else "Lo más vendido"
    return str(tag)


def is_bestseller(p):
    return str(p.get("tag") or "").lower() in ("bestseller", "best seller")


def home_rank(p, featured_ids, view):
    """Réplica de _homeRank() de app.js."""
    tg = str(p.get("tag") or "").lower()
    if is_bestseller(p):
        return 0
    if str(p.get("id")) in featured_ids:
        return 1
    if view["is_promo"] or view["badge"] in ("badge-promo", "badge-sale"):
        return 2
    if tg in ("nuevo", "new"):
        return 3
    return 4


def home_list(products, cfg, surcharges, n=HOME_N):
    home = cfg.get("home") if isinstance(cfg.get("home"), dict) else {}
    featured = {str(x) for x in (home.get("featuredProductIds") or [])} if isinstance(home.get("featuredProductIds"), list) else set()
    now = datetime.now(timezone.utc)
    rows = [(home_rank(p, featured, card_view(p, surcharges, now)), i, p)
            for i, p in enumerate(products) if p.get("available") is not False and p.get("imageUrl")]
    rows.sort(key=lambda r: (r[0], r[1]))
    return [p for _, _, p in rows[:n]]


def category_list(products, cat, surcharges, n=HOME_N):
    """Mismo filtro y orden "Destacados" que renderProducts() para una categoría."""
    now = datetime.now(timezone.utc)
    rows = []
    for i, p in enumerate(products):
        c = p.get("category") or p.get("cat") or ""
        if not (c == cat or c.startswith(cat)):
            continue
        v = card_view(p, surcharges, now)
        rank = 2 if p.get("available") is False else (0 if (v["badge"] in ("badge-sale", "badge-promo") or v["is_promo"]) else 1)
        rows.append((rank, i, p))
    rows.sort(key=lambda r: (r[0], r[1]))
    return [p for _, _, p in rows[:n]]


def _pid(p):
    pid = str(p.get("id", ""))
    return pid if re.fullmatch(r"\d{1,20}", pid) else None


def pcard_html(p, i, lang, surcharges, store_path):
    """Réplica de _pcardHtml() (con _noCardAnim, sin reseñas ni mercado: igual que el primer
    pintado del JS). Devuelve "" si el id no es numérico (va dentro de onclick)."""
    pid = _pid(p)
    if not pid:
        return ""
    en = lang == "en"
    v = card_view(p, surcharges)
    soldout = p.get("available") is False
    if soldout:
        badge_html = f'<div class="pcard-badge badge-soldout">{"Sold out" if en else "Agotado"}</div>'
    elif v["badge"]:
        badge_html = f'<div class="pcard-badge {esc(v["badge"])}">{esc(tag_label(v["tag"], lang))}</div>'
    else:
        badge_html = ""
    href = store_path + "producto/" + product_param(p, lang) + "/"
    grad = p.get("grad") or COLOR_GRADS.get(p.get("color")) or DEFAULT_GRAD
    img = ""
    if p.get("imageUrl"):
        pos = f"{js_num(focal(p.get('focalX')))}% {js_num(focal(p.get('focalY')))}%"
        alt = (p.get("name") or "") + (" — handcrafted personalized jewelry by CACUSA" if en else " — joyería artesanal personalizada CACUSA")
        img = (f'<img {img_attrs(p["imageUrl"], SIZES_CARD)} alt="{esc(alt)}"' + ("" if i < 4 else ' loading="lazy"') +
               (' fetchpriority="high"' if i == 0 else "") +
               f' decoding="async" width="220" height="220" data-grad="{esc(grad)}" style="object-position:{pos};transform:scale({js_num(zoom(p.get("zoom")))});transform-origin:{pos}">')
    bg = "" if p.get("imageUrl") else f"background:{grad}"
    cat = p.get("category") or p.get("cat") or ""
    cat_label = CAT_EN.get(cat.lower(), cat) if en else cat
    name = p.get("name_en") if (en and p.get("name_en")) else p.get("name")
    desc = (p.get("description_en") if (en and p.get("description_en")) else (p.get("description") or p.get("desc") or ""))[:60]
    price = v["price"]
    old = v["original"] if (v["is_promo"] and v["original"]) else (float(p["oldPrice"]) if p.get("oldPrice") else None)
    old_html = f'<span class="price-old">${old:.2f}</span>' if old else ""
    off = js_round((old - price) / old * 100) if (old and price and old > price) else 0
    off_html = f'<span class="price-off">-{off}%</span>' if off > 0 else ""
    wish_label = "Save to wishlist" if en else "Guardar en lista de deseos"
    return (
        f'<div class="pcard pcard--static{" pcard--soldout" if soldout else ""}" style="animation:none" data-id="{pid}" onclick="_pcardClick(event, {pid})">'
        f'{badge_html}'
        f'<button class="pcard-wish" aria-label="{wish_label}" onclick="toggleWish({pid},this)">'
        f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" stroke-width="2"><path d="{HEART_PATH}" style=""/></svg></button>'
        f'<a class="pcard-img" href="{esc(href)}" onclick="return _pcardNav(event, {pid})">'
        f'<div class="pcard-img-bg" style="{esc(bg)}">{img}</div>'
        f'<div class="pcard-quick">{"Quick view →" if en else "Vista rápida →"}</div></a>'
        f'<div class="pcard-body">'
        f'<div class="pcard-meta"><div class="pcard-cat">{esc(cat_label)}</div></div>'
        f'<a class="pcard-name" href="{esc(href)}" onclick="return _pcardNav(event, {pid})">{esc(name)}</a>'
        f'<div class="pcard-desc">{esc(desc)}…</div>'
        f'<div class="pcard-foot"><div class="pcard-price"><span class="price-now">${price:.2f}</span>{old_html}{off_html}</div>'
        f'<button class="pcard-add" onclick="openModal({pid})">{"+ View" if en else "+ Ver"}</button></div>'
        f'</div></div>'
    )


def home_grid_html(products, cfg, lang, surcharges, store_path):
    """Vista inicial de la tienda (= renderHomeView de app.js): "Más vendidos" + HOME_N tarjetas."""
    en = lang == "en"
    total = len(products)
    cards = [pcard_html(p, i, lang, surcharges, store_path) for i, p in enumerate(home_list(products, cfg, surcharges))]
    cards = [c for c in cards if c]
    if not cards:
        return skeletons_html()
    return "\n".join([
        f'<h2 class="grid-heading"><span>{"Best sellers" if en else "Más vendidos"}</span>'
        f'<button type="button" class="grid-viewall-link" data-viewall="1">{"View all" if en else "Ver todo"} ({total})</button></h2>',
        *cards,
        f'<div class="grid-viewall-wrap"><button type="button" class="grid-viewall" data-viewall="1">'
        f'{"View full catalog" if en else "Ver todo el catálogo"} ({total}) →</button></div>',
    ])


def category_grid_html(products, cat, lang, surcharges, store_path):
    cards = [pcard_html(p, i, lang, surcharges, store_path) for i, p in enumerate(category_list(products, cat, surcharges))]
    cards = [c for c in cards if c]
    return "\n".join(cards) if cards else skeletons_html()


def skeletons_html(n=8):
    return "\n".join([SKELETON] * n)


def replace_grid_block(html_text, inner):
    pat = re.compile(re.escape(GRID_START) + r".*?" + re.escape(GRID_END), re.S)
    if not pat.search(html_text):
        raise RuntimeError("No se encontraron los marcadores GRID_PRERENDER en la plantilla de la tienda")
    return pat.sub(lambda _: GRID_START + "\n" + inner + "\n" + GRID_END, html_text, count=1)


# ─── Acordeones de la ficha estática (= _accShipHtml/_accCareHtml/_accSizeHtml) ──
MAT_EN = {"baño de oro 18k": "18k gold plated", "acero inoxidable": "Stainless steel", "plata 925": "925 silver",
          "gold filled": "Gold filled", "baño de rodio": "Rhodium plated",
          "plata 925 con un baño de oro de 18k": "925 silver with 18k gold plating"}


def _money(n):
    n = float(n)
    return "$" + (str(int(n)) if n.is_integer() else f"{n:.2f}")


def is_ring(p):
    return str(p.get("category") or "").lower() == "anillos" or bool(
        re.search(r"\banillo|\bring\b", f'{p.get("name") or ""} {p.get("name_en") or ""}', re.I))


def _spec_text(v):
    return "" if v is None else re.sub(r"\s+", " ", str(v)).strip()[:40]


def product_specs(p, lang):
    en = lang == "en"
    num = lambda s: re.fullmatch(r"\d+(?:[.,]\d+)?", s) is not None  # noqa: E731
    out = []
    largo = _spec_text(p.get("largo"))
    if largo:
        out.append(("Length" if en else "Largo", largo.replace(",", ".") + " cm" if num(largo) else largo))
    raw_medida = p.get("medida") if (p.get("medida") is not None and str(p.get("medida")).strip() != "") else p.get("ancho")
    medida = _spec_text(raw_medida)
    if medida:
        out.append(("Dimensions" if en else "Medida", medida.replace(",", ".") + " cm" if num(medida) else medida))
    talla = _spec_text(p.get("talla"))
    if talla:
        label = ("Ring size" if en else "Talla") if is_ring(p) else ("Size" if en else "Talla")
        value = ("Adjustable" if en else "Ajustable") if re.fullmatch(r"(ajustable|adjustable)", talla, re.I) else talla
        out.append((label, value))
    return out


def accordions_html(p, cfg, lang, wa_number="17867375336"):
    en = lang == "en"
    pre = "/en/" if en else "/"
    sh = cfg.get("shipping") if isinstance(cfg.get("shipping"), dict) else {}
    cost, thr = _money(sh.get("cost", 10)), _money(sh.get("freeThreshold", 90))
    ec = f'{sh.get("transitDaysEcMin") or 1}–{sh.get("transitDaysEcMax") or 2}'
    us = f'{sh.get("transitDaysUsMin") or 2}–{sh.get("transitDaysUsMax") or 5}'
    texts = cfg.get("texts_en" if en else "texts") or {}
    custom = lambda k: texts.get(k).strip() if isinstance(texts.get(k), str) and texts.get(k).strip() else ""  # noqa: E731

    ship = []
    if custom("pdpShipping"):
        ship.append(f"<p>{esc(custom('pdpShipping'))}</p>")
    else:
        ship.append(f"<p>Shipping to the US and Ecuador: <strong>{cost}</strong>, <strong>free on orders from {thr}</strong>.</p>" if en else
                    f"<p>Envío a Ecuador y Estados Unidos: <strong>{cost}</strong>, <strong>gratis en compras desde {thr}</strong>.</p>")
        if p.get("personalized"):
            lead = ("Personalized piece: handmade in 5 to 10 business days after you confirm your design on WhatsApp, then shipped." if en else
                    "Pieza personalizable: se elabora a mano en 5 a 10 días hábiles desde que confirmas tu diseño por WhatsApp, y luego se despacha.")
        else:
            lead = "In-stock piece: ships in 1 to 3 business days." if en else "Pieza en stock: sale en 1 a 3 días hábiles."
        tail = (f"Delivery: US {us} business days (USPS), Ecuador {ec} business days (Servientrega). Other countries: we quote shipping on WhatsApp." if en else
                f"Entrega: Ecuador {ec} días hábiles (Servientrega), EE.UU. {us} días hábiles (USPS). Otros países: te cotizamos el envío por WhatsApp.")
        ship.append(f"<p>{lead} {tail}</p>")
        ship.append("<p>Returns: if your piece arrives with a manufacturing defect, message us within 48 hours of delivery and we'll repair or replace it. "
                    "We don't accept returns or exchanges for change of mind, taste or size.</p>" if en else
                    "<p>Devoluciones: si tu pieza llega con un defecto de fábrica, escríbenos dentro de las 48 horas desde la entrega y la reparamos o reemplazamos. "
                    "No aceptamos cambios por gusto, talla o cambio de opinión.</p>")
    ship.append(f'<p><a href="{pre}envios.html">{"Shipping policy" if en else "Política de envíos"}</a> · '
                f'<a href="{pre}devoluciones.html">{"Returns" if en else "Devoluciones"}</a></p>')

    mat_raw = str(p.get("material") or "").strip()
    mat = mat_raw.lower()
    care = []
    if mat_raw:
        care.append(f'<p><strong>Material:</strong> {esc(MAT_EN.get(mat, mat_raw) if en else mat_raw)}</p>')
    if custom("pdpCare"):
        care.append(f"<p>{esc(custom('pdpCare'))}</p>")
    else:
        if "acero" in mat:
            water = "Stainless steel handles water well: just dry it afterwards." if en else "El acero inoxidable resiste bien el agua: solo sécalo después."
        elif "gold filled" in mat:
            water = ("Gold filled tolerates moisture better, but take it off for the beach and the pool." if en else
                     "El gold filled tolera mejor la humedad, pero quítatelo para el mar y la piscina.")
        else:
            water = "Take it off before showering, swimming or washing dishes." if en else "Quítatela antes de ducharte, nadar o lavar los platos."
        care.append(f"<p>{water} " + ("Avoid perfume, lotion, alcohol and sunscreen. Store it dry, in its pouch and apart from other jewelry." if en else
                                      "Evita perfumes, cremas, alcohol y protector solar. Guárdala seca, en su bolsita y separada de otras joyas.") + "</p>")
    care.append(f'<p><a href="{pre}cuidados.html">{"Jewelry care guide" if en else "Guía de cuidados"}</a></p>')

    specs = product_specs(p, lang)
    size = []
    if specs:
        size.append("<dl>" + "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in specs) + "</dl>")
    if custom("pdpSize"):
        size.append(f"<p>{esc(custom('pdpSize'))}</p>")
    elif not specs:
        size.append("<p>You'll find this piece's measurements in its description.</p>" if en else "<p>Las medidas de esta pieza están en su descripción.</p>")
    guide = (("Ring size guide" if en else "Guía de tallas de anillos") if is_ring(p) else ("Size and length guide" if en else "Guía de tallas y largos"))
    size.append(f'<p><a href="{pre}guia-tallas.html">{guide}</a></p>')
    num = re.sub(r"\D", "", str(wa_number or "")) or "17867375336"
    name = p.get("name_en") if (en and p.get("name_en")) else p.get("name")
    from urllib.parse import quote
    wa = f"https://wa.me/{num}?text=" + quote(("Hi! I have a question about the size of: " if en else "¡Hola! Tengo una duda sobre la talla de: ") + str(name or ""), safe="")
    size.append(f'<p>{"Not sure about the size or length? " if en else "¿Dudas con la talla o el largo? "}'
                f'<a href="{esc(wa)}" target="_blank" rel="noopener">{"Message us on WhatsApp" if en else "Escríbenos por WhatsApp"}</a></p>')

    def acc(title, body):
        return f'<details class="pdp-acc"><summary>{title}</summary><div class="pdp-acc-body">{"".join(body)}</div></details>'

    return ('<div class="pdp-accs">' +
            acc("Shipping &amp; returns" if en else "Envío y devoluciones", ship) +
            acc("Materials &amp; care" if en else "Materiales y cuidado", care) +
            acc("Size &amp; measurements" if en else "Medidas y talla", size) +
            "</div>")
