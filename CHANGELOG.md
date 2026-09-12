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
