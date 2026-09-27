#!/usr/bin/env python3
"""
Genera la versión estática en inglés de las 9 guías (en/<archivo>.html) a
partir del archivo en español, aplicando del lado del servidor el mismo
diccionario de traducción que la propia página aplica con JavaScript.

Por qué existe: las guías son páginas de una sola URL con selector de idioma
en el cliente (data-i18n + objeto I18N_EN / config.translations.en de
data/products.json, window.cacusaLang). Google solo veía el español: la
versión en inglés no existía como URL rastreable (auditoría SEO). Este
script produce una URL /en/ real por guía, con <html lang="en">, title/meta/
og en inglés, canonical y hreflang recíprocos, JSON-LD (Article +
BreadcrumbList) y links internos apuntando a las versiones /en/.

Cómo traduce (emula el JS de cada página, no un diccionario aparte):
  1. data-i18n → innerHTML, con el diccionario resultante de combinar
     config.translations.en (si la página lo usa), I18N_EN y cualquier otro
     objeto literal de traducciones declarado en el script (ej. `cui6` en
     cuidados.html) — mismo orden en que el JS los aplica.
  2. Los setters por id dentro del bloque `if(_L==='en'){...}`:
     st()/setTxt() → textContent; `x.innerHTML=pgEn.k||'...'` → innerHTML;
     con los valores de config.pages_en de data/products.json y el texto
     de respaldo escrito en el propio JS.
  3. document.title='...' del bloque EN → <title>, og:title y el headline
     del JSON-LD. La meta description EN (que el JS nunca traduce) sale de
     META_DESC_EN, abajo.
  Si aparece en el bloque EN un patrón que este script no sabe emular, falla
  en vez de publicar una página a medio traducir.

La página EN fija el idioma (`var _L='en';` en vez de leer localStorage),
igual que en/index.html fija __LANG, así el JS de la página nunca la vuelve
a pasar a español. El selector ES/EN son links <a href> reales entre las
dos URLs (guardan además la preferencia en localStorage, como antes).

Uso:
  python3 .github/scripts/generate_en_guides.py            # regenera en/*.html
  python3 .github/scripts/generate_en_guides.py --check    # exit 1 si algo cambiaría
  python3 .github/scripts/generate_en_guides.py --sync-es  # además reescribe el bloque
        SEO (canonical/hreflang/og/JSON-LD) de las guías en español, derivado de su
        propio <title>/<meta description> — solo a mano, el workflow no lo usa.

Corre automático vía .github/workflows/en-guides.yml. Es determinístico: sin
cambios en la fuente, la salida es idéntica byte a byte.

Los en/<guía>.html son generados — no editarlos a mano: editar el archivo en
español (y su diccionario I18N_EN) y dejar que este script los regenere.
"""
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_product_schema import (  # noqa: E402
    BASE_URL,
    PRODUCTS_JSON,
    ROOT,
    category_page_url,
    json_for_script_tag,
    product_page_url,
)

GUIDES = [
    "guias.html",
    "guia-tallas.html",
    "guia-regalos.html",
    "cuidados.html",
    "significado-piedras.html",
    "como-combinar-joyas.html",
    "regalos-hombre-y-joyeria-religiosa.html",
    "envios.html",
    "devoluciones.html",
]

ORG_ID = f"{BASE_URL}/#organization"
OG_IMAGE = f"{BASE_URL}/assets/og-image.jpg"
TITLE_SUFFIX = " — CACUSA by Taitus"
SEO_START = "<!-- GUIDE_SEO:START (generado por .github/scripts/generate_en_guides.py) -->"
SEO_END = "<!-- GUIDE_SEO:END -->"
SEO_BLOCK_RE = re.compile(r"<!-- GUIDE_SEO:START[^>]*-->.*?<!-- GUIDE_SEO:END -->", re.DOTALL)

# La meta description no la traduce el JS de ninguna guía — se escribe acá.
META_DESC_EN = {
    "guias.html": "CACUSA by Taitus guides — ring and chain sizing, gift ideas, jewelry care, birthstone meanings and how to combine your pieces.",
    "guia-tallas.html": "CACUSA by Taitus size guide — how to measure your ring size at home, a ring size conversion chart, and a necklace and chain length guide.",
    "guia-regalos.html": "CACUSA by Taitus gift guide — which jewelry to give for Valentine's Day, birthdays, anniversaries or Mother's Day, with ideas by occasion and personalization options.",
    "cuidados.html": "How to care for your CACUSA by Taitus jewelry — tips to clean, store and preserve 925 sterling silver, 18k gold-plated and stainless steel pieces for longer.",
    "significado-piedras.html": "Birthstone meanings by month — the history, color and traditional meaning of each birthstone, from January to December.",
    "como-combinar-joyas.html": "How to combine your jewelry — mixing metals, stacking rings and layering necklaces without overdoing it. A practical styling guide.",
    "regalos-hombre-y-joyeria-religiosa.html": "CACUSA by Taitus guide — jewelry gifts for him and religious pieces: crosses, Saint Benedict medals and guardian angels, with personalization options.",
    "envios.html": "CACUSA by Taitus shipping policy — delivery times, costs, the free-shipping threshold and coverage in Ecuador and the United States.",
    "devoluciones.html": "CACUSA by Taitus return policy — how we handle manufacturing defects within 48 hours for our handcrafted, made-to-order jewelry.",
}
# Solo se usa si el bloque EN del JS no trae document.title.
TITLE_EN_FALLBACK = {
    "guias.html": "Guides — CACUSA by Taitus",
}

CRUMBS = {
    "es": [("Inicio", f"{BASE_URL}/"), ("Guías", f"{BASE_URL}/guias.html")],
    "en": [("Home", f"{BASE_URL}/en/"), ("Guides", f"{BASE_URL}/en/guias.html")],
}

JS_STR = r"""'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*\""""


class GenError(RuntimeError):
    pass


# ---------------------------------------------------------------- JS helpers

def js_unquote(lit):
    """Decodifica un literal de string JS ('...' o "...")."""
    body = lit[1:-1]
    out = []
    i = 0
    simple = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
    while i < len(body):
        c = body[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        n = body[i + 1]
        if n in simple:
            out.append(simple[n])
            i += 2
        elif n == "u":
            if body[i + 2] == "{":
                j = body.index("}", i)
                out.append(chr(int(body[i + 3:j], 16)))
                i = j + 1
            else:
                out.append(chr(int(body[i + 2:i + 6], 16)))
                i += 6
        elif n == "x":
            out.append(chr(int(body[i + 2:i + 4], 16)))
            i += 4
        else:
            out.append(n)
            i += 2
    return "".join(out)


def parse_object_literal(src, start):
    """Parsea un objeto literal JS de pares 'clave': 'string' desde src[start]=='{'.
    Devuelve (dict, índice después de '}')."""
    assert src[start] == "{"
    i = start + 1
    result = {}
    tok = re.compile(r"\s*(?://[^\n]*\n\s*)*")
    key_re = re.compile(r"(" + JS_STR + r"|[A-Za-z_$][\w$]*)\s*:\s*")
    val_re = re.compile(r"(" + JS_STR + r")\s*")
    while True:
        i = tok.match(src, i).end()
        if src[i] == "}":
            return result, i + 1
        m = key_re.match(src, i)
        if not m:
            raise GenError(f"Objeto literal no soportado cerca de: {src[i:i+60]!r}")
        key = js_unquote(m.group(1)) if m.group(1)[0] in "'\"" else m.group(1)
        i = m.end()
        m = val_re.match(src, i)
        if not m:
            raise GenError(f"Valor no-string en el diccionario ({key}): {src[i:i+60]!r}")
        result[key] = js_unquote(m.group(1))
        i = m.end()
        i = tok.match(src, i).end()
        if src[i] == ",":
            i += 1


def find_block(src, start):
    """Dado src[start]=='{', devuelve el índice del '}' que lo cierra (saltando strings)."""
    depth = 0
    i = start
    while i < len(src):
        c = src[i]
        if c in "'\"`":
            j = i + 1
            while src[j] != c:
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise GenError("Bloque sin cerrar")


def main_script(src):
    scripts = [m for m in re.finditer(r"<script>(.*?)</script>", src, re.DOTALL)]
    if len(scripts) != 1:
        raise GenError(f"Se esperaba exactamente 1 <script> inline, hay {len(scripts)}")
    return scripts[0].group(1)


# -------------------------------------------------------------- HTML helpers

TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(/?)>")
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path"}


def element_inner_span(src, open_end, tag):
    """Dado el fin del tag de apertura, devuelve (inicio, fin) del contenido interno."""
    depth = 1
    for m in TAG_RE.finditer(src, open_end):
        if m.group(2).lower() != tag:
            continue
        if m.group(1):
            depth -= 1
            if depth == 0:
                return open_end, m.start()
        elif not m.group(3):
            depth += 1
    raise GenError(f"No se encontró el cierre de <{tag}>")


def apply_i18n(src, dictionary, missing):
    """Emula document.querySelectorAll('[data-i18n]').forEach(el => el.innerHTML = T[key])."""
    attr_re = re.compile(r"<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\bdata-i18n=\"([^\"]+)\"[^>]*>")
    body_start = src.index("<body")
    script_start = src.index("<script>", body_start)
    pos = body_start
    while True:
        m = attr_re.search(src, pos, script_start)
        if not m:
            return src
        tag, key = m.group(1).lower(), m.group(2)
        s, e = element_inner_span(src, m.end(), tag)
        if key in dictionary:
            new = dictionary[key]
            src = src[:s] + new + src[e:]
            script_start += len(new) - (e - s)
            pos = s + len(new)
        else:
            missing.append(key)
            pos = m.end()


def set_by_id(src, el_id, value, as_html):
    m = re.search(r"<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*(?<![\w-])id=\"" + re.escape(el_id) + r"\"[^>]*>", src)
    if not m:
        raise GenError(f"No existe el elemento #{el_id}")
    s, e = element_inner_span(src, m.end(), m.group(1).lower())
    new = value if as_html else html.escape(value, quote=False)
    return src[:s] + new + src[e:]


LANG_SW_RE = re.compile(r'<div class="lang-sw">.*?</div>', re.DOTALL)


def switcher_html(fname, active):
    """Selector ES/EN con <a href> reales (rastreables); el onclick guarda la
    preferencia en localStorage vía cacusaLang() y navega a la otra URL."""
    on = ' class="on" aria-current="page"'
    es_on, en_on = (on, "") if active == "es" else ("", on)
    return (
        '<div class="lang-sw">'
        f'<a id="lEs"{es_on} href="/{fname}" hreflang="es" lang="es" onclick="cacusaLang(\'es\');return false">ES</a>'
        f'<a id="lEn"{en_on} href="/en/{fname}" hreflang="en" lang="en" onclick="cacusaLang(\'en\');return false">EN</a>'
        "</div>"
    )


def attr(v):
    return html.escape(v, quote=True)


# ------------------------------------------------------------------- lógica

def load_data():
    return json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))


def en_block(script):
    m = re.search(r"if\(_L==='en'\)\{", script)
    if not m:
        raise GenError("No se encontró el bloque if(_L==='en'){...}")
    start = m.end() - 1
    end = find_block(script, start)
    return script[start + 1:end]


def translate(fname, src, data):
    """Devuelve (html_traducido, título_en, faltantes)."""
    script = main_script(src)
    block = en_block(script)
    cfg = data.get("config", {})

    # 1) diccionario data-i18n, en el orden en que el JS lo aplica
    dictionary = {}
    if "cfg.translations" in block:
        dictionary.update(cfg.get("translations", {}).get("en", {}) or {})
    for m in re.finditer(r"\b(?:const|let|var)\s+(\w+)\s*=\s*\{\s*['\"]", script):
        obj, _ = parse_object_literal(script, script.index("{", m.start()))
        dictionary.update(obj)

    missing = []
    out = apply_i18n(src, dictionary, missing)

    # 2) setters por id dentro del bloque EN
    page_key = None
    pm = re.search(r"cfg\.pages_en&&cfg\.pages_en\.(\w+)", block)
    if pm:
        page_key = pm.group(1)
    pg_en = (cfg.get("pages_en", {}) or {}).get(page_key, {}) if page_key else {}

    consumed = block
    ops = []
    patterns = [
        # st('id', pgEn.k || 'fallback')  /  setTxt('id', pgEn.k)
        (re.compile(r"(?:st|setTxt)\(\s*'([\w-]+)'\s*,\s*pgEn\.(\w+)\s*(?:\|\|\s*(" + JS_STR + r"))?\s*\);?"),
         lambda m: ("text", m.group(1), pg_en.get(m.group(2)) or (js_unquote(m.group(3)) if m.group(3) else None))),
        # if(pgEn.k){const el=document.getElementById('id');if(el)el.textContent=pgEn.k;}
        (re.compile(r"if\(pgEn\.(\w+)\)\{const (\w+)=document\.getElementById\('([\w-]+)'\);if\(\2\)\2\.textContent=pgEn\.\1;\}"),
         lambda m: ("text", m.group(3), pg_en.get(m.group(1)) or None)),
        # const x=document.getElementById('id'); if(x){const t=pgEn.k||'fb';x.innerHTML='a'+t+'b';}
        (re.compile(r"const (\w+)=document\.getElementById\('([\w-]+)'\);\s*if\(\1\)\{const (\w+)=pgEn\.(\w+)\|\|(" + JS_STR + r");\1\.innerHTML=(" + JS_STR + r")\+\3\+(" + JS_STR + r");\}"),
         lambda m: ("html", m.group(2), js_unquote(m.group(6)) + (pg_en.get(m.group(4)) or js_unquote(m.group(5))) + js_unquote(m.group(7)))),
        # const x=document.getElementById('id'); if(x)x.innerHTML=pgEn.k||'fb';   /  ='literal';
        (re.compile(r"const (\w+)=document\.getElementById\('([\w-]+)'\);\s*if\(\1\)\1\.innerHTML=(?:pgEn\.(\w+)\|\|)?(" + JS_STR + r");"),
         lambda m: ("html", m.group(2), (pg_en.get(m.group(3)) if m.group(3) else None) or js_unquote(m.group(4)))),
    ]
    for rx, fn in patterns:
        for m in rx.finditer(block):
            ops.append((m.start(), fn(m)))
            consumed = consumed.replace(m.group(0), "", 1)
    leftover = re.sub(r"document\.querySelectorAll\(.*?el\.innerHTML=v;\}\);", "", consumed)
    if "pgEn." in leftover or "innerHTML" in leftover or "textContent" in leftover:
        raise GenError(f"{fname}: el bloque EN tiene asignaciones que este script no sabe emular:\n{leftover}")
    for _, (kind, el_id, value) in sorted(ops, key=lambda o: o[0]):
        if value:
            out = set_by_id(out, el_id, value, kind == "html")

    # 3) título
    tm = re.search(r"document\.title=(" + JS_STR + r");", block)
    title = js_unquote(tm.group(1)) if tm else TITLE_EN_FALLBACK.get(fname)
    if not title:
        raise GenError(f"{fname}: sin título EN")
    return out, title, missing


def build_seo_block(fname, lang, title, desc):
    es_url = f"{BASE_URL}/{fname}"
    en_url = f"{BASE_URL}/en/{fname}"
    url = en_url if lang == "en" else es_url
    headline = title[:-len(TITLE_SUFFIX)] if title.endswith(TITLE_SUFFIX) else title
    crumbs = list(CRUMBS[lang])
    if fname != "guias.html":
        crumbs.append((headline, url))
    org = {
        "@type": "Organization",
        "@id": ORG_ID,
        "name": "CACUSA by Taitus",
        "url": BASE_URL,
        "logo": {"@type": "ImageObject", "url": f"{BASE_URL}/assets/icon-512.jpg"},
    }
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "@id": url + "#article",
                "headline": headline,
                "description": desc,
                "inLanguage": lang,
                "url": url,
                "image": OG_IMAGE,
                "mainEntityOfPage": {"@type": "WebPage", "@id": url},
                "author": org,
                "publisher": org,
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": i + 1, "name": n, "item": u}
                    for i, (n, u) in enumerate(crumbs)
                ],
            },
        ],
    }
    locale, alt = ("en_US", "es_EC") if lang == "en" else ("es_EC", "en_US")
    lines = [
        SEO_START,
        f'<link rel="canonical" href="{url}">',
        f'<link rel="alternate" hreflang="es" href="{es_url}">',
        f'<link rel="alternate" hreflang="en" href="{en_url}">',
        f'<link rel="alternate" hreflang="x-default" href="{es_url}">',
        f'<meta property="og:title" content="{attr(title)}">',
        f'<meta property="og:description" content="{attr(desc)}">',
        f'<meta property="og:image" content="{OG_IMAGE}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:url" content="{url}">',
        '<meta property="og:type" content="article">',
        f'<meta property="og:locale" content="{locale}">',
        f'<meta property="og:locale:alternate" content="{alt}">',
        '<meta property="og:site_name" content="CACUSA by Taitus">',
        f'<script type="application/ld+json">{json_for_script_tag(ld)}</script>',
        SEO_END,
    ]
    return "\n".join(lines)


def put_seo_block(src, block):
    if SEO_BLOCK_RE.search(src):
        return SEO_BLOCK_RE.sub(lambda _: block, src, count=1)
    new, n = re.subn(r'<link rel="canonical" href="[^"]*">', lambda _: block, src, count=1)
    if n != 1:
        raise GenError("Sin <link rel=canonical> ni bloque GUIDE_SEO")
    return new


def get_title(src):
    return html.unescape(re.search(r"<title>(.*?)</title>", src, re.DOTALL).group(1).strip())


def get_desc(src):
    return html.unescape(re.search(r'<meta name="description" content="([^"]*)">', src).group(1))


def es_with_seo(fname, src):
    return put_seo_block(src, build_seo_block(fname, "es", get_title(src), get_desc(src)))


class LinkMapper:
    def __init__(self, data):
        self.products = {str(p.get("id")): p for p in data.get("products", [])}
        self.guides = set(GUIDES)

    def __call__(self, href, fname):
        if re.match(r"^(?:[a-z][a-z0-9+.-]*:|#|//)", href, re.I):
            return href
        path = href[2:] if href.startswith("./") else href.lstrip("/")
        if path.startswith("en/"):
            return "/" + path
        base, _, query = path.partition("?")
        if base in ("", "index.html"):
            return "/en/"
        if base in self.guides or base == "cacusa-lovers.html":
            return "/en/" + base
        if base.startswith("ui_kits/store/"):
            rest = base[len("ui_kits/store/"):]
            q = dict(kv.split("=", 1) for kv in query.split("&") if "=" in kv)
            if "p" in q:
                rest = "producto/" + q["p"] + "/"
            elif "cat" in q:
                return category_page_url(unquote(q["cat"]), "en", "/en/ui_kits/store/")[len(BASE_URL):]
            pm = re.match(r"producto/(?:.*-)?(\d+)/$", rest)
            if pm:
                p = self.products.get(pm.group(1))
                if not p:
                    raise GenError(f"{fname}: link a producto inexistente ({href})")
                return product_page_url(p, "en", "/en/ui_kits/store/")[len(BASE_URL):]
            return "/en/ui_kits/store/" + rest
        return "/" + path


def build_en(fname, data, mapper):
    src = (ROOT / fname).read_text(encoding="utf-8")
    out, title, missing = translate(fname, src, data)
    desc = META_DESC_EN[fname]

    out = re.sub(r"<title>.*?</title>", lambda _: f"<title>{html.escape(title, quote=False)}</title>", out, count=1, flags=re.DOTALL)
    out, n = re.subn(r'<meta name="description" content="[^"]*">', lambda _: f'<meta name="description" content="{attr(desc)}">', out, count=1)
    if n != 1:
        raise GenError(f"{fname}: sin meta description")
    out = put_seo_block(out, build_seo_block(fname, "en", title, desc))

    out, n = re.subn(r'<html lang="es">', '<html lang="en">', out, count=1)
    if n != 1:
        raise GenError(f'{fname}: sin <html lang="es">')

    # Fijar el idioma: el JS de la página nunca vuelve a leer localStorage acá.
    out, n = re.subn(r"var _L=localStorage\.getItem\('cacusa-lang'\)\|\|'es';",
                     "var _L='en'; // página EN generada: idioma fijo, igual que __LANG en en/index.html", out)
    if n != 1:
        raise GenError(f"{fname}: no se encontró la lectura de _L desde localStorage")

    # Links internos → equivalentes /en/ (también dentro de strings del JS,
    # para que las traducciones que el JS reaplica en runtime queden iguales).
    out = re.sub(r'href="([^"]*)"', lambda m: f'href="{mapper(m.group(1), fname)}"', out)

    # Selector ES/EN: links reales entre las dos URLs, EN marcado como activo
    # (va después del mapeo de links para que el link a ES no se reescriba).
    out, n = LANG_SW_RE.subn(lambda _: switcher_html(fname, "en"), out, count=1)
    if n != 1:
        raise GenError(f"{fname}: selector de idioma con formato inesperado")
    for bad in ("'./data/", '"./data/'):
        if bad in out:
            raise GenError(f"{fname}: ruta relativa a data/ que se rompe en /en/")

    banner = (f"<!-- GENERADO automáticamente por .github/scripts/generate_en_guides.py a partir de /{fname} "
              f"— NO editar a mano: editar el archivo en español (y su diccionario I18N_EN) y regenerar. -->")
    if not out.startswith("<!DOCTYPE html>\n"):
        raise GenError(f"{fname}: se esperaba <!DOCTYPE html> al inicio")
    out = out.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + banner + "\n", 1)
    return out, missing


def main():
    data = load_data()
    mapper = LinkMapper(data)
    check = "--check" in sys.argv
    sync_es = "--sync-es" in sys.argv
    changed_any = False
    (ROOT / "en").mkdir(exist_ok=True)
    for fname in GUIDES:
        es_path = ROOT / fname
        es_src = es_path.read_text(encoding="utf-8")
        es_new = es_with_seo(fname, es_src)
        if es_new != es_src:
            if sync_es:
                es_path.write_text(es_new, encoding="utf-8")
                print(f"{fname}: bloque SEO (ES) actualizado")
            else:
                print(f"AVISO {fname}: el bloque SEO en español no está al día — correr con --sync-es", file=sys.stderr)
        for m in re.finditer(r'href="\./ui_kits/store/producto/(?:[^"/]*-)?(\d+)/"', es_src):
            prod = mapper.products.get(m.group(1))
            want = "./" + product_page_url(prod, "es", "/ui_kits/store/")[len(BASE_URL) + 1:] if prod else None
            if want != m.group(0)[6:-1]:
                print(f"AVISO {fname}: link a producto desactualizado ({m.group(0)[6:-1]} → {want})", file=sys.stderr)
        out, missing = build_en(fname, data, mapper)
        if missing:
            print(f"AVISO {fname}: claves data-i18n sin traducción EN: {', '.join(sorted(set(missing)))}", file=sys.stderr)
        en_path = ROOT / "en" / fname
        old = en_path.read_text(encoding="utf-8") if en_path.exists() else None
        if old == out:
            print(f"en/{fname}: sin cambios")
            continue
        changed_any = True
        if not check:
            en_path.write_text(out, encoding="utf-8")
        print(f"en/{fname}: {'cambiaría' if check else 'actualizado'}")
    if check:
        sys.exit(1 if changed_any else 0)


if __name__ == "__main__":
    try:
        main()
    except GenError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
