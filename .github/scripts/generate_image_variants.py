#!/usr/bin/env python3
"""
Genera variantes WebP responsivas de las fotos del catálogo (wave 2, "imágenes más rápidas"):
por cada ui_kits/store/images/<nombre>.(webp|jpg|jpeg|png) escribe al lado
<nombre>-320.webp, <nombre>-640.webp y <nombre>-960.webp.

La tienda (ui_kits/store/app.js y en/, store_prerender.py para el HTML estático) arma el
srcset con esos 3 nombres fijos y descriptores 320w/640w/960w, así que siempre se generan los 3
y cada uno mide exactamente ese ancho (si la original es más angosta se escala hacia arriba:
el navegador la mostraría igual de agrandada, y un archivo más angosto que su descriptor hace
que calcule mal la densidad). Mientras una variante no exista (foto recién subida desde el panel, antes de que corra
este paso), el navegador cae a la original gracias al listener de 'error' de las plantillas.

Idempotente: una variante que ya existe no se vuelve a escribir (el panel sube cada foto con un
nombre nuevo, con la fecha adelante; git no conserva fechas de archivo, así que no se compara
por fecha). Para regenerar una variante a propósito, borrarla. Nunca procesa sus propias
salidas (*-320/-640/-960.webp) como originales. Borra las variantes huérfanas (su original ya
no existe) para no dejar basura cuando el panel borra una foto.

Corre en .github/workflows/image-variants.yml (cada vez que cambia ui_kits/store/images/**).
Necesita Pillow (pip install Pillow). Uso: python3 generate_image_variants.py [--check]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
IMAGES = ROOT / "ui_kits" / "store" / "images"
WIDTHS = (320, 640, 960)
QUALITY = 78
VARIANT_RE = re.compile(r"-(?:320|640|960)\.webp$", re.I)
ORIG_EXT = {".webp", ".jpg", ".jpeg", ".png"}


def variant_path(orig: Path, w: int) -> Path:
    return orig.with_name(f"{orig.stem}-{w}.webp")


def originals():
    if not IMAGES.exists():
        return []
    return sorted(p for p in IMAGES.iterdir()
                  if p.is_file() and p.suffix.lower() in ORIG_EXT and not VARIANT_RE.search(p.name))


def main():
    check = "--check" in sys.argv
    try:
        from PIL import Image, ImageOps
    except ImportError:
        sys.exit("Falta Pillow: pip install Pillow")
    written = skipped = removed = failed = 0
    origs = originals()
    expected = set()
    for orig in origs:
        targets = [(w, variant_path(orig, w)) for w in WIDTHS]
        expected.update(t for _, t in targets)
        todo = [(w, t) for w, t in targets if not t.exists()]
        if not todo:
            skipped += len(targets)
            continue
        if check:
            written += len(todo)
            continue
        try:
            with Image.open(orig) as src:
                im = ImageOps.exif_transpose(src)
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
                for w, target in todo:
                    tmp = target.with_name(target.name + ".tmp")
                    # Cada variante mide EXACTAMENTE w px de ancho (aunque la original sea más
                    # angosta): el srcset declara "320w/640w/960w" y, si el archivo midiera menos,
                    # el navegador calcularía mal la densidad (foto "agrandada", LCP mal medido).
                    if im.width != w:
                        out = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
                    else:
                        out = im
                    out.save(tmp, "WEBP", quality=QUALITY, method=6)
                    tmp.replace(target)
                    written += 1
        except Exception as e:  # una foto rota no frena las demás
            failed += 1
            print(f"Aviso: no se pudo procesar {orig.name}: {e}")
    # Variantes huérfanas (la original ya no existe)
    for p in sorted(IMAGES.glob("*.webp")) if IMAGES.exists() else []:
        if VARIANT_RE.search(p.name) and p not in expected:
            if not check:
                p.unlink()
            removed += 1
    print(f"{len(origs)} originales · {written} variantes {'por escribir' if check else 'escritas'} · "
          f"{skipped} ya estaban · {removed} huérfanas {'por borrar' if check else 'borradas'} · {failed} con error")
    if check:
        sys.exit(1 if (written or removed) else 0)


if __name__ == "__main__":
    main()
