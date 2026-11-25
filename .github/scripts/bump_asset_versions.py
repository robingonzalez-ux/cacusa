#!/usr/bin/env python3
"""Pone ?v=<hash del contenido> en las referencias a app.js y styles.css de las 2
plantillas de la tienda (ui_kits/store/index.html y en/). GitHub Pages cachea 10 min;
con el hash en la URL, un cambio en el JS o el CSS llega a todas las páginas en cuanto
se publica, sin mezclar un HTML nuevo con un JS viejo.

Corre primero en .github/workflows/product-schema.yml — las páginas físicas de
producto/categoría se copian de las plantillas después, así que heredan el mismo ?v=.
Idempotente: sin cambios en los archivos, no toca nada.

25 nov: photo-search.js ("Buscar por foto") no está en las plantillas — lo carga app.js al
tocar el botón (PHOTO_SEARCH_SRC). Su ?v= se escribe primero DENTRO de los 2 app.js, y recién
después se calcula el hash de app.js, así un cambio en photo-search.js también cambia el de app.js.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ["/ui_kits/store/app.js", "/en/ui_kits/store/app.js", "/ui_kits/store/styles.css"]
TEMPLATES = [ROOT / "ui_kits/store/index.html", ROOT / "en/ui_kits/store/index.html"]
LAZY_ASSET = "/ui_kits/store/photo-search.js"
LAZY_LOADERS = [ROOT / "ui_kits/store/app.js", ROOT / "en/ui_kits/store/app.js"]


def version(asset):
    return hashlib.sha1((ROOT / asset.lstrip("/")).read_bytes()).hexdigest()[:10]


def bump_lazy_asset():
    v = version(LAZY_ASSET)
    pat = re.compile(r"(['\"])" + re.escape(LAZY_ASSET) + r"(?:\?v=[\w]*)?(['\"])")
    for js in LAZY_LOADERS:
        src = js.read_text(encoding="utf-8")
        new = pat.sub(lambda m: m.group(1) + LAZY_ASSET + "?v=" + v + m.group(2), src)
        if new != src:
            js.write_text(new, encoding="utf-8")
            print(f"{js.relative_to(ROOT)}: versión de photo-search.js actualizada")


def main():
    bump_lazy_asset()
    versions = {a: version(a) for a in ASSETS}
    for tpl in TEMPLATES:
        html = tpl.read_text(encoding="utf-8")
        new = html
        for asset, v in versions.items():
            pat = re.compile(r'((?:src|href)=")' + re.escape(asset) + r'(?:\?v=[\w]*)?(")')
            new = pat.sub(lambda m: m.group(1) + asset + "?v=" + v + m.group(2), new)
        if new != html:
            tpl.write_text(new, encoding="utf-8")
            print(f"{tpl.relative_to(ROOT)}: versiones actualizadas")
        else:
            print(f"{tpl.relative_to(ROOT)}: sin cambios")


if __name__ == "__main__":
    main()
