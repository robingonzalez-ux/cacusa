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
- **Privacidad del bucket — verificada el 16 sep.** Un bucket de R2 nace
  privado y solo se vuelve público por 3 vías; las 3 quedaron comprobadas:
  (a) **Public Development URL** (`*.r2.dev`) deshabilitada y (b) **sin
  dominio propio** asignado — las dos en el dashboard, bucket → Settings →
  Public access, que es el único lugar donde se ven; y (c) **ningún Worker
  sirve objetos del bucket**: `backup-worker.js` expone solo `POST /run` y
  `GET /status`, ambas detrás de `isAuthorized()` (`safeEqual()` contra
  `BACKUP_TRIGGER_KEY`), `/status` devuelve únicamente `_status.json` y
  todo lo demás cae en 404. En el repo tampoco hay ninguna referencia a
  `r2.dev`. Si alguna vez se agrega una ruta nueva al Worker que lea de
  `BACKUP_R2`, hay que revisar (c) de nuevo — es la única de las tres que
  se puede romper desde el código.

## Reglas de Firebase RTDB (snapshot confirmado — 19 sep)

No hay forma de leer las reglas en vivo desde el repo (viven solo en
Firebase Console, no en ningún archivo versionado) — este es un snapshot
pegado por el usuario y confirmado exacto el 19 sep. Guardarlo acá para no
tener que pedirlo de nuevo cada vez que haga falta dar un fragmento
preciso (ya pasó 3 veces esta sesión: reglas de reseñas, de Lovers, y la
regla nueva de `estado_pago`). Si se vuelve a tocar algo del árbol de
reglas, actualizar este bloque con el nuevo snapshot.

```json
{
  "rules": {
    "cacusa_ventas": {
      ".read":  "auth != null && (auth.token.email === 'robin_gonzalez@live.com' || auth.token.email === 'titajaramillolopez@gmail.com')",
      ".write": "auth != null && (auth.token.email === 'robin_gonzalez@live.com' || auth.token.email === 'titajaramillolopez@gmail.com')"
    },
    "cacusa_costos": {
      ".read":  "auth != null && (auth.token.email === 'robin_gonzalez@live.com' || auth.token.email === 'titajaramillolopez@gmail.com')",
      ".write": "auth != null && (auth.token.email === 'robin_gonzalez@live.com' || auth.token.email === 'titajaramillolopez@gmail.com')"
    },
    "cacusa_productos": {
      ".read":  "auth != null && (auth.token.email === 'robin_gonzalez@live.com' || auth.token.email === 'titajaramillolopez@gmail.com')",
      ".write": "auth != null && (auth.token.email === 'robin_gonzalez@live.com' || auth.token.email === 'titajaramillolopez@gmail.com')"
    },
    "cacusa_reviews": {
      ".read": true,
      "$productId": {
        "$reviewId": {
          ".write": "!data.exists()",
          ".validate": "newData.hasChildren(['name', 'rating', 'comment', 'date', 'approved'])",
          "name":     { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 60" },
          "rating":   { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 5" },
          "comment":  { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 600" },
          "date":     { ".validate": "newData.isString() && newData.val().length <= 10" },
          "approved": { ".validate": "newData.isBoolean() && newData.val() === false" },
          "$other":   { ".validate": false }
        }
      }
    },
    "cacusa_lovers": {
      ".read": false,
      ".write": false,
      "$subId": {
        ".read": false,
        ".write": "!data.exists() && newData.hasChildren(['email', 'estado_pago'])",
        "email":       { ".validate": "newData.isString() && newData.val().length <= 150 && newData.val().matches(/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/)" },
        "estado_pago": { ".validate": "newData.val() === 'pendiente'" },
        "nombre": {}, "apellido": {}, "telefono": {}, "direccion": {}, "apto": {},
        "ciudad": {}, "estado": {}, "zip": {}, "pais": {}, "plan": {}, "monto": {},
        "fecha": {}, "metodo_pago": {}, "idioma": {},
        "$other": { ".validate": false }
      }
    },
    "cacusa_lovers_photos": {
      ".read": true,
      ".write": false
    }
  }
}
```

Este snapshot ya incluye el arreglo de A02 (regla `estado_pago` en
`cacusa_lovers/$subId`) — el usuario confirmó haberlo publicado el 19 sep
(ver "Auditoría externa" más abajo). Si se vuelve a tocar algo del árbol
de reglas, actualizar este bloque.

`cacusa_ventas`, `cacusa_costos` y `cacusa_productos` son de otra app
(punto de venta / gestión de costos), no del sitio público — se incluyen
acá solo para tener el árbol completo y no perder contexto si algún día
hace falta tocar algo cerca de esos nodos, pero no son relevantes para
nada de lo que hace este repo (sitio + Workers).

## Automatizaciones (GitHub Actions)

`.github/workflows/product-schema.yml` corre en cada push a `main` que
toque `data/products.json` (o manual con `workflow_dispatch`) y regenera
cuatro cosas, comiteando de vuelta a `main` si hay cambios:

1. **JSON-LD estático de producto** (`.github/scripts/generate_product_schema.py`)
   — bloque `schema.org Product` por cada producto disponible, inyectado
   directo en el `<head>` de `ui_kits/store/index.html` y
   `en/ui_kits/store/index.html` entre marcadores
   `STATIC_PRODUCT_SCHEMA:START/END`. Antes solo existía vía JavaScript
   (`_injectProductSchema`, solo al abrir un producto) — un bot que no
   ejecuta JS nunca lo veía. Los días de preparación/tránsito que le dice a
   Google (`shippingDetails`) salen de `config.shipping` — editable desde el
   admin, pestaña Envíos ("Tiempos de envío (para Google)") — antes estaban
   escritos directo en el script, desconectados de `envios.html`.
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
4. **Datos numéricos de `llms.txt`** (`.github/scripts/generate_llms_facts.py`)
   — rango de precios, lista de materiales, umbral/costo de envío gratis y
   precios mensual/anual de Cacusa Lovers (con el % de descuento anual
   calculado, no hardcodeado), entre marcadores inline
   `<!--LLMS:NOMBRE-->...<!--/LLMS:NOMBRE-->` repartidos por el archivo.
   El resto de `llms.txt` (WhatsApp, redes, guías, políticas, FAQ, y datos
   que no viven en `products.json` como el 4% de descuento Zelle, el 10%
   de primera compra/referidos, los 5-10 días de elaboración y las 48h de
   VIP anual) sigue siendo prosa manual — ver el encabezado del script
   para el detalle exacto de qué se automatiza y qué no. Si se agrega un
   material nuevo desde el admin sin traducción registrada en el script,
   avisa por consola y usa el texto en español como respaldo en inglés
   hasta que se agregue al diccionario `MATERIAL_LABELS`.

Los 4 scripts reusan la misma lógica de slug (`slugify`/`product_param` en
Python, replicando `_slugify`/`_productParam` del JS del cliente) — deben
coincidir siempre. No entra en loop: solo escucha cambios en
`data/products.json`, y su propio commit nunca toca ese archivo (solo los
2 `index.html`, `sitemap.xml` y `llms.txt`).

Los slugs de URL de producto se generan con la misma lógica que el
JavaScript del cliente (`_slugify`/`_productParam` en `ui_kits/store/index.html`)
replicada en Python (`slugify`/`product_param` en
`generate_product_schema.py`) — deben coincidir siempre.

### Regla de escape: nada crudo dentro de un `<script>`

Estos scripts escriben dentro de `<script>` en HTML público, y algunos de
los datos que insertan **los escribe cualquiera desde internet** (el nombre
y el comentario de una reseña, que se guardan en Firebase sin moderación
previa). La auditoría del 13 sep encontró ahí un XSS almacenado real: una
reseña con `</script><script>…` quedaba incrustada como código ejecutable en
las dos tiendas, se comiteaba sola y GitHub Pages la publicaba.

`json.dumps()` **no alcanza**: no escapa `<`, `>` ni `/`, y el parser HTML
corta el `<script>` en el primer `</script>` que ve, aunque esté en medio de
una cadena JSON. Implementación de referencia:
`json_for_script_tag()` en `generate_product_schema.py`, que además escapa
`<`, `>` y `&` como `\u003c` / `\u003e` / `\u0026` — son escapes JSON
válidos, así que el dato que lee Google es byte a byte el mismo.

Cualquier generador nuevo que inyecte datos dentro de un `<script>` tiene que
usar esa función (o una equivalente). Los bloques JSON-LD que el sitio arma
en runtime no tienen este problema porque usan `el.textContent`, que el
navegador no re-parsea como HTML — si alguna vez se cambia eso por
`innerHTML`, vuelve el agujero.

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

## Envío gratis de Cacusa Lovers (`freeship`)

Mismo patrón que los referidos, agregado el 13 sep: la página del club
prometía "envíos gratis en todas tus compras en tienda" pero eso no existía
en el código — la tienda aplicaba el umbral de $90 a todo el mundo por igual.

- `POST /lovers/shipping-code` en `admin-worker.js` — público pero
  origin-restringido, 10/hora por IP, y verifica el teléfono contra Firebase
  con `isActiveLoversPhone()` antes de emitir nada. Falla cerrado.
- Tipo de cupón nuevo **`freeship`**: `amount: 0`, no descuenta dinero del
  subtotal; su único efecto es anular el envío. Lo aplica
  `square-payment-worker.js` sobre `serverShipping` **antes** de armar la
  línea de envío — ese Worker recalcula el envío ignorando lo que manda el
  cliente, así que si el cupón no se aplica ahí, la tienda mostraría envío
  gratis y Square cobraría igual.
- En la tienda, el helper `_cpIsFreeShip()` cubre las 6 rutas de cálculo de
  envío y las 5 de descuento en dinero (las 4 formas de pagar: resumen,
  Square, Zelle y WhatsApp).

**Diferencia deliberada con el código de referido:** `AMIGA` + los últimos 6
dígitos del teléfono es **deducible** por cualquiera que conozca ese número
(hallazgo bajo de la auditoría, todavía abierto). El de envío se deriva por
HMAC con `SESSION_SECRET` — sigue siendo determinístico, pero no adivinable.
Cualquier código nuevo por-clienta debe seguir el segundo patrón, no el
primero.

**Bug encontrado y corregido el 16 sep**: `/coupon/validate` y
`/coupon/burn` en `admin-worker.js` bloqueaban con `cpused:ph:*`/`cpused:em:*`
a cualquiera que ya hubiera usado un código antes — aplicado sin distinción,
esto rompía en silencio este mismo envío gratis en la **segunda** compra de
cualquier suscriptora (el código está pensado para reusarse en cada compra,
no de un solo uso). Ahora ese bloqueo se salta para cupones atados a una
sola persona por diseño: `restrictToEmail` presente, o `kind ===
'lovers-shipping'`. Cualquier cupón nuevo pensado para reusarse debe caer
en una de esas dos condiciones o va a toparse con el mismo bug.

**Hallazgo de seguridad del 16 sep (barrido) — `restrictToPhone`**: quitar
ese bloqueo dejó al descubierto que el cupón de envío no estaba atado a
nadie: se creaba sin `restrictToEmail`, sin vencimiento y sin tope de usos,
y su desactivación al cancelar nunca se implementó (el comentario decía "se
desactiva desde el panel"; nadie lo hacía). Quien tuviera el código `ENVIO…`
viajaba gratis para siempre, fuera o no suscriptora. Ahora:

- El cupón guarda **`restrictToPhone`**, que hacen cumplir `couponIsValid()`
  y la copia independiente de `square-payment-worker.js` — esa segunda es la
  que importa de verdad, porque es el único punto donde el envío se anula
  (si se olvida ahí, el agujero sigue abierto; es el mismo error que ya se
  cometió con `restrictToEmail`).
- La comparación es por los **últimos 7 dígitos** (`samePhone()`, misma
  normalización laxa que `isActiveLoversPhone()`): la misma clienta escribe
  su número con o sin código de país según el formulario, y exigir
  coincidencia exacta la dejaría fuera de su propio beneficio.
- **Desactivación automática al cancelar**, enganchada al mismo hop interno
  que ya apaga el cupón exclusivo del 5% — al cancelar se apagan los dos.
  Se ubica vía un índice **`loversship:<últimos 7>` → código**, necesario
  porque el código es un HMAC de una sola vía y el teléfono guardado en
  Firebase no siempre coincide dígito a dígito con el que se tecleó al
  pedirlo. El índice se reescribe en cada pedido del código (idempotente),
  así los cupones anteriores a este cambio quedan indexados solos.
- Los cupones `ENVIO…` **emitidos antes de este cambio** no tienen
  `restrictToPhone` ni índice: siguen funcionando para cualquiera y no se
  pueden desactivar solos hasta que su dueña vuelva a pedir el código (ahí
  se le agregan los dos). Si llegan a ser varios, lo limpio es desactivarlos
  a mano desde el panel — el endpoint es self-service y reemitirlos es
  inmediato.

## Correo saliente — nunca concatenar un dato sin validar en las cabeceras

`sendGmail()` en `admin-worker.js` arma el mensaje MIME a mano
(`To: ${to}\r\n…`). El barrido del 16 sep encontró ahí una **inyección de
cabeceras real y explotable**: el email entraba por `/lead/register` (ruta
pública) validado solo con `.includes('@')`, así que
`atacante@evil.com\r\nBcc: victima@gmail.com` agregaba cabeceras nuevas — o,
con `\r\n\r\n`, cerraba el bloque de cabeceras y escribía el cuerpo. Es
decir: correo arbitrario saliendo de `facturacioncacusa@gmail.com` con DKIM
y SPF válidos de Gmail. El allowlist de Origin no protege (se falsifica con
`curl`), y el rate limit solo acota el volumen.

- **`isValidEmail()`** es ahora la única validación aceptable para cualquier
  dirección que pueda terminar en un envío. Lo importante del regex es el
  `\s` de la clase negada: cubre `\r` y `\n`. Se aplica en los 5 puntos de
  entrada (`handleLeadRegister`, `handleLeadSendWelcome`,
  `handleLoversExclusiveCoupon`, `handleLoversExclusiveBulk`,
  `handleLoversNotifyPending`) **y** como barrera dura dentro de
  `sendGmail()` — así cualquier ruta de envío nueva queda cubierta sola.
- **No** se usa en `/coupon/validate` ni `/coupon/burn`: ahí el email solo
  arma una llave de KV y se compara contra `restrictToEmail`. Endurecerlo
  podría dejar fuera del checkout a una clienta con un correo válido pero
  raro, sin ganar nada de seguridad.
- Ojo con la segunda vía: el correo del cupón exclusivo toma direcciones de
  **Firebase**, y esos registros los escribe el formulario **público** de
  suscripción. Cualquier dato que venga de Firebase es dato de internet.

## Leads (10% del popup + carritos abandonados) — una llave por email

Igual que los pedidos (`order:<id>`), cada lead vive en su propia llave de
KV `lead:<email>` — no en un blob único como antes del 16 sep. El cambio
salió de una auditoría del sistema de push que encontró una condición de
carrera real: con todos los leads en un solo blob JSON, cualquier escritura
leía TODO el array, lo modificaba y volvía a escribir TODO — dos requests
concurrentes tocando leads DISTINTOS (ej. `checkAbandonedCarts()` marcando
`notified` en el lead A mientras `removeCartLead()` borraba el lead B, de
dos visitantes al mismo tiempo) podían pisarse, perdiendo el cambio de
quien escribe primero en silencio.

- `leadKey(email)` / `listAllLeads()` / `refreshLeadsCache()` en
  `admin-worker.js`, mismo patrón que `orderKey`/`listAllOrders`/
  `refreshOrdersCache()`. `leads_cache` es lo que sirve `/lead/list` (así
  el panel no escanea todas las llaves en cada poll de 30s) — pero
  `checkAbandonedCarts()` sigue escaneando las llaves `lead:*` directo, no
  la caché, porque necesita el estado más reciente para decidir a quién
  marcar `notified` (igual que las mutaciones de pedidos nunca confían en
  `orders_cache`).
- `migrateLegacyLeadsIfNeeded()` — migración única e idempotente del blob
  legado `leads`, disparada desde `/lead/list`. Diferencia importante con
  la migración de pedidos: acá **nunca se pisa una llave que ya exista**.
  Un id de pedido siempre es fresco y nunca choca con uno legado, pero un
  email SÍ puede coincidir con un registro legado — si un write en vivo
  (ej. el correo de bienvenida ya se mandó de verdad) se adelanta a la
  migración para ese mismo email, la migración lo deja intacto en vez de
  pisarlo con la versión vieja del blob.
- `backup-worker.js` respalda `lead:*` con `listKvPrefix()` (igual que
  `order:*`), no con un solo `getKvValue('leads')` — si se te olvida este
  detalle al agregar un campo nuevo por-lead en el futuro, el backup diario
  seguiría funcionando solo, pero cualquier prefijo NUEVO que no sea
  `lead:` quedaría fuera silenciosamente.
- **Un solo escaneo por request (fix del mismo día)**: la primera versión del
  refactor llamaba a `listAllLeads()` hasta 3 veces dentro de un solo
  `/lead/register` (al refrescar la caché tras escribir el lead, dentro de
  `markLeadWelcomeSent()` si mandaba el correo, y dentro de
  `checkAbandonedCarts()`), cada una con su propio `PUT leads_cache`. Ahora
  `checkAbandonedCarts()` y `markLeadWelcomeSent()` aceptan
  `{ refreshCache: false }` para saltarse su refresco propio, y
  `handleLeadRegister` hace un único `listAllLeads()` (correo primero, para
  que `welcomeSent` ya esté escrito cuando se escanea) y un único
  `writeLeadsCache()` al final. `handleLeadSendWelcome` (el botón manual del
  panel) no cambió — sigue refrescando por su cuenta, es de baja frecuencia.
  Cualquier función nueva que toque leads en un flujo automático de alta
  frecuencia debe seguir este mismo patrón (recibir el array ya escaneado en
  vez de volver a listar) en vez de llamar a `refreshLeadsCache()` a ciegas.

## Código de bienvenida del 10% por correo (`welcome10`)

Agregado el 16 sep. Antes de esto, el popup del 10% (`registerLead(email,
'vignette')`) solo abría WhatsApp — el descuento real lo daba alguien del
equipo a mano, coordinando por chat, sin ningún cupón de verdad detrás.

- `welcomeCouponCode()`/`ensureWelcomeCoupon()` en `admin-worker.js` — mismo
  patrón no-adivinable que el envío gratis de Lovers (HMAC del email con
  `SESSION_SECRET`, prefijo `BIENVENIDA`). Cupón `maxUses: 1`, vigencia de 3
  meses desde que se genera, y un campo nuevo **`restrictToEmail`** que
  `couponIsValid()`/`handleCouponBurnPublic()` hacen cumplir — nadie más que
  la clienta que se registró puede usarlo en el checkout, aunque conociera
  el código.
  **Ojo con `square-payment-worker.js`**: tiene su propia copia de esta
  validación (`couponLoadValid`/`couponPeekCents`, Worker separado sin
  binding hacia cacusa-admin para reusar la lógica) — cualquier campo nuevo
  que se agregue a un cupón y deba respetarse en pagos con tarjeta hay que
  replicarlo ahí también (16 sep: `restrictToEmail` se agregó a
  `couponIsValid()` pero se olvidó ahí al principio — pagos con tarjeta
  cobraban el 10% sin revisar el email hasta que se corrigió el mismo día).
- Se manda por **Gmail API (OAuth2)**, no SMTP con contraseña — sale
  literalmente de `facturacioncacusa@gmail.com` (helpers `gmailAccessToken()`
  / `sendGmail()`). Runbook completo de cómo generar los 3 secrets
  (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, vía
  Google Cloud Console + OAuth Playground) en el encabezado de
  `admin-worker.js`.
- **Automático** para leads nuevos (`handleLeadRegister`, solo cuando
  `source === 'vignette'`, nunca para carritos abandonados). **Manual** vía
  `POST /lead/send-welcome` (sesión de admin) — botón "Enviar código" en
  `LeadsTab` del panel, para los leads que ya existían antes de esto.
  Idempotente: reenviar a la misma clienta reusa el mismo código en vez de
  generar uno nuevo o resetear la vigencia.
- **El popup nunca dice "revisa tu correo" sin confirmar que se registró de
  verdad** (fix del 16 sep, en las 4 páginas: `index.html`, `en/index.html`,
  `ui_kits/store/index.html`, `en/ui_kits/store/index.html`). Antes el
  `fetch` a `/lead/register` iba con `.catch(()=>{})` y el mensaje de éxito
  se mostraba igual, sin esperar la respuesta — si el Worker estaba caído o
  fallaba la red, a la clienta se le mentía que ya tenía su código, sin
  forma de reintentar. Ahora el botón espera la respuesta real (`r.ok`):
  éxito → mismo flujo de siempre; falla → mensaje distinto (`role="alert"
  aria-live="assertive"`, símbolo `✕`), botón y campo de email se
  reactivan, y el popup NO se cierra solo, para que pueda intentarlo de
  nuevo. En la tienda, `registerLead()` (compartida con el tracking de
  carrito abandonado) ahora es `async` y devuelve `true`/`false` — el
  checkout la sigue llamando fire-and-forget (no le importa el resultado),
  solo el vignette espera el valor.

## Cupón exclusivo de Cacusa Lovers (`lovers-exclusive`)

Agregado el 16 sep — es el beneficio real detrás de "Cupones de descuento
exclusivos", que ya estaba anunciado en los 2 planes de
`cacusa-lovers.html` (mensual y anual) desde antes, sin nada implementado.

- **5% de descuento, en toda compra, mientras la suscripción siga activa**
  — a propósito muy distinto de `welcome10`: `maxUses: null` (sin límite
  de usos, se reusa en cada compra) y sin `expiresAt` (no vence por
  calendario, vence cuando cancela). `loversExclusiveCode()` en
  `admin-worker.js`, mismo patrón HMAC no-adivinable que
  `loversShippingCode()`, con `restrictToEmail` para que nadie más que esa
  suscriptora lo use.
- **Activación/desactivación 100% automática**, sin que nadie del equipo
  tenga que acordarse: `lovers-webhook-worker.js` avisa a `admin-worker.js`
  (ruta interna `/internal/lovers/exclusive-coupon`, Worker-a-Worker con
  `ORDER_INGEST_KEY`, mismo Service Binding `ADMIN_WORKER` que ya usa
  `notifyAdminPush()`) desde el mismo punto donde ya marca a alguien
  `'activo'` (`invoice.payment_made`, alta manual desde el panel) o
  `'cancelado'` (`subscription.updated` con `status=CANCELED`).
  `handleLoversExclusiveCoupon()` es idempotente — activar a alguien que ya
  tenía el cupón activo no hace nada (y sobre todo, no le reenvía el correo
  en cada cobro mensual/anual); solo manda correo la primera vez que se le
  crea.
- **Rollout a las que ya estaban activas antes de que esto existiera**:
  botón "✦ Enviar cupón exclusivo a todas las activas" en `LoversTab` del
  panel → `POST /lovers/exclusive-coupon/bulk` (sesión de admin) — salta
  solo a quien ya lo tenga, se puede apretar más de una vez sin duplicar
  nada.
- **Idioma del correo (16 sep, fix)**: `cacusa-lovers.html`/
  `en/cacusa-lovers.html` guardan `idioma: 'es'`/`'en'` en el registro de
  Firebase al momento de suscribirse (según qué archivo lo llenó) —
  `notifyExclusiveCoupon()` en `lovers-webhook-worker.js` usa
  `existing.idioma || existing.pais` para decidir el idioma del correo.
  Antes se adivinaba solo por `pais === 'Ecuador' ? 'es' : 'en'`, lo cual
  fallaba para cualquier suscriptora que vive en un país distinto al de su
  idioma real (ej. alguien en USA que se suscribió desde la página en
  español). El heurístico por país se mantiene como fallback solo para
  registros sin `idioma` guardado (suscriptoras de antes de este campo, o
  alta manual desde el panel — ese formulario no pregunta idioma).

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
  - **Seguridad** (2 rondas: 7 sep y 13 sep — 20 hallazgos, 13 resueltos,
    5 pendientes, 2 notas):
    `https://claude.ai/code/artifact/6872c756-df31-4134-bf6b-b16219a461ca`
  - **Confiabilidad de información** (13 hallazgos, 8 corregidos, 5
    anotados — el mismo dato contado distinto en distintos lugares):
    `https://claude.ai/code/artifact/beb77ccc-a4a6-4238-93ef-1d5e8f9e682b`
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

## Seguridad — auditado en 2 rondas (quedan 5 pendientes)

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
- **Moderación de reseñas** (13 sep): las reseñas nuevas nacen con
  `approved: false` y no se muestran hasta que el admin las apruebe
  (`POST /admin/reviews/:producto/:id/approve` en `lovers-webhook-worker.js`).
  El filtro en los 4 consumidores es `approved !== false`, **no**
  `=== true`, a propósito: las reseñas anteriores al cambio no tienen el
  campo y deben seguir visibles. Importa porque esas reseñas alimentan el
  `aggregateRating` que se publica para Google.
- **Verificado a nivel de base de datos (17 sep)**: no bastaba con que
  `submitReview()` siempre mande `approved: false` — alguien podía saltarse
  el sitio por completo y escribir directo a la REST API de Firebase con
  `approved: true`, auto-aprobándose. Se pidieron las reglas actuales de
  Firebase (Console → Realtime Database → Rules) y `cacusa_reviews` YA las
  hace cumplir:
  ```json
  "approved": { ".validate": "newData.isBoolean() && newData.val() === false" }
  ```
  Cualquier creación con `approved` distinto de `false` (o ausente) es
  rechazada por la regla misma, sin depender de que el cliente se porte
  bien. `".write": "!data.exists()"` en el mismo nodo además impide editar
  una reseña ya creada desde afuera — el flujo de aprobación real (que SÍ
  pone `approved: true`) pasa por `lovers-webhook-worker.js` con
  `FB_DB_SECRET`, que bypassa las reglas por diseño de Firebase.

## Auditoría externa (ChatGPT, 19 sep) — triaje y arreglos

Se revisó una auditoría externa de 19 hallazgos (A01-A19) contra el código
real (`workers-src` @ `2bc5896`, `main` del momento). Verificación propia
(no solo la del documento externo): 15 de 19 eran reales, 2 estaban mal
citados/parciales, 2 exagerados. Se corrigieron 8 en esta tanda — el
crítico, los de dinero/fraude, y los que rompían funcionalidad real:

- **A01 (crítico) — login sin contraseña real**: `passwordFor(user)` en
  `admin-worker.js` hacía un lookup directo sobre un objeto literal, que
  hereda de `Object.prototype`. Con `user:"constructor"` el lookup devolvía
  la función `Object` (no `undefined`), y `safeEqual()` la convertía a un
  string adivinable (`"function Object() { [native code] }"`) — cualquiera
  podía loguearse sin ser `tita.jaramillo` ni `robin.gonzalez`. Arreglado con
  `VALID_USERS` (`Set`), que no consulta el prototype.
- **A03 — gift card no se descontaba bien**: `handleOrder()` capeaba el
  monto pedido contra `newOrder.total`, que llega ya **neto** (descontado
  gift card + cupón). Una compra de $100 pagada 100% con gift card de $100
  llegaba con `total=$0`, así que nunca se descontaba nada del saldo real.
  Ahora se compara contra el subtotal bruto recalculado de
  `newOrder.productos`.
- **A05 — Square aceptaba cupones que Admin rechazaría**:
  `couponLoadValid()` en `square-payment-worker.js` nunca revisaba
  `cpused:*`/`refmonth:*` (anti-reuso, tope mensual de referidos) — se portó
  el mismo guard `repeatableByDesign` que ya protege welcome10/lovers-
  shipping de este chequeo.
- **A06 + A10 — el checkout confirmaba sin esperar al servidor**:
  `submitOrder()`/`burnCoupon()` (`ui_kits/store/index.html`, `en/`) eran
  fire-and-forget — si el Worker fallaba, se quemaba el cupón, se abría
  WhatsApp y se vaciaba el carrito igual, sin que el pedido existiera. Ahora
  ambos devuelven `true`/`false`, y los 2 checkouts (Zelle, WhatsApp) esperan
  la confirmación antes de continuar; si falla, error visible y el carrito
  queda intacto para reintentar.
- **A11 — email faltante para pagos con tarjeta**: el objeto `customer` que
  se manda a `square-payment-worker.js` no incluía `email` — un cupón propio
  con `restrictToEmail` (welcome10, el exclusivo de Lovers) siempre se
  rechazaba pagando con tarjeta. Se agregó el campo en los 2 archivos.
- **A12 — código de envío gratis duplicable**: `loversShippingCode()`
  firmaba con el teléfono completo, pero el índice de cancelación
  (`loversShipIndexKey`) usa los últimos 7 dígitos — el mismo número en 2
  formatos (con/sin código de país) generaba 2 cupones `ENVIO...`
  distintos, uno no cancelable. Ahora ambos derivan de los mismos últimos 7
  dígitos. Nota: un código emitido ANTES de este cambio, si esa clienta
  pidió el código alguna vez en un formato distinto, queda huérfano — mismo
  tipo de limitación ya aceptada para `restrictToPhone` el 16 sep.
- **A02 — alta pública de Lovers se puede auto-activar**: nada impedía que
  el navegador mandara `estado_pago: 'activo'` en vez de `'pendiente'` al
  crear un registro en `cacusa_lovers/$subId` — quien escribiera directo a
  la REST API de Firebase se auto-activaba y recibía todos los beneficios
  reales sin pagar. Se agregó a las reglas de Firebase (Console → Realtime
  Database → Rules, dentro de `cacusa_lovers/$subId`, mismo patrón que
  `approved` en reseñas):
  ```json
  "estado_pago": { ".validate": "newData.val() === 'pendiente'" }
  ```
  y se sumó `'estado_pago'` a la lista de `hasChildren([...])` del
  `.write` de ese nodo, para que sea obligatorio en la creación, no
  opcional. La activación real sigue intacta:
  `lovers-webhook-worker.js` usa `FB_DB_SECRET`, que bypassa las reglas.

Los 6 arreglos de Workers (`admin-worker.js`, `square-payment-worker.js`)
ya están desplegados (confirmado 19 sep) en `cacusa-admin` y
`cacusa-square`. Los 2 de la tienda (`ui_kits/store/index.html`, `en/`) ya
están en `main` y publicados solos.

### Hallazgos NO corregidos en esta tanda (documentados, sin tocar código)

- **A04** (parcial/mal citado) — el documento externo citaba un patrón
  `processed` en `lovers-webhook-worker.js:425-434` que no existe en el
  archivo; la preocupación de fondo (acciones múltiples sin atomicidad en
  el handler de `invoice.payment_made`, ~líneas 690-719) sí es real, pero
  la cita puntual estaba mal.
- **A07-A09, A13-A19** (real/exagerado según el caso, no re-detallado
  acá) — quedan para una tanda futura; no se actuó sobre ellos. Incluyen:
  reglas de Firebase para lectura de reseñas, hardening de WebAuthn, rutas
  muertas de TikTok, robustez del ID/caché de pedidos, orden Gmail-antes-
  de-KV, y otros de menor severidad que A01-A12.

### 2da ronda (19 sep, mismo día) — 3 hallazgos más, verificados y corregidos

El usuario volvió a pasar 4 puntos de ChatGPT sobre el trabajo ya
desplegado. Verificación propia otra vez antes de tocar nada: 3 reales y
nuevos, 1 ya documentado (no es hallazgo nuevo).

- **A20 — las sesiones no revalidaban el usuario, solo la firma**:
  `verifyToken()` en `admin-worker.js` y su copia independiente en
  `lovers-webhook-worker.js` solo chequeaban firma HMAC + expiración
  (12h) — nunca `payload.user` contra `VALID_USERS`. Un token firmado
  ANTES del fix de A01 (o cualquier bug futuro de firma) seguía siendo
  válido hasta su expiración natural, aunque `passwordFor()` ya rechazara
  ese usuario en el login. Ahora las 2 copias de `verifyToken()` hacen
  `if (!VALID_USERS.has(payload.user)) return null;` — invalida de
  inmediato cualquier token histórico que no sea de una cuenta real.
  `lovers-webhook-worker.js` no tenía `VALID_USERS` definida — se agregó
  duplicada, mismo patrón que el resto de secretos compartidos entre
  Workers (no hay módulos compartidos en Cloudflare Workers).
- **A03, residual — la gift card seguía sin cubrir envío/impuesto**: el
  primer arreglo (ronda 1) capeaba contra `productos.reduce(price*qty)`,
  sin sumar envío ni impuesto. Ejemplo real confirmado: compra de $100 +
  $20 de envío/impuesto, gift card de $120 → solo se descontaban $100
  (`min(120,100)`), dejando $20 de saldo real sin gastar aunque la tienda
  ya le había mostrado a la clienta que el gift card cubría el total
  completo. `buildOrderCore()` YA aceptaba `envio`/`impuesto` (`num()`,
  sin usarlos en ningún lado) — solo faltaba que la tienda los mandara.
  Ahora `handleOrder()` suma `newOrder.envio + newOrder.impuesto` al
  subtotal bruto, y `ui_kits/store/index.html`/`en/` mandan esos 2 campos
  (más `subtotal`, informativo) en los 2 checkouts (Zelle, WhatsApp) — ya
  calculados en el navegador (`shippingCost`/`zelleTax` y `waShip`/
  `waTax`), solo faltaba incluirlos en el payload. Pagos con tarjeta no
  tenían este problema: `square-payment-worker.js` recalcula precios,
  envío e impuesto contra el catálogo real antes de llamar a
  `/giftcard/redeem` con el monto exacto ya server-side.
- **A02, residual — la regla de Firebase no validaba el email ni bloqueaba
  campos extra**: la regla de `estado_pago` (ronda 1) exigía el valor
  correcto, pero `email` no tenía ningún formato exigido (cualquier string
  pasaba) y no había `$other: {".validate": false}` — cualquiera podía
  agregar campos arbitrarios al crear un registro. Se agregó validación de
  formato de email (`.matches()`, no previene que alguien use el email de
  otra persona — eso no se puede verificar sin un flujo de confirmación
  real, fuera de alcance de una regla de base de datos) y se declararon
  los 15 campos reales que manda el formulario público
  (`cacusa-lovers.html`/`en/`, verificados uno por uno) como únicos
  permitidos — ver el snapshot arriba. Cualquier campo nuevo que se agregue
  al formulario público a futuro tiene que sumarse también a esta regla, o
  la escritura se va a rechazar sola (mismo trade-off ya aceptado para
  `cacusa_reviews`).
- **Descartado como hallazgo nuevo**: "problemas del webhook Lovers y de
  confirmación del pedido" — es el mismo A04 ya documentado arriba (acción
  múltiple sin atomicidad en `invoice.payment_made`), no algo nuevo que se
  encontrara. Sigue sin corregirse, a propósito, en esta tanda.

Los 2 Workers (`admin-worker.js`, `lovers-webhook-worker.js`) con estos 3
arreglos de código quedan **pendientes de deploy manual** — ver abajo. La
regla de Firebase también queda pendiente de pegar en Console.

### Pasos manuales pendientes (no se pueden hacer desde el repo)

1. **Deploy de `admin-worker.js` y `lovers-webhook-worker.js`** con los
   arreglos de la 2da ronda (A20 en los dos; A03-residual solo en admin) —
   entregados el 19 sep.
2. **Regla de Firebase actualizada para `cacusa_lovers`** (A02-residual,
   arriba) — pegar el snapshot completo actualizado (sección "Reglas de
   Firebase RTDB" más arriba) en Console → Realtime Database → Rules.

La privacidad del bucket R2 `cacusa-backups` quedó verificada el 16 sep
(ver "Backups y recuperación de desastres" más arriba), y la regla de
Firebase que exige `approved === false` en reseñas nuevas quedó verificada
el 17 sep — ya vive en las reglas de la base de datos (ver "Moderación de
reseñas" más arriba).

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
