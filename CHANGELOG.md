# Changelog — CACUSA by Taitus

Historial de los cambios reales hechos al sitio, agrupados por fecha, en
lenguaje simple — no es un log técnico crudo. Para el detalle exacto de
cualquier cambio, el commit real queda en el historial de git de este
repositorio (`git log`).

No incluye los cientos de commits automáticos `[Admin] Productos` /
`Imagen:` que se generan cada vez que Tita o Robin agregan, editan o suben
fotos de un producto desde el panel admin — eso es mantenimiento normal del
catálogo, no versionamiento del sitio.

---

## Antes del 9 de agosto de 2026 — sin historial verificable

El sitio (home, tienda, panel admin, todo el diseño) ya existía completo y
funcionando antes de esta fecha — pero **no hay ningún registro de eso en
el git de este repositorio**. El primer commit que existe acá
(9 de agosto de 2026) no es un punto de partida: ya trae el sitio entero
de una sola vez, sin ningún commit previo que muestre cómo se construyó.
Se revisaron las 3 ramas del repo (`main`, `workers-src`,
`claude/implement-landing-page-Ssmfm`) y ninguna tiene historial más
antiguo.

No se reconstruye esa etapa por fecha ni por hito acá porque no hay ninguna
fuente verificable para hacerlo — ni en git, ni en memoria de esta sesión
(no hay memoria real entre sesiones de Claude). Si en algún momento aparece
algo confiable de esa época (capturas, notas, otro repositorio), se puede
agregar aquí como sección aparte, dejando claro que viene de otra fuente y
no del historial de git.

## 9 de agosto – 4 de septiembre de 2026 — mantenimiento normal del catálogo

En este tramo el repositorio solo registra actividad rutinaria del panel
admin: Tita y Robin agregando, editando y subiendo fotos de productos
(`[Admin] Productos`, `Imagen:`, `Imagen galería:`). No hay cambios de
desarrollo del sitio en sí durante este período — el primer commit de
desarrollo real después del arranque del repo es el del 5 de septiembre,
con el que empieza el detalle de abajo.

---

## 2026-09-14 — Revisión a fondo de las notificaciones push del admin

- **La notificación push de nueva suscripción a Cacusa Lovers no sonaba
  nunca** — ni al llegar pendiente ni al confirmarse el pago. El aviso
  solo se mandaba cuando el registro en la base de datos "todavía no
  existía", pero en el flujo real siempre existe ya (el formulario del
  sitio lo crea antes de mandar a la clienta a pagar). Corregido para las
  3 etapas: pendiente, pago confirmado, pago fallido (este último no
  avisaba nada antes, en ninguna rama).
- **Auditoría completa del sistema de push** (panel admin + los 3 Workers
  que pueden dispararlo — pedidos, Lovers, backup):
  - Cada tipo de aviso ahora manda su propio identificador — antes todos
    compartían uno solo y un aviso nuevo podía tapar en silencio a otro
    que todavía no se había leído (ej. una suscriptora nueva ocultando un
    pedido sin revisar).
  - Bug real en pedidos nuevos: si el envío del push fallaba, el pedido
    igual quedaba guardado pero el sistema respondía como si todo el
    pedido hubiera fallado — riesgo de pedidos duplicados por reintento
    del cliente o del soporte.
  - Condición de carrera en el aviso de carrito abandonado (se disparaba
    desde 2 lugares a la vez y podía duplicar el aviso o perder un lead)
    — corregida, ahora un solo disparador.
  - En iPhone, si Safari no tenía el panel instalado en la pantalla de
    inicio, no se veía ni el botón de activar notificaciones ni la
    explicación de qué hacer — el aviso existía en el código pero estaba
    en una rama inalcanzable justo para ese caso.
  - El Service Worker del panel ahora se actualiza solo (antes podía
    quedar en una versión vieja mientras el panel siguiera abierto, que es
    lo normal) y se vuelve a suscribir solo si el navegador invalida la
    suscripción sin avisar.

## 2026-09-13 — Auditoría de seguridad y de confiabilidad de información

Segunda auditoría de seguridad (la primera fue el 7 de septiembre) más una
auditoría nueva: si el sitio cuenta la misma información de forma coherente
en todos los lugares donde la repite.

### Lo más grave: cualquiera podía dejar código malicioso en la tienda

Una cadena de cinco piezas que por separado parecían inofensivas: el
formulario de reseñas escribe directo en la base de datos sin moderación;
un script automático levantaba esas reseñas y las metía en la ficha técnica
que lee Google sin limpiar el texto; el navegador corta un bloque de código
en el primer cierre que encuentra, aunque esté dentro de un texto. Resultado:
una reseña con el texto justo quedaba incrustada **como código ejecutable**
en las dos tiendas, se comiteaba sola y se publicaba — en la misma página
donde la clienta llena dirección y teléfono del checkout.

Se reprodujo con una reseña de prueba antes de tocar nada, se corrigió
escapando los símbolos, y se verificó que Google siga leyendo exactamente el
mismo texto. También se revisaron los otros cinco bloques que el sitio genera
mientras navegás: ninguno tenía esa vía.

### Envío gratis de Cacusa Lovers: de promesa a beneficio real

La página del club prometía "envíos gratis en todas tus compras en tienda"
en seis lugares, pero eso **no existía en el código**: la tienda aplicaba el
umbral de $90 a todo el mundo por igual, así que una suscriptora pagaba
envío igual que cualquiera. Ahora cada suscriptora obtiene su propio código
desde la página del club, verificado contra la base de suscriptoras activas
y derivado por firma criptográfica para que no se pueda adivinar. El
servidor de pagos aplica la exención por su cuenta, así que el total que se
cobra es el mismo que se muestra.

### Reseñas: ahora pasan por aprobación

Cualquiera podía publicar reseñas sin haber comprado, y esas reseñas
alimentaban el promedio de estrellas que se publica para Google. Las nuevas
nacen ocultas y se muestran recién cuando Tita o Robin las aprueban desde el
panel; las que ya estaban publicadas siguen visibles.

### Datos que el sitio contaba de dos formas distintas

- **Precios**: el FAQ y su ficha técnica decían "desde $15 hasta $80". El
  catálogo real va de $20 a $125 — ningún producto cuesta $15.
- **Estadísticas del home**: una persona veía 650 piezas y 5 países; Google
  y cualquiera sin JavaScript veían 500 y 2.
- **Preguntas frecuentes**: 5 de las 7 estaban redactadas distinto en la
  ficha técnica que en la página. Ahora se generan del texto visible.
- **Materiales**: se venden 6, el FAQ contaba 3. Faltaban gold filled y baño
  de rodio, que sí están a la venta.
- **Envío gratis**: 20 lugares dicen "$90", pero el FAQ decía "a partir de
  cierto monto" justo donde una IA busca la cifra.
- Un botón que decía "Escríbenos por WhatsApp" llevaba a Instagram en las 8
  guías, y la home en inglés tenía 9 textos en español.

### Otros arreglos de seguridad

- El Worker de respaldos podía filtrar el secreto de la base de datos dentro
  de una notificación al celular si un backup fallaba.
- Ese mismo Worker era el único endpoint del sistema sin límite de uso.
- Las 8 páginas de guías tenían una política de seguridad vacía; ahora tienen
  la completa, verificada con un navegador real.

Quedan anotados 5 hallazgos de seguridad menores y 5 de información que
necesitan una decisión de negocio (entre ellos, que la página de envíos
muestra dos precios distintos para el mismo envío nacional). Los informes
completos están publicados como documentos aparte.

## 2026-09-13 — Inglés no nativo corregido en todo el sitio

Se revisó el contenido en inglés de las páginas públicas completas (home,
tienda, Cacusa Lovers, guías) buscando traducciones literales del español
que un hablante nativo no escribiría — a partir del ejemplo puntual
"artisanal jewelry" (debería ser "handcrafted jewelry"), que resultó ser
parte de un patrón más amplio.

- **"Artisanal" → "Handcrafted"**: aparecía en el título de la tienda,
  meta description, Open Graph, JSON-LD, palabras clave y el label del
  hero — en home, tienda y `llms.txt`. Reemplazado consistentemente.
- **Calco recurrente** "we create to make you look more beautiful than
  you already are" (traducción palabra por palabra del español, sin
  sujeto) corregido en home, tienda y Cacusa Lovers.
- **`config.lovers_en`** (el bloque de Cacusa Lovers en inglés que edita
  el admin) tenía errores de traducción automática en ~15 campos:
  "turn black" en vez de "tarnish", "jewels" en vez de "pieces", títulos
  con mayúsculas sueltas ("Random selection BY CACUSA"), frases
  entrecortadas — todo reescrito a mano.
- **13 descripciones de producto** con errores de traducción literal:
  el nombre de un producto literalmente decía "18K BATHROOM" (por "baño
  de oro"), "pellet" en vez de "ball chain", un nombre truncado ("ing"
  en vez de "Ring"), frases sin sentido tipo "my two blue eyes" o "made
  with Ecuadorian hands".
- Alt text en español ("joyería artesanal personalizada CACUSA") que
  aparecía hasta en las páginas `/en/` — traducido.
- Sección de combos de la tienda sin rama en inglés (dormida hoy porque
  no hay combos activos, pero se hubiera visto en español si se agrega
  uno) — se le agregó traducción.
- 3 calcos menores en las páginas de guías (envíos, devoluciones,
  cuidados) y un título de tarjeta en el hub de guías que rompía el
  paralelismo con las demás.

El catálogo `<noscript>` de la tienda se regeneró automáticamente para
reflejar las descripciones de producto corregidas.

## 2026-09-13 — Accesibilidad WCAG 2.1 AA en todo el sitio y el panel admin

Se auditó el sitio completo (home, tienda, Cacusa Lovers, las 8 páginas
de guías/políticas) y el panel admin contra WCAG 2.1 Nivel A y AA, y se
corrigieron los ~70 hallazgos encontrados, organizados en 8 paquetes:

- **Idioma**: `<html lang>` ahora se actualiza de verdad al cambiar a
  inglés en las 8 páginas de guías (antes quedaba fijo en español aunque
  todo el contenido visible cambiara).
- **Teclado**: selector de método de pago y estrellas de reseña en la
  tienda, el FAQ de Cacusa Lovers, las tarjetas de categoría/producto del
  home y la tienda, y el selector de fotos/checkboxes del admin — todo lo
  que antes solo respondía a click de mouse ahora se opera completo con
  Tab/Enter/Espacio.
- **Modales**: wishlist, aviso de descuento y galería de fotos de la
  tienda ahora atrapan el foco y cierran con Escape igual que el
  checkout/carrito. El panel admin estrena un componente `Modal`
  compartido (foco atrapado, cierre con Escape, retorno de foco) que
  reemplaza los 3 overlays manuales que tenía antes.
- **Foco visible**: se ve un contorno de foco claro al navegar con
  teclado en toda la tienda y el admin (antes el admin lo tenía
  desactivado en ~37 lugares).
- **Textos alternativos**: botones de solo-ícono (cerrar, mover, borrar,
  zoom, notificaciones, etc.) ganaron `aria-label` en home y admin.
- **Contraste de color**: textos rosa claro sobre fondo blanco en guías,
  Cacusa Lovers, tienda, home y admin se oscurecieron donde no llegaban
  al mínimo de legibilidad (4.5:1).
- **Formularios**: labels reales o accesibles en campos que antes solo
  tenían placeholder (tienda, Cacusa Lovers, y los 2 formularios más
  usados del admin), mensajes de error/estado que ahora se anuncian solos
  a un lector de pantalla, y campos obligatorios marcados como tales.
- **Detalles finales**: los carruseles del home y la tienda respetan
  "reducir movimiento" del sistema operativo y se pausan al pasar el
  mouse o el foco por encima; íconos puramente decorativos se ocultan de
  lectores de pantalla; tablas y el listado de piedras de nacimiento
  quedaron con la estructura semántica correcta.

Nada de esto cambia cómo se ve el sitio a simple vista — es exactamente
el mismo diseño, ahora también operable por teclado y compatible con
lectores de pantalla.

## 2026-09-12 — Fix: suscriptoras de Cacusa Lovers duplicadas

Se detectó (con una suscriptora registrada 3 veces el mismo día) que el
guardado en `cacusa_lovers` tenía una condición de carrera real: el
formulario del sitio y los webhooks de Square (`subscription.created`,
`invoice.payment_made`) escribían cada uno por su cuenta, consultando
primero si el email ya existía y creando un registro nuevo con ID al azar
si no lo encontraban. Cuando dos de esas escrituras caían casi al mismo
tiempo, ambas veían "no existe" y ambas creaban su propia copia.

Se cambió el guardado en los 5 puntos que tocan `cacusa_lovers` (formulario
en `cacusa-lovers.html`/`en/`, los 4 handlers de eventos de Square y el
alta manual desde el admin, en `lovers-webhook-worker.js`) para que todos
calculen la misma key determinística a partir del email y escriban con
merge (`PATCH`) sobre esa key exacta, en vez de buscar-y-crear con ID
al azar. Así, sin importar el orden en que lleguen los eventos, todos
apuntan al mismo registro — la duplicación queda eliminada de raíz, no
solo mitigada.

De paso, `notifyAdminPush()` ahora deja un log claro si el Worker
`cacusa-lovers-webhook` no tiene configurado `ORDER_INGEST_KEY` (antes
fallaba en silencio sin ningún rastro) — causa más probable de por qué no
llegó la notificación push de esta alta en particular.

## 2026-09-12 — Auditoría de concurrencia: pedidos en riesgo de perderse

Tras el fix de suscriptoras duplicadas, se auditaron los 3 Workers
buscando el mismo tipo de problema (escritura no atómica sobre estado
compartido) y se encontró uno más grave en `admin-worker.js`: todos los
pedidos vivían en una sola llave de KV (un blob JSON con el array
completo), y tanto un pedido nuevo entrando (checkout público o webhook
de Square) como cualquier acción del panel admin sobre un pedido
(cambiar estado, tracking, carrier, datos de cliente, o borrar) hacían
"leer todo → modificar → escribir todo de vuelta" sin ningún candado
entre sí. El panel ya mitigaba parte del riesgo con un refresco
silencioso cada 30 segundos, pero seguía existiendo una ventana real en
la que un pedido nuevo podía perderse en silencio si alguien editaba
cualquier otro pedido en esos segundos.

Se cambió el esquema a una llave de KV por pedido en vez de un blob
compartido — cada pedido nuevo, cada edición y cada borrado tocan
únicamente su propia llave, así que ya es estructuralmente imposible que
una acción sobre un pedido afecte a otro. El panel admin también se
actualizó para enviar solo el cambio puntual de cada acción en vez de
reenviar la lista completa de pedidos.

## 2026-09-05 — Lanzamiento de Cacusa Lovers

Se construyó desde cero el club de suscripción mensual:

- Página de suscripción, formulario de alta, pago recurrente con Square,
  guardado de datos en Firebase.
- Plan mensual y plan anual ($219.89/año).
- Nueva pestaña en el panel admin para gestionar suscriptoras.
- Menú hamburguesa para navegación móvil en el home.
- Autocompletado de dirección, selector de método de pago, arreglos de
  formulario en iOS y Android.
- Varios ajustes de precio, beneficios y condiciones generales sobre la
  marcha, hasta dejar el plan y el copy definitivos.

## 2026-09-06 — Estabilizar pagos y el panel admin

- Webhook de Square para capturar altas, pagos fallidos y cancelaciones de
  Cacusa Lovers en tiempo real.
- Arreglos de suscriptoras duplicadas y desincronización de datos entre
  Square y Firebase.
- Botón para cancelar una suscripción directo desde el admin.
- **Seguridad**: acceso al admin de Lovers y borrado de reseñas restringido
  al secreto real de Firebase (antes era más débil).
- Nuevo Worker `cacusa-square` para pagos con tarjeta verificados por
  webhook — el checkout de la tienda deja de confiar en un simple `?paid=1`
  de la URL para dar un pedido por pagado.
- Notificaciones push nativas (VAPID) al celular de Tita y Robin cuando
  entra un pedido nuevo.
- Primera ronda de hallazgos de alta prioridad de la auditoría SEO/
  comercial/UX corregidos.

## 2026-09-07 — Auditoría completa + sitio en inglés + seguridad

- **Sitio en inglés real** (`/en/`) para home, tienda y Cacusa Lovers —
  páginas indexables propias, no una traducción visual sobre la misma URL.
- Auditoría SEO/comercial/UX cerrada casi al 100% (hallazgos altos, medios
  y bajos): envío gratis bajado a $90, recuperación de carrito abandonado,
  checkout de la tienda en 2 pasos con resumen sticky e íconos de tarjetas,
  corrección de textos falsos ("grabado gratis", "personalización incluida
  en el precio").
- **Auditoría de seguridad**: cerrados el hallazgo crítico (clave de admin
  expuesta), el alto (gift cards sin pedido real detrás) y los 3 de riesgo
  medio.
- Cabecera de seguridad CSP agregada a las 7 páginas públicas.
- Alta manual de suscriptoras de Cacusa Lovers desde el admin (para pagos
  por transferencia, sin suscripción real en Square).

## 2026-09-09 — Benchmark mundial, referidos y SEO avanzado

- **Benchmark contra las mejores joyerías del mundo** (Mejuri, Kendra Scott,
  Pandora, etc.) — 6 quick wins implementados: tiempo real de
  personalización unificado a 5–10 días, guía de tallas, guía de regalos,
  la excepción de defecto de fábrica más visible en el checkout, el
  empaque como parte del valor, y un beneficio real diferenciando el plan
  anual del mensual.
- **Programa de referidos**: código único por suscriptora, 10% de
  descuento para la amiga referida, exclusivo para suscriptoras activas de
  Cacusa Lovers, máximo 1 uso exitoso por mes.
- Fix de un bug de la cabecera de seguridad que bloqueaba subir fotos de
  producto desde el admin.
- **Cada categoría de la tienda con su propia URL** indexable (antes solo
  era un filtro visual sobre la misma página).
- **Primera pantalla de la tienda** rediseñada: selector visual de
  categorías con fotos rotando (carrusel), en vez de mostrar los ~76
  productos de golpe.
- **JSON-LD y sitemap de producto generados y mantenidos solos**: un
  proceso automático regenera esta información cada vez que se agrega,
  edita o elimina un producto desde el admin, sin intervención manual.
- **Hub de guías** (`guias.html`) conectando todas las guías del sitio, más
  2 artículos nuevos: significado de las piedras de nacimiento, y cómo
  combinar/apilar joyas.
- `robots.txt` actualizado con los bots de IA que faltaban (Google-Extended,
  Applebot, Meta-ExternalAgent, CCBot, Bytespider) y bloqueo de páginas
  internas que no debían ser públicas.
- **Código fuente de los 3 Workers sacado de la rama pública** — vive en
  una rama aparte (`workers-src`) que GitHub Pages nunca sirve.
- Documentación completa del proyecto en `CLAUDE.md`, para que cualquier
  sesión futura tenga todo el contexto sin tener que redescubrirlo.
