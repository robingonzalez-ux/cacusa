# CACUSA — notas operativas del repo

## Cloudflare Workers — código fuente fuera de `main`

El sitio (`cacusabytaitus.com`) se publica con GitHub Pages directo desde la
rama `main`, sin build ni exclusiones (hay un `.nojekyll`) — cualquier
archivo que viva en `main` es públicamente accesible por su URL.

Por eso el código fuente de los 3 Workers de Cloudflare **no vive en
`main`**, vive en la rama **`workers-src`**:

- `admin-worker.js` → Worker `cacusa-admin`
- `lovers-webhook-worker.js` → Worker `cacusa-lovers-webhook`
- `square-payment-worker.js` → Worker `cacusa-square`

### Cómo editarlos

Los 3 Workers se despliegan **manualmente**: no hay CI/CD que los suba a
Cloudflare (a diferencia de `data/products.json`, `sitemap.xml` y el JSON-LD
de producto, que sí se regeneran solos vía `.github/workflows/product-schema.yml`
cuando cambia el catálogo).

Para editar uno de los 3 Workers en una sesión nueva:

```bash
git fetch origin workers-src
git show origin/workers-src:admin-worker.js > admin-worker.js   # o el que corresponda
```

Edítalo, verifica con `node --check archivo.js`, y comitea/pushea **a
`workers-src`, nunca a `main`**:

```bash
git add admin-worker.js
git commit -m "..."
git push origin HEAD:workers-src
```

Después, entrega el archivo actualizado al usuario (con `SendUserFile` si es
una sesión de Claude) para que lo pegue manualmente en el dashboard de
Cloudflare y le dé Deploy — el push a `workers-src` por sí solo **no
despliega nada**, solo lo deja versionado y fuera de la rama pública.

## Otras notas ya establecidas

- Todo commit a `main` publica de inmediato vía GitHub Pages — no hay
  ambiente de staging.
- `data/products.json` se edita en producción directo desde el panel admin
  (`ui_kits/admin/`), que comitea a `main` vía la API de GitHub
  (`GH_TOKEN`) — no pasa por Pull Request.
- Antes de cualquier `git push` a `main`, siempre `git fetch origin main` y
  revisar divergencia — el admin puede haber comiteado productos/imágenes
  mientras tanto.
