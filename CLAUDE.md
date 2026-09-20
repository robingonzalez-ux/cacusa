# CACUSA by Taitus — notas operativas del repo (resumen público)

Joyería y bisutería artesanal personalizada. Ecuador + USA. Sitio estático en
GitHub Pages, backend en Firebase Realtime Database + 4 Cloudflare Workers,
pagos con Square. Sin build step, sin framework — HTML/CSS/JS planos.

Este archivo se carga automático como instrucciones al inicio de cualquier
sesión de Claude en este repo. **Este repo (`cacusa`) es público** (necesario
para que GitHub Pages sea gratis) — por eso este `CLAUDE.md` es deliberadamente
un resumen: solo arquitectura general y reglas de flujo de trabajo, nada de
detalle de seguridad/auditorías/secretos.

## El detalle completo vive en un repo privado aparte

Todo lo operativo sensible — historial completo de auditorías de seguridad,
hallazgos corregidos, snapshot de las reglas de Firebase RTDB, patrones de
HMAC/rate-limit, nombres de secretos y para qué sirve cada uno, el runbook
del incidente de `wrangler`, etc. — vive en **`robingonzalez-ux/roggi-notas`**
(repo privado, mismo dueño). **Antes de tocar nada relacionado con
seguridad, Workers, cupones, gift cards, Firebase, o cualquier tema que
suene "ya lo habíamos visto antes": pedirle al usuario que adjunte ese repo
a la sesión (`add_repo`) y leer su `CLAUDE.md`/`CHANGELOG.md` completos
antes de continuar.** Ese repo privado es el que hay que mantener
actualizado con el detalle real de cada cambio — este archivo público solo
necesita tocarse si cambia algo de la arquitectura general descrita abajo.

## Arquitectura — dónde vive cada cosa

- **Sitio público**: GitHub Pages sirve `main` directo, sin build (hay
  `.nojekyll`) — todo archivo en `main` es públicamente accesible por su URL.
  Dominio: `cacusabytaitus.com` (`CNAME`).
- **Catálogo**: `data/products.json` — productos, config de textos/categorías/
  envío/materiales, todo en un solo archivo. Se edita en producción directo
  desde el panel admin (`ui_kits/admin/`), que comitea a `main` vía la API de
  GitHub — no pasa por Pull Request. Es normal ver commits automáticos
  `[Admin] Productos - robin.gonzalez` / `tita.jaramillo`.
- **Base de datos**: Firebase Realtime Database — suscriptoras de Cacusa
  Lovers, reseñas, fotos destacadas de Lovers.
- **4 Cloudflare Workers** (backend: sesiones, pagos, cupones, Firebase con
  permisos elevados, backups) — código fuente en la rama `workers-src`,
  **no en `main`** (ver sección dedicada más abajo).
- **Pagos**: Square (tarjeta/Apple Pay/Google Pay), más Zelle y transferencia
  coordinados por WhatsApp.
- **Tienda**: `ui_kits/store/index.html` (ES) y `en/ui_kits/store/index.html`
  (EN) — SPA de una sola página, todo el catálogo se renderiza con JS desde
  `data/products.json`. Hay además ~200 páginas físicas por producto/categoría
  (`ui_kits/store/producto/`, `ui_kits/store/categoria/`, y sus equivalentes
  `en/`) generadas automáticamente para SEO — ver "Automatizaciones" abajo.
- **Admin panel**: `ui_kits/admin/index.html` — React vía Babel Standalone en
  el navegador (sin build), login con sesión firmada.

## Cloudflare Workers — código fuente fuera de `main`

El código fuente de los 4 Workers vive en la rama **`workers-src`**, nunca
en `main` (aunque `workers-src` también es un repo público — igual de
importante no meter ahí datos reales de clientas ni nada más sensible de lo
que ya hay):

- `admin-worker.js` → Worker `cacusa-admin`
- `lovers-webhook-worker.js` → Worker `cacusa-lovers-webhook`
- `square-payment-worker.js` → Worker `cacusa-square`
- `backup-worker.js` → Worker `cacusa-backup`

### Cómo editarlos

Se despliegan **manualmente** — no hay CI/CD que los suba a Cloudflare (a
diferencia de `data/products.json`/`sitemap.xml`/JSON-LD de producto, que sí
se regeneran solos).

```bash
git fetch origin workers-src
git show origin/workers-src:admin-worker.js > admin-worker.js   # o el que corresponda
```

Editar, verificar con `node --check archivo.js`, y comitear/pushear **a
`workers-src`, nunca a `main`**:

```bash
git add admin-worker.js
git commit -m "..."
git push origin HEAD:workers-src
```

Después, entregar el archivo actualizado al usuario (`SendUserFile`) para
que lo pegue manualmente en el dashboard de Cloudflare y le dé Deploy — el
push a `workers-src` por sí solo **no despliega nada**.

Uno de los 4 Workers (`cacusa-admin`) tiene un Durable Object
(`GiftCardLedger`) — declarar una clase nueva de este tipo necesita una
migración vía `wrangler deploy`, distinto del flujo normal de pegar código
en el dashboard. Detalle completo del procedimiento y de un incidente real
con bindings borrados: ver el repo privado.

## Backups y recuperación de desastres

Ni Firebase ni Cloudflare KV tienen historial de git como `data/products.json`
o el código de los Workers — un `delete`/`put` que pisa un valor ahí es
irreversible. El Worker `cacusa-backup` respalda ambos diariamente a un
bucket privado de Cloudflare R2. Restauración deliberadamente manual, nunca
automática. Detalle completo (qué respalda exactamente, verificación de
privacidad del bucket, runbook de restauración): ver el repo privado.

## Reglas de Firebase RTDB

No hay forma de leer las reglas en vivo desde el repo (viven solo en
Firebase Console). El snapshot completo y confirmado vive en el repo
privado — pedirlo ahí en vez de pedírselo de nuevo al usuario.

## Guías de envío USPS (nuevo, 20 sep)

Botón manual "📦 Generar guía USPS" en cada pedido del panel admin (solo
visible para pedidos con destino EE.UU. — Ecuador sigue 100% manual con
Servientrega). Genera la guía real contra la API nueva de USPS
(`developers.usps.com` — la vieja Web Tools API se dio de baja el 25 ene
2026), usa un peso/tamaño de paquete fijo por defecto
(`config.shipping.uspsDefaultPackage` — pestaña Envíos del panel, sección
"📦 Paquete por defecto para guías USPS") salvo que se indique otro
peso/dimensiones puntuales al generar (modal "Generar guía USPS": las 3
medidas van juntas o no van, para no mezclar 1-2 puntuales con el resto
del default). Nunca se dispara solo — siempre lo aprieta Tita/Robin
después de revisar la dirección, para no gastar franqueo real por un
error.

Cacusa Lovers también entra: cada cobro real de una renovación
(`invoice.payment_made` en `lovers-webhook-worker.js`) crea un pedido
normal en el sistema (`order:<id>`, mismo esquema de siempre) con la
dirección de la suscriptora ya cargada — con `productos` vacío a
propósito, porque elegir qué 2 piezas van ese mes/año sigue siendo
curaduría humana. Una vez que Tita/Robin cargan las piezas, se genera la
guía con el mismo botón, sin código aparte.

Requiere que la cuenta de USPS tenga aprobación para la Labels API y una
Enterprise Payment Account (EPS) activa — trámites reales con USPS, no
algo que se resuelva desde el código. Detalle completo (secrets exactos,
estado de la cuenta, shape del payload de la API): ver el repo privado.

Bug real cerrado (20 sep): un pedido de Cacusa Lovers podía guardar el
país truncado a 10 caracteres (`"ESTADOS UN"` en vez de `"ESTADOS
UNIDOS"`), rompiendo el match que decide si mostrar el botón de USPS —
corregido subiendo el límite. `OrderCard` (panel admin) ahora también
tiene un "✎ Editar dirección" para corregir a mano cualquier pedido ya
guardado con un dato de dirección/país incorrecto, sin tocar KV.

## Automatizaciones (GitHub Actions)

`.github/workflows/product-schema.yml` corre en cada push a `main` que
toque `data/products.json` (o vía `repository_dispatch` cuando cambia el
recargo con tarjeta desde el panel) y regenera automáticamente:

1. JSON-LD estático de producto (`generate_product_schema.py`)
2. URLs de producto/categoría en `sitemap.xml` (`generate_sitemap_products.py`)
3. Catálogo de respaldo `<noscript>` (`generate_noscript_catalog.py`)
4. Datos numéricos de `llms.txt` (`generate_llms_facts.py`)
5. Páginas físicas por producto/categoría, ES+EN (`generate_product_pages.py`,
   corre último — depende de 1 y 2 ya regenerados en la misma corrida, y
   borra solo las carpetas de productos eliminados del catálogo)

Los 5 scripts reusan la misma lógica de slug (`slugify`/`product_param` en
Python, replicando `_slugify`/`_productParam` del JS del cliente) — deben
coincidir siempre. No entra en loop: solo escucha cambios en
`data/products.json`, y su propio commit nunca toca ese archivo.

**Regla de escape obligatoria**: cualquier generador que inyecte datos
dentro de un `<script>` en HTML público (JSON-LD, catálogo `<noscript>`)
tiene que usar `json_for_script_tag()` (en `generate_product_schema.py`) o
equivalente — `json.dumps()` solo no alcanza, no escapa `<`/`>`/`/`, y un
dato que venga de afuera (ej. nombre/comentario de una reseña pública sin
moderar) podría cerrar el `<script>` e inyectar código ejecutable. Los
bloques JSON-LD que arma el sitio en runtime usan `el.textContent` (no
`innerHTML`) por la misma razón — nunca cambiar eso.

## Patrón de idiomas (ES/EN)

Dos patrones conviven en el sitio:

- **Páginas con archivo `/en/` separado y congelado**: `index.html`,
  `ui_kits/store/index.html`, `cacusa-lovers.html` → copia física en `en/`
  con `__LANG` fijo a `'en'`. Cualquier cambio de contenido/estructura hay
  que espejarlo a mano en los dos archivos.
- **Páginas de una sola URL con selector de idioma en el cliente**:
  `cuidados.html`, `envios.html`, `devoluciones.html`, `guia-tallas.html`,
  `guia-regalos.html`, `guias.html`, `significado-piedras.html`,
  `como-combinar-joyas.html`, `regalos-hombre-y-joyeria-religiosa.html` → un
  solo archivo, `data-i18n` + objeto `I18N_EN`/`T` en JS, cambia con
  `window.cacusaLang('es'|'en')`. Más simple de mantener — usar este
  patrón para contenido nuevo tipo guía/página informativa.

## Convenciones de marca ya establecidas

- **Cero emojis de color.** Solo símbolos monocromáticos que heredan el
  color de marca vía CSS: `♡ ✦ ◇ ✧ ✓ ✕` como texto, o el patrón `.dot`
  (círculo rosa de 8px) que ya usan los encabezados `.sec h2` en todas las
  guías. Nunca cajas de íconos con emoji. Aplica también al copy de
  producto (`name`/`description` en `data/products.json`) — un producto
  nuevo agregado desde el admin con emoji de color debe limpiarse con este
  criterio la próxima vez que se audite el catálogo (no hay validación
  automática que lo bloquee hoy).
- **Personalización**: 5–10 días hábiles. El precio de personalizar NO está
  incluido de antemano — el cliente escribe por WhatsApp qué quiere y cómo,
  y ahí se le da el precio final.
- **Envío gratis**: desde $90.
- **Devoluciones**: solo por defecto de fábrica, ventana de 48h desde la
  entrega — nunca devolución estándar por cambio de opinión.
- **Cacusa Lovers**: club de suscripción mensual, 2 piezas de acero
  inoxidable al mes. Plan mensual y anual (8% de descuento). El beneficio
  extra del plan anual es acceso VIP 48h antes que el mensual.
- **WhatsApp es el canal de coordinación principal** para personalización,
  dudas de talla/color, Zelle/transferencia, y soporte post-venta.

## SEO — patrones establecidos

- Cada producto y categoría tiene una página física propia (ver
  "Automatizaciones" arriba) con canonical/hreflang/H1/JSON-LD correctos
  desde el primer byte — `?p=`/`?cat=` siguen abriendo el modal/filtrando
  vía JS como siempre, pero ya no son la URL canónica de nada.
- `product_page_url()`/`product_param()`/`category_page_url()` en
  `generate_product_schema.py` son la fuente única de verdad de las URLs —
  las reusan los demás scripts, así que sitemap/noscript/JSON-LD/páginas
  físicas nunca quedan en desacuerdo entre sí.
- CSS compartido de la tienda extraído a `ui_kits/store/styles.css`
  (referenciado con ruta absoluta `/ui_kits/store/styles.css`, funciona
  igual sin importar la profundidad de carpeta del archivo que lo usa) en
  vez de repetido en cada uno de los ~200 archivos HTML del sitio.
- `robots.txt` cubre bots de búsqueda e IA, bloquea `/ui_kits/admin/`,
  `/data/orders.json`, `/preview/`, `/.github/`. Una página nueva no
  necesita entrada explícita salvo que se quiera bloquear.
- `llms.txt`: resumen del negocio para LLMs/IA — actualizar si cambian
  datos de negocio (precios, envío, materiales, políticas) o se agrega
  contenido nuevo importante.

## Accesibilidad — patrones ya establecidos (WCAG 2.1 AA)

- **Modales/overlays**: `trapFocus(modalEl, onClose)` en
  `ui_kits/store/index.html` — atrapa Tab, cierra con Escape, devuelve el
  foco al elemento que lo abrió. Todo overlay nuevo debe engancharse a esa
  función.
- **Admin (React)**: componente `Modal` compartido, mismo algoritmo.
- **Mensajes de estado**: `role="status" aria-live="polite"` (o
  `role="alert" aria-live="assertive"` si bloquea continuar).
- **Formularios sin `<label>` visible**: agregar un `<label>` visualmente
  oculto (`srOnly`) en vez de cambiar el diseño.
- **Tarjetas/elementos clicables sin control nativo**: preferir `<a href>`
  real si hay URL de destino; si no, `role="button" tabIndex={0}` +
  `onKeyDown` que dispare la acción en Enter/Espacio.
- **Carruseles automáticos**: respetar `prefers-reduced-motion` y
  pausarse en `mouseenter`/`focusin`.

## Flujo de git

- Todo commit a `main` publica de inmediato vía GitHub Pages — no hay
  ambiente de staging.
- **Antes de cualquier `git push` a `main`, siempre `git fetch origin main`
  y revisar divergencia** — el admin puede haber comiteado
  productos/imágenes mientras tanto (pasa seguido). Si hay commits nuevos
  y no tocan los mismos archivos, rebase/merge antes de pushear.
- Nunca commitear a `main` los 4 archivos de Workers — van a `workers-src`.
- Verificación antes de pushear HTML/JS: extraer los `<script>` no-JSON y
  correr `node --check`; para el admin panel (JSX vía Babel Standalone)
  usar un proyecto scratch con `@babel/core` + `@babel/preset-react`.
- `CHANGELOG.md` en este repo es un resumen mínimo — la versión completa
  con el detalle técnico de cada arreglo vive en el repo privado.
