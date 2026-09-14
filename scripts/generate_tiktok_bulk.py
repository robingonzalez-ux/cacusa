#!/usr/bin/env python3
"""
Genera la hoja de carga masiva de TikTok Shop (categoria "Costume Jewelry &
Accessories") a partir de data/products.json, incluyendo solo productos
nuevos o modificados desde la ultima exportacion (data/tiktok_export_log.json).

Uso: python scripts/generate_tiktok_bulk.py
Sale sin generar nada (exit 0, sin archivo) si no hay productos nuevos/cambiados.
Escribe el resultado en exports/tiktok_bulk_<timestamp>.xlsx y actualiza el log.
"""
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS_PATH = os.path.join(REPO_ROOT, 'data', 'products.json')
LOG_PATH = os.path.join(REPO_ROOT, 'data', 'tiktok_export_log.json')
TEMPLATE_PATH = os.path.join(REPO_ROOT, 'data', 'tiktok_template.xlsx')
EXPORTS_DIR = os.path.join(REPO_ROOT, 'exports')

# ── openpyxl no lee bien los colores invalidos que trae la plantilla de TikTok ──
import openpyxl.styles.colors as colors_mod
from openpyxl.descriptors.base import Typed
def _lenient_rgb_set(self, instance, value):
    if value is not None and not colors_mod.aRGB_REGEX.match(str(value)):
        value = '00000000'
    Typed.__set__(self, instance, value)
colors_mod.RGB.__set__ = _lenient_rgb_set

import openpyxl

BRAND = 'cacusa by taitus (7672070362844317447)'

# CACUSA category -> grupo de TikTok (texto de categoria + si aplica choking hazard)
CATEGORY_GROUPS = {
    'Anillos':   ('Costume Jewelry & Accessories/Rings', False),
    'Cadenas':   ('Costume Jewelry & Accessories/Necklaces', True),
    'Hombres':   ('Costume Jewelry & Accessories/Necklaces', True),
    'Juegos':    ('Costume Jewelry & Accessories/Necklaces', True),
    'Hand chain': ('Costume Jewelry & Accessories/Bracelets & Bangles', True),
    'Pulseras':  ('Costume Jewelry & Accessories/Bracelets & Bangles', True),
    'Parejas':   ('Costume Jewelry & Accessories/Bracelets & Bangles', True),
    'Aretes':    ('Costume Jewelry & Accessories/Earrings', True),
    'Ear cuff':  ('Costume Jewelry & Accessories/Earrings', True),
}

# Opciones validas de "Material" por sub-categoria (extraidas de la plantilla real
# de TikTok descargada el 2026-09-10). Si el material CACUSA no tiene un match
# exacto para esa categoria, se usa 'Metal' (presente en las 4 listas).
MATERIAL_OPTIONS = {
    'Costume Jewelry & Accessories/Necklaces': {
        'Plastic', 'Stainless Steel', 'Copper', 'Metal', 'Resin', 'Brass',
        'Faux leather', 'Glass', 'Leather', 'Nylon', 'Pewter', 'Silicone',
        'Sterling silver', 'Wood',
    },
    'Costume Jewelry & Accessories/Rings': {
        'Metal coating', 'Wood', 'Leather', 'PU leather', 'Stainless', 'Fabric',
        'Plastic', 'Metal', 'Tungsten carbide', 'Stainless Steel', 'Tungsten',
        'White gold', 'Brass', 'Copper', 'Gold', 'Silicone', 'Silver',
        'Sterling silver', 'Titanium',
    },
    'Costume Jewelry & Accessories/Bracelets & Bangles': {
        'Fabric', 'Plastic', 'Metal coating', 'Wood', 'Leather', 'PU leather',
        'Stainless', 'Synthetic', 'Alloy', 'Cotton', 'Stone', 'Stainless Steel',
        'Metal', 'Nylon', 'Black obsidian', 'Acrylic', 'Brass', 'Copper',
        'Gemstone', 'Glass', 'Obsidian', 'Rubber', 'Shell', 'Silicone',
        'Yellow gold',
    },
    'Costume Jewelry & Accessories/Earrings': {
        'Fabric', 'Plastic', 'Metal coating', 'Wood', 'Leather', 'PU leather',
        'Stainless', 'Copper', 'Synthetic', 'Alloy', 'Stainless Steel', 'Metal',
        'Paper', 'Acrylic', 'Silicone', 'Brass', 'Ceramic', 'Crystal',
        'Cubic zirconia', 'Glass', 'Non-precious metal', 'Pearl', 'Resin',
        'Silver', 'Sterling silver', 'Titanium',
    },
}

# CACUSA material (normalizado) -> lista de opciones preferidas en orden
MATERIAL_PREFS = {
    'bano de oro 18k':                      ['Metal coating', 'Gold', 'Metal'],
    'acero inoxidable':                     ['Stainless Steel', 'Stainless', 'Metal'],
    'bano de rodio':                        ['Metal coating', 'Silver', 'Metal'],
    'plata 925':                            ['Sterling silver', 'Silver', 'Metal'],
    'plata 925 con un bano de oro de 18k':  ['Metal coating', 'Sterling silver', 'Metal'],
    'gold filled':                          ['Metal coating', 'Gold', 'Metal'],
}


def normalize(s):
    if not s:
        return ''
    s = s.replace('�', 'n')  # texto mojibake tipo "Ba?o de oro"
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
    return s.lower().strip()


def pick_material(cacusa_material, category_text):
    options = MATERIAL_OPTIONS.get(category_text, set())
    prefs = MATERIAL_PREFS.get(normalize(cacusa_material), [])
    for p in prefs:
        if p in options:
            return p
    return 'Metal' if 'Metal' in options else next(iter(options), 'Metal')


def pick_gender(category):
    if category == 'Hombres':
        return 'Male'
    if category == 'Parejas':
        return 'Unisex'
    return 'Female'


def content_hash(p):
    keys = ['name', 'name_en', 'description', 'description_en', 'price',
            'oldPrice', 'category', 'material', 'imageUrl', 'images']
    payload = json.dumps({k: p.get(k) for k in keys}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]


def load_products():
    with open(PRODUCTS_PATH, encoding='utf-8') as f:
        data = json.load(f)
    return data['products'] if isinstance(data, dict) and 'products' in data else data


def load_log():
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH, encoding='utf-8') as f:
            return json.load(f)
    return {}


# Columnas absolutas (1-indexado, igual que en el archivo de TikTok: col1=err_info)
COL = {
    'category': 2, 'brand': 3, 'product_name': 4, 'product_description': 5,
    'main_image': 6,  # image_2..image_9 = 7..14
    'parcel_weight': 30, 'parcel_length': 31, 'parcel_width': 32, 'parcel_height': 33,
    'price': 35, 'list_price': 36, 'warehouse_qty': 37, 'seller_sku': 39,
    'country_of_origin': 41, 'gender': 47, 'material': 48,
    'hazardous_materials': 51, 'choking_hazard': 53,
    'ca_prop65_repro': 55, 'ca_prop65_carcinogens': 57,
    'product_status': 72,
}


def build_row(p):
    category_text, use_choking = CATEGORY_GROUPS.get(p.get('category'), (None, False))
    if not category_text:
        return None, f"Categoria CACUSA desconocida: {p.get('category')!r}"

    images = [p.get('imageUrl')] + list(p.get('images') or [])
    images = [u for u in images if u][:9]
    if not images:
        return None, 'Sin fotos'

    material = pick_material(p.get('material'), category_text)
    description = (p.get('description_en') or p.get('description') or '').strip()
    material_es = (p.get('material') or '').strip()
    if material_es:
        description += f"\nMaterial: {material_es}"
    if use_choking:
        description += "\nWARNING: CHOKING HAZARD - Small parts. Not intended for children under 3 years."

    cells = {}  # columna absoluta -> valor
    cells[COL['category']] = category_text
    cells[COL['brand']] = BRAND
    cells[COL['product_name']] = (p.get('name_en') or p.get('name') or '')[:255]
    cells[COL['product_description']] = description
    cells[COL['main_image']] = images[0]
    for i, url in enumerate(images[1:9]):
        cells[COL['main_image'] + 1 + i] = url  # image_2..image_9
    cells[COL['parcel_weight']] = 0.19
    cells[COL['parcel_length']] = 7
    cells[COL['parcel_width']] = 3.5
    cells[COL['parcel_height']] = 4
    cells[COL['price']] = p.get('price')
    if p.get('oldPrice'):
        cells[COL['list_price']] = p.get('oldPrice')
    cells[COL['warehouse_qty']] = 1
    cells[COL['seller_sku']] = f"CACUSA-{p['id']}"
    cells[COL['country_of_origin']] = 'China'
    cells[COL['gender']] = pick_gender(p.get('category'))
    cells[COL['material']] = material
    cells[COL['hazardous_materials']] = 'No'
    if use_choking:
        cells[COL['choking_hazard']] = 'Choking hazard small parts'
    cells[COL['ca_prop65_repro']] = 'No'
    cells[COL['ca_prop65_carcinogens']] = 'No'
    cells[COL['product_status']] = 'Draft(2)'
    return cells, None


def main():
    products = load_products()
    log = load_log()

    to_export = []
    skipped = []
    for p in products:
        if not p.get('available', True):
            continue
        h = content_hash(p)
        prev = log.get(str(p['id']))
        if prev and prev.get('hash') == h:
            continue  # sin cambios desde la ultima exportacion
        cells, reason = build_row(p)
        if cells is None:
            skipped.append((p.get('name'), reason))
            continue
        to_export.append((p, h, cells))

    if skipped:
        print('Omitidos (revisar manualmente):')
        for name, reason in skipped:
            print(f'  - {name}: {reason}')

    if not to_export:
        print('Sin productos nuevos o modificados. No se genera archivo.')
        return 0

    wb = openpyxl.load_workbook(TEMPLATE_PATH, data_only=False)
    ws = wb['Template']
    start_row = 6
    for i, (p, h, cells) in enumerate(to_export):
        r = start_row + i
        for c, v in cells.items():
            ws.cell(row=r, column=c).value = v

    os.makedirs(EXPORTS_DIR, exist_ok=True)
    out_path = os.path.join(EXPORTS_DIR, 'tiktok_bulk_latest.xlsx')
    wb.save(out_path)

    now = datetime.now(timezone.utc).isoformat()
    for p, h, _ in to_export:
        log[str(p['id'])] = {'hash': h, 'exportedAt': now}
    log['_meta'] = {
        'lastGeneratedAt': now,
        'lastCount': len(to_export),
        'lastProducts': [f"CACUSA-{p['id']}: {p.get('name')}" for p, _, _ in to_export],
    }
    with open(LOG_PATH, 'w', encoding='utf-8') as f:
        json.dump(log, f, indent=2, ensure_ascii=False)

    print(f'Generado: {out_path}')
    print(f'{len(to_export)} producto(s) incluido(s):')
    for p, _, _ in to_export:
        print(f"  - CACUSA-{p['id']}: {p.get('name')}")

    # Salida para el workflow de GitHub Actions
    gh_output = os.environ.get('GITHUB_OUTPUT')
    if gh_output:
        with open(gh_output, 'a', encoding='utf-8') as f:
            f.write(f'generated=true\n')
            f.write(f'file={out_path}\n')
            f.write(f'count={len(to_export)}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
