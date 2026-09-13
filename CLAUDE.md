# CACUSA by Taitus — notas operativas del repo

Joyería y bisutería artesanal personalizada. Ecuador + USA. Sitio estático en
GitHub Pages, backend en Firebase Realtime Database + 4 Cloudflare Workers,
pagos con Square. Sin build step, sin framework — HTML/CSS/JS planos.

Este archivo se carga automático como instrucciones al inicio de cualquier
sesión de Claude en este repo — es la forma de que el contexto de trabajo
anterior persista entre sesiones (no hay memoria real entre conversaciones).
Mantenlo actualizado cuando cambie algo importante de la arquitectura.

## Arquitectura — dónde vive cada cosa

- **Sitio público**: GitHub Pages sirve `main` directo, sin build (hay
  `.nojekyll`) — todo archivo en `main` es públicamente accesible por su URL.
  Dominio: `cacusabytaitus.com` (`CNAME`).
- **Catálogo**: `data/products.json` — productos, config de textos/categorías/
  envío/materiales, todo en un solo archivo. Se edita en producción directo
  desde el panel admin (`ui_kits/admin/`), que comitea a `main` vía la API de
  GitHub (`GH_TOKEN`) — no pasa por Pull Request. Es normal ver commits
  automáticos `[Admin] Productos - robin.gonzalez` / `tita.jaramillo`.
- **Base de datos**: Firebase Realtime Database (`cacusa-pos-default-rtdb`) —
  suscriptoras de Cacusa Lovers (`cacusa_lovers`), reseñas (`cacusa_reviews`),
  fotos destacadas de Lovers.
- **4 Cloudflare Workers** (backend serio: sesiones, pagos, cupones, Firebase
  con permisos elevados, backups) — código fuente en la rama `workers-src`,
  **no en `main`** (ver sección dedicada más abajo).
- **Pagos**: Square (tarjeta/Apple Pay/Google Pay), más Zelle y transferencia
  coordinados por WhatsApp.
- **Tienda**: `ui_kits/store/index.html` (ES) y `en/ui_kits/store/index.html`
  (EN) — SPA de una sola página, todo el catálogo se renderiza con JS desde
  `data/products.json`.
- **Admin panel**: `ui_kits/admin/index.html` — React vía Babel Standalone en
  el navegador (sin build), login con sesión firmada HMAC.

## Cloudflare Workers — código fuente fuera de `main`

Por seguridad, el código fuente de los 4 Workers **no vive en `main`**, vive
en la rama **`workers-src`** (se movió ahí porque cualquier archivo en `main`
es público, y no había forma de servir el sitio sin exponerlos también a
ellos — pero ojo, `workers-src` también es públicamente legible vía GitHub
aunque Pages no la sirva como sitio, porque el repo entero es público; nunca
guardar ahí nada con datos reales de clientas, ver "Backups" más abajo):

- `admin-worker.js` → Worker `cacusa-admin` (sesiones, cupones, gift cards,
  productos vía GitHub API, pedidos, notificaciones push, referidos)
- `lovers-webhook-worker.js` → Worker `cacusa-lovers-webhook` (webhooks de
  Square para Cacusa Lovers, alta manual de suscriptoras, cancelaciones,
  borrado de reseñas — todo detrás de `X-Admin-Key`/sesión)
- `square-payment-worker.js` → Worker `cacusa-square` (genera Payment Links
  de Square, valida montos server-side)
- `backup-worker.js` → Worker `cacusa-backup` (respaldo diario de Firebase +
  KV a un bucket privado de Cloudflare R2 — ver sección "Backups y
  recuperación de desastres" más abajo)

### Cómo editarlos

Los 4 Workers se despliegan **manualmente**: no hay CI/CD que los suba a
Cloudflare (a diferencia de `data/products.json`, `sitemap.xml` y el JSON-LD
de producto, que sí se regeneran solos — ver sección de automatizaciones).

Para editar uno de los 4 Workers en una sesión nueva:

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

Secreto compartido entre los 4 Workers: `ORDER_INGEST_KEY` (header
`X-Order-Ingest-Key`) — así se autentican llamadas Worker-a-Worker sin
depender del Origin del navegador (ej. `cacusa-admin` llama a
`cacusa-lovers-webhook` para verificar si un teléfono es de una suscriptora
activa antes de emitir un código de referido; `cacusa-backup` lo usa para
avisarle a `cacusa-admin` que un backup falló). Comparaciones de secretos
siempre con `safeEqual()` (timing-safe), nunca `===` directo.

`cacusa-backup` además tiene su propio `BACKUP_TRIGGER_KEY`, sin compartir
con los otros 3 — autentica a un humano llamando `POST /run`/`GET /status`
a mano, no es Worker-a-Worker como `ORDER_INGEST_KEY`.

## Backups y recuperación de desastres

Ni Firebase (suscriptoras de Cacusa Lovers, reseñas) ni Cloudflare KV
(pedidos, gift cards, cupones) tienen historial de git como
`data/products.json` o el código de los Workers — un `delete` o un `put`
que pisa un valor ahí es irreversible. El Worker `cacusa-backup` es la
única red de seguridad para esos dos:

- **Qué respalda**: Firebase completo (un solo export) + KV de pedidos,
  gift cards, cupones, credenciales WebAuthn, y leads/surcharges/markets.
- **Dónde**: bucket privado de Cloudflare R2 (`cacusa-backups`) — **nunca**
  en el repo de GitHub, que es público (cualquier rama, incluida
  `workers-src`, es legible por cualquiera aunque Pages no la sirva como
  sitio).
- **Cuándo**: Cron Trigger diario (`0 9 * * *` UTC = 04:00 Ecuador),
  configurado a mano en Cloudflare → `cacusa-backup` → Triggers.
- **Retención**: 90 días, vía Object Lifecycle Rule del propio bucket R2
  (dashboard de Cloudflare, sin tocar código).
- **Alertas**: si una corrida falla, avisa por push a Tita/Robin (mismo
  mecanismo que las notificaciones de pedidos/suscriptoras nuevas) —
  silencio total en las corridas exitosas, para no generar ruido.
- **Restauración**: deliberadamente manual, nunca automática — el runbook
  completo (qué llamados hacer a Firebase y a KV para restaurar desde un
  backup puntual) vive comentado al inicio de `backup-worker.js`.

## Automatizaciones (GitHub Actions)

`.github/workflows/product-schema.yml` corre en cada push a `main` que
toque `data/products.json` (o manual con `workflow_dispatch`) y regenera
tres cosas, comiteando de vuelta a `main` si hay cambios:

1. **JSON-LD estático de producto** (`.github/scripts/generate_product_schema.py`)
   — bloque `schema.org Product` por cada producto disponible, inyectado
   directo en el `<head>` de `ui_kits/store/index.html` y
   `en/ui_kits/store/index.html` entre marcadores
   `STATIC_PRODUCT_SCHEMA:START/END`. Antes solo existía vía JavaScript
   (`_injectProductSchema`, solo al abrir un producto) — un bot que no
   ejecuta JS nunca lo veía.
2. **URLs de producto en el sitemap** (`.github/scripts/generate_sitemap_products.py`)
   — una URL por producto (ES+EN, hreflang recíproco) entre marcadores
   `STATIC_PRODUCT_URLS:START/END` en `sitemap.xml`.
3. **Catálogo de respaldo `<noscript>`** (`.github/scripts/generate_noscript_catalog.py`)
   — el único contenido de producto que ve un bot/IA que no ejecuta JS,
   agrupado por categoría, entre marcadores
   `<!--NOSCRIPT_PRODUCTS_START/END-->` en ambos `index.html`. Antes se
   escribía a mano una sola vez y quedaba desactualizado (llegó a tener
   68 de 74 productos con el título en español mezclado con el nombre en
   inglés — "Nombre / Name" — por cómo se generó la primera vez); ahora
   se regenera solo del catálogo real en cada cambio.

Los 3 scripts reusan la misma lógica de slug (`slugify`/`product_param` en
Python, replicando `_slugify`/`_productParam` del JS del cliente) — deben
coincidir siempre. No entra en loop: solo escucha cambios en
`data/products.json`, y su propio commit nunca toca ese archivo (solo los
2 `index.html` y `sitemap.xml`).

Los slugs de URL de producto se generan con la misma lógica que el
JavaScript del cliente (`_slugify`/`_productParam` en `ui_kits/store/index.html`)
replicada en Python (`slugify`/`product_param` en
`generate_product_schema.py`) — deben coincidir siempre.

## Patrón de idiomas (ES/EN)

Dos patrones distintos conviven en el sitio:

- **Páginas con archivo `/en/` separado y congelado**: `index.html`,
  `ui_kits/store/index.html`, `cacusa-lovers.html` → tienen copia física en
  `en/` con `__LANG` fijo a `'en'` (o clases `.t-es`/`.t-en` con toggle por
  `localStorage.cacusa-lang`, según el archivo). Cualquier cambio de
  contenido/estructura hay que espejarlo a mano en los dos archivos.
- **Páginas de una sola URL con selector de idioma en el cliente**:
  `cuidados.html`, `envios.html`, `devoluciones.html`, `guia-tallas.html`,
  `guia-regalos.html`, `guias.html`, `significado-piedras.html`,
  `como-combinar-joyas.html` → un solo archivo, `data-i18n` + objeto
  `I18N_EN`/`T` en JS, cambia con `window.cacusaLang('es'|'en')` que guarda
  en `localStorage` y recarga. Más simple de mantener — usar este patrón
  para contenido nuevo tipo guía/página informativa.

## Convenciones de marca ya establecidas

- **Cero emojis de color.** Solo símbolos monocromáticos que heredan el
  color de marca vía CSS: `♡ ✦ ◇ ✧ ✓ ✕` como texto, o el patrón `.dot`
  (círculo rosa de 8px) que ya usan los encabezados `.sec h2` en todas las
  guías. Nunca cajas de íconos con emoji 📏🎁💎 etc.
- **Personalización**: 5–10 días hábiles (dato real, no 5–7 — ya unificado
  en todo el sitio). El precio de personalizar NO está incluido de
  antemano — el cliente escribe por WhatsApp qué quiere y cómo, y ahí se le
  da el precio final.
- **Envío gratis**: desde $90.
- **Devoluciones**: solo por defecto de fábrica, ventana de 48h desde la
  entrega — nunca devolución estándar por cambio de opinión, ni siquiera en
  piezas sin personalizar (decisión de negocio confirmada explícitamente).
- **Cacusa Lovers**: club de suscripción mensual, 2 piezas de acero
  inoxidable al mes. Plan mensual y anual (8% de descuento). El beneficio
  extra del plan anual es acceso VIP 48h antes que el mensual.
- **WhatsApp es el canal de coordinación principal** para personalización,
  dudas de talla/color, Zelle/transferencia, y soporte post-venta.

## Programa de referidos (Cacusa Lovers)

`POST /referral/code` en `admin-worker.js`, reusa el sistema de cupones
existente (`couponKey`/`couponGet`/`couponIsValid`). Reglas fijas, no
elegibles por quien llama:

- **Exclusivo para suscriptoras activas** de Cacusa Lovers — se verifica el
  teléfono contra Firebase vía `cacusa-lovers-webhook`
  (`GET /internal/lovers/active`) antes de emitir nada. Falla cerrado.
- Código determinístico por teléfono (`AMIGA` + últimos 6 dígitos) — pedirlo
  dos veces no crea 2 cupones.
- **10% de descuento** para la amiga referida (no 15% — se bajó a propósito).
- **Máximo 1 uso exitoso por mes** por código, sin importar quién lo use
  (`refmonth:<código>:<año-mes>` en KV).
- El crédito para quien refiere **no se acredita automático** todavía — el
  admin ve en la pestaña Cupones quién refirió a quién (queda en `note`) y
  Tita/Robin le mandan la recompensa manual. Alcance intencional, no bug.

## SEO — estado y patrones

- **Categorías con URL propia**: cada categoría de la tienda tiene
  `?cat=NombreCategoria` con título/meta description/canonical/ItemList
  JSON-LD únicos (no solo un filtro visual) — función `_updateListingSeo()`
  / `_updateCategorySeo()` en `ui_kits/store/index.html`. 9 categorías:
  Cadenas, Aretes, Anillos, Hombres, Pulseras, Ear cuff, Parejas, Juegos,
  Hand chain.
- **Primera pantalla de la tienda**: selector visual de categorías (carrusel
  de hasta 3 fotos por tarjeta, mismo crossfade que el slideshow del hero
  del home) en vez de mostrar los ~76 productos de golpe. Se apaga
  (`_categoryPickerDismissed`) en cuanto la clienta elige categoría, busca
  algo, o pide "ver todo el catálogo".
- **Guías / contenido tipo blog**: `guias.html` es el hub — enlaza a
  `guia-tallas.html`, `guia-regalos.html`, `cuidados.html`,
  `significado-piedras.html`, `como-combinar-joyas.html`. Cualquier guía
  nueva: agregarla al hub, agregar link de vuelta al hub desde la guía
  nueva, agregar al `sitemap.xml`, agregar a `llms.txt`, y agregar
  "Guías"/"Guides" ya existe en footers y en los 6 menús móviles (drawer)
  del sitio — no hace falta tocarlo de nuevo salvo que se agregue una
  página con su propio drawer.
- **`robots.txt`**: cubre bots de búsqueda (Google, Bing) y de IA
  (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, anthropic-ai,
  Google-Extended, Applebot/-Extended, Meta-ExternalAgent, CCBot,
  Bytespider). Bloquea `/ui_kits/admin/`, `/data/orders.json`, `/preview/`
  (sistema de diseño interno) y `/.github/`. Revisar que cualquier página
  nueva quede cubierta por el `Allow: /` general (no debería necesitar
  entrada explícita salvo que se quiera bloquear).
- **`llms.txt`**: resumen del negocio para LLMs/IA — actualizar si cambian
  datos de negocio (precios, envío, materiales, políticas) o se agrega
  contenido nuevo importante (guías, categorías).
- Auditorías publicadas como Artifacts (privados, en la cuenta del usuario —
  no viven en este repo, son objetos aparte). Al resolver un hallazgo nuevo
  de cualquiera, leer el Artifact con la URL de abajo, editar el hallazgo
  correspondiente marcándolo resuelto, y volver a publicar con `url:` (esa
  misma URL) para que actualice en el mismo lugar en vez de crear uno nuevo:
  - **SEO/UX/Comercial** (68/76 resueltos, no tocada en sesiones recientes):
    `https://claude.ai/code/artifact/45c105ed-9fad-4615-9856-1d1a3fce21f3`
  - **Seguridad** (9/10 resuelto, 1 nota informativa sin acción):
    `https://claude.ai/code/artifact/6872c756-df31-4134-bf6b-b16219a461ca`
  - **Benchmark Mundial** vs. Mejuri/Kendra Scott/Pandora/etc. (10/26
    resuelto):
    `https://claude.ai/code/artifact/8448c651-61d8-4be3-a439-fd46721dffea`

## Accesibilidad — patrones ya establecidos (WCAG 2.1 AA)

Sitio público y panel admin auditados y corregidos contra WCAG 2.1 AA
(ver `CHANGELOG.md` 2026-09-13). Patrones a reusar en trabajo nuevo en
vez de reinventarlos:

- **Modales/overlays**: la tienda tiene `trapFocus(modalEl, onClose)` en
  `ui_kits/store/index.html` — atrapa Tab dentro del overlay, cierra con
  Escape, devuelve el foco al elemento que lo abrió. Todo overlay nuevo
  (`role="dialog" aria-modal="true"`) debe engancharse a esa función, como
  ya hacen el modal de producto, carrito, checkout, wishlist, vignette,
  lightbox y el drawer de menú móvil.
- **Admin (React)**: componente `Modal` compartido (mismo algoritmo que
  `trapFocus()`, adaptado con `useEffect`/`useRef`) — props `onClose`,
  `label`/`labelledBy`, `overlayStyle`/`boxStyle` opcionales para
  personalizar tamaño, `closeOnOverlayClick`. Todo modal nuevo del panel
  debe envolver su contenido en `<Modal>` en vez de armar su propio
  `position:fixed` a mano — ver `NtfyModal`, `ProductModal`,
  `NewOrderModal` como ejemplo.
- **Mensajes de estado** (éxito/error de una acción — subir foto, crear
  cupón, guardar cambios, etc.): siempre `role="status" aria-live="polite"`
  (o `role="alert" aria-live="assertive"` si el mensaje bloquea continuar,
  como los errores de validación de un formulario) en el `<div>`/`<span>`
  condicional que ya se usa en todo el sitio — no hace falta ningún
  componente nuevo, solo agregar esos 2 atributos al contenedor del
  mensaje.
- **Formularios sin `<label>` visible** (diseño que usa solo
  `placeholder`, como `NewOrderModal` del admin): agregar un `<label>`
  con `htmlFor`/`id` visualmente oculto (`position:absolute;width:1px;
  height:1px;overflow:hidden;clip:rect(0,0,0,0)` — ver `srOnly` en
  `NewOrderModal`) en vez de cambiar el diseño visual.
- **Tarjetas/elementos clicables sin control nativo** (`<div onClick>`):
  preferir convertir a `<a href>` real si ya existe una URL de destino
  (más simple, gratis en teclado/SEO/semántica — ver `.col-card` del
  home). Si no hay URL real, agregar `role="button" tabIndex={0}` +
  `onKeyDown`/`onkeydown` que dispare la misma acción en Enter/Espacio —
  ver `activateOnKey()` en la tienda (JS plano) o el patrón de
  `CategoryProductPicker` en el admin (React).
- **Carruseles automáticos**: deben respetar
  `prefers-reduced-motion` (mostrar 1 solo frame estático si el usuario
  lo pidió) y pausarse en `mouseenter`/`focusin` — ver `heroSlideshow()`
  del home y la rotación de `.cat-tile` en la tienda.

## Seguridad — ya auditado y cerrado

- CSP vía `<meta http-equiv>` en cada página (GitHub Pages no permite
  headers HTTP reales, y el dominio no está en Cloudflare — confirmado, no
  hay proxy). `img-src` debe incluir `blob:` en el admin (lo usa
  `compressImage()` para leer fotos antes de subirlas — si falta, sale un
  error engañoso de "HEIC" con cualquier formato).
- `isInternalIngest()` con `safeEqual()` en los 3 Workers para llamadas
  servidor-a-servidor.
- Gift cards: redención atómica dentro de `handleOrder()`, tope al total del
  pedido — nunca un endpoint público suelto.
- Reglas de Firebase RTDB: ya verificadas contra el payload real de cada
  formulario público (reseñas, alta de Lovers) — solo permiten crear, no
  leer/editar/borrar sin `FB_DB_SECRET`.

## Historial de cambios

`CHANGELOG.md` en la raíz del repo tiene el historial completo de
versionamiento del sitio, agrupado por fecha en lenguaje simple (no un log
técnico crudo). Al terminar un batch de trabajo importante en una sesión
nueva, agregar una entrada ahí — no solo confiar en los mensajes de commit.

## Flujo de git

- Todo commit a `main` publica de inmediato vía GitHub Pages — no hay
  ambiente de staging.
- **Antes de cualquier `git push` a `main`, siempre `git fetch origin main`
  y revisar divergencia** — el admin puede haber comiteado
  productos/imágenes mientras tanto (pasa seguido). Si hay commits nuevos
  y no tocan los mismos archivos, `git merge origin/main --ff-only` antes
  de pushear.
- Nunca commitear a `main` los 3 archivos de Workers (ver arriba) — van a
  `workers-src`.
- Verificación antes de pushear HTML/JS: extraer los `<script>` no-JSON y
  correr `node --check`; para el admin panel (JSX vía Babel Standalone) usar
  un proyecto scratch con `@babel/core` + `@babel/preset-react`; revisar
  balance de etiquetas HTML (hay un falso positivo conocido y ya verificado
  en `index.html`/`en/index.html`: 231 `<div>` abiertos vs 230 cerrados,
  preexistente, no es un bug introducido).
