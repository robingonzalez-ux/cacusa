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

## 2026-09-19 (8va tanda) — los productos destacados del home ya usan las URLs nuevas

Quedaba pendiente de la auditoría SEO grande: los datos que le muestra el
home a Google sobre sus "productos destacados" (Bestsellers) seguían
armando el enlace de cada producto con el formato viejo. Ya usan la misma
URL real que el resto del sitio desde hace unos días.

---

## 2026-09-19 (7ma tanda) — limpieza de páginas de productos ya eliminados

Al revisar el hallazgo anterior se encontró que las páginas individuales
de un producto nunca se borraban cuando ese producto se eliminaba del
catálogo — quedaban publicadas para siempre con contenido viejo (incluida
la foto con la dirección equivocada de la tanda anterior). Se corrigió
para que se borren solas cada vez que se regenera el catálogo, en vez de
acumularse. Se limpiaron 15 productos (en español e inglés) que ya
llevaban un rato eliminados.

---

## 2026-09-19 (6ta tanda) — las fotos de producto apuntaban al dominio equivocado

El usuario mandó 2 avisos que le llegaron de Google Search Console
("página con redirección" y "duplicada, canónica distinta"). Investigado
a fondo: cada foto de producto que se sube desde el panel admin quedaba
guardada con la dirección genérica de GitHub (`robingonzalez-ux.github.io`)
en vez de la dirección real del sitio (`cacusabytaitus.com`) — el archivo
es el mismo, pero esa dirección genérica siempre redirige a la real, así
que cada foto (la que se ve en la tienda, y la que Google usa para
indexar cada producto) pasaba por un salto de más. No era algo viejo: las
fotos subidas hoy mismo también salían mal — es un error de código, no de
datos históricos.

Se corrigió en la fuente (el panel admin ya no genera esa dirección
equivocada) y se actualizaron las ~108 fotos que ya estaban guardadas mal
para que apunten directo a la dirección correcta. Quedó pendiente el
despliegue manual de 1 Worker — ver detalle en `CLAUDE.md`.

De paso se encontró (sin corregir, es una decisión aparte): hay unas 15
páginas de productos que ya se eliminaron del catálogo hace tiempo, pero
sus páginas viejas siguen publicadas con contenido desactualizado.

---

## 2026-09-19 (5ta tanda) — categorías faltantes en el sitemap + falsos "rojos" en el Action de productos

- Las 18 páginas de categoría (9 categorías, en español e inglés) que se
  crearon en la tanda anterior nunca se habían agregado al mapa del sitio
  — quedó un hueco desde el día que se creó esa parte de la auditoría SEO.
  Ya se agregaron.
- Detectado por el usuario: el Action que regenera el catálogo automático
  a veces aparecía en rojo ("Failure") en GitHub cuando Tita o Robin
  editaban varios productos muy seguido. Investigado a fondo: no era un
  dato roto ni una venta afectada — dos regeneraciones corriendo casi al
  mismo tiempo se pisaban al guardar, y la más lenta de las dos fallaba al
  publicar (la más rápida ya había avanzado el historial). El catálogo
  público nunca quedó desactualizado por esto, porque la edición más
  reciente siempre dispara su propia regeneración correcta. Se corrigió
  para que reintente automáticamente en vez de aparecer en rojo sin
  necesidad.

---

## 2026-09-19 (4ta tanda) — 2 arreglos más de la auditoría SEO: producto inexistente y canonical faltante

De la misma auditoría SEO externa, se cerraron 2 hallazgos más que habían
quedado pendientes:

- Antes, si alguien entraba a la tienda con un enlace a un producto que ya
  no existe (por ejemplo un enlace viejo de un producto eliminado hace
  tiempo), la página se mostraba igual que si fuera una tienda normal, sin
  avisar nada — confuso tanto para la clienta como para Google. Ahora se
  muestra un aviso claro ("Este producto ya no está disponible") y se le
  dice a los buscadores que no indexen esa combinación puntual de enlace.
  Un producto agotado (que sigue existiendo, solo sin stock) no se ve
  afectado por este cambio — sigue mostrándose e indexándose normal.
- 3 páginas de guías (`cuidados.html`, `envios.html`, `devoluciones.html`)
  no tenían la etiqueta de "página preferida" (canonical) que sí tienen
  las otras 5 guías del sitio — se agregó, siguiendo el mismo formato.
- De paso, se simplificaron los enlaces internos que apuntaban a
  "index.html#personalize" para que usen directamente "#personalize" —
  mismo destino, URL más corta.

---

## 2026-09-19 — Auditoría SEO: cada producto y categoría tiene su propia página real

Una auditoría SEO externa encontró que la tienda nunca podía tener título,
descripción ni la etiqueta de "página preferida" (canonical) correctos
para una ficha o categoría puntual — todo dependía de que el navegador
ejecutara JavaScript primero, así que Google veía siempre la versión
genérica de la tienda al principio. Ahora cada uno de los ~77 productos y
las 9 categorías tiene una página propia (en español e inglés) que ya
trae esa información correcta desde el primer momento, sin depender de
nada más. Los enlaces viejos (`?p=`/`?cat=`) siguen funcionando exactamente
igual que antes — nadie pierde un marcador guardado ni un enlace
compartido.

De paso, se corrigieron 3 cosas más que encontró la misma auditoría:

- El precio que Google veía en los datos de producto podía no coincidir
  con el precio real que se le cobra a la clienta cuando un producto tiene
  el recargo de tarjeta activado — ya se corrigió para que siempre
  coincida.
- Las tarjetas de producto de la tienda ahora son enlaces reales (antes
  eran clics de JavaScript sin ningún enlace de por medio) — se puede
  abrir un producto en una pestaña nueva, compartir el enlace, o navegar
  con el teclado como cualquier otro enlace del sitio.
- El aviso del 10% en el celular ocupaba casi toda la pantalla — se
  redujo para que siempre quede algo del contenido visible detrás.

Quedan 2 cosas fuera de esta tanda, anotadas para después: el enlace de
"productos destacados" del home todavía usa el formato de URL viejo (no
rompe nada, solo no aprovecha la mejora), y el aviso del 10% en móvil
podría rediseñarse como un banner más discreto en vez de ocupar la
pantalla completa (decisión de negocio, no un arreglo técnico).

---

## 2026-09-19 (3ra tanda) — el aviso de webhook de Lovers dejó de mentir "OK"

El usuario probó por su cuenta lo ya corregido y encontró un problema real
más: si Firebase estaba caído justo cuando Square avisaba de un pago
confirmado, una cancelación o un cobro fallido, ese aviso se perdía para
siempre — el sistema seguía diciéndole "recibido" a Square (que por eso
nunca reintentaba) aunque en realidad nada se hubiera guardado. Peor
todavía: la notificación push a Tita/Robin sonaba igual, avisando de un
pago o cancelación que en los hechos no quedó registrado en ningún lado.

Ahora el sistema solo confirma "recibido" cuando el guardado salió bien de
verdad — si Firebase falla, avisa que hubo un problema para que Square
reintente automáticamente, y ya no manda notificaciones sobre algo que no
se guardó. También se revisaron 2 afirmaciones más sobre el texto de la
regla de Firebase (un supuesto error de tipeo y un problema de formato) —
ninguna de las 2 resultó ser real, verificado directamente.

De paso, se terminó de blindar la regla de Firebase de Cacusa Lovers:
antes solo bloqueaba campos extra, ahora también exige que nombre,
teléfono, dirección y el resto de los datos tengan el tipo y largo
correctos. Falta desplegar 1 Worker y pegar la regla actualizada.

---

## 2026-09-19 (2da tanda) — 3 hallazgos más tras revisar de nuevo con IA

Misma auditoría externa, segunda pasada sobre lo ya corregido:

- **Sesiones que ya no deberían valer, seguían valiendo**: un token de
  sesión firmado antes del arreglo del login (el hallazgo crítico de la
  primera tanda) podía seguir funcionando hasta por 12 horas más, aunque
  esa cuenta ya no fuera válida. Ahora se revisa también al verificar la
  sesión, no solo al firmarla — cualquier token viejo de una cuenta
  inválida deja de servir de inmediato.
- **La gift card seguía sin cubrir el envío y el impuesto**: el arreglo de
  la primera tanda solo miraba el precio de los productos. Con números
  reales: compra de $100 + $20 de envío/impuesto, pagada con gift card de
  $120 → solo se descontaban $100 del saldo real, dejando $20 sin cobrar.
  Ya se corrigió para que sume también envío e impuesto.
- **La regla nueva de Firebase (Cacusa Lovers) no validaba el correo ni
  bloqueaba campos extra**: se agregó validación de formato de email y se
  restringió la escritura a los campos exactos que manda el formulario
  real de suscripción.

Quedan 2 pasos manuales: desplegar los 2 Workers actualizados
(`cacusa-admin`, `cacusa-lovers-webhook`) y actualizar la regla de
Firebase — ver CLAUDE.md.

---

## 2026-09-19 — Auditoría externa: 8 hallazgos corregidos (login, dinero, checkout)

Se revisó una auditoría de seguridad hecha por otra IA (19 hallazgos) contra
el código real y se corrigieron los 8 más importantes:

- **Crítico**: había una forma de entrar al panel admin sin conocer ninguna
  contraseña real (un detalle técnico de cómo JavaScript maneja objetos,
  explotable con un usuario inventado como `"constructor"`). Cerrado.
- **Dinero real**: una compra pagada 100% (o en parte) con gift card no
  descontaba el saldo correcto — en el peor caso, no descontaba nada. Ya se
  descuenta el monto correcto siempre.
- **Cupones que deberían estar bloqueados** (ya usados, o el regalo mensual
  de un código de referido ya entregado) se seguían aceptando pagando con
  tarjeta, aunque el panel los hubiera marcado como agotados. Ahora Square
  respeta las mismas reglas que el panel.
- **El checkout confirmaba la compra antes de tiempo**: si el sistema
  fallaba justo en ese momento, a la clienta se le decía que ya había
  comprado (y se le quemaba el cupón) sin que el pedido quedara guardado.
  Ahora espera la confirmación real antes de avanzar, y avisa si algo falló
  para poder reintentar.
- **Pagos con tarjeta rechazaban el propio cupón de la clienta** (el 10% de
  bienvenida, el exclusivo de Cacusa Lovers) por un dato que faltaba mandar.
  Corregido.
- **El código de envío gratis de Cacusa Lovers** podía duplicarse según cómo
  la clienta escribiera su número de teléfono, dejando una copia que no se
  podía cancelar. Ahora siempre es el mismo código sin importar el formato.
- **El formulario público de Cacusa Lovers** no impedía, a nivel de la base
  de datos, que alguien se auto-activara como suscriptora sin haber pagado
  nunca (escribiendo directo a Firebase por fuera del sitio). Cerrado con
  una regla nueva en Firebase — pendiente de pegarla en el dashboard.

Quedan 2 pasos manuales: desplegar los 2 Workers actualizados
(`cacusa-admin`, `cacusa-square`) y pegar la regla nueva de Firebase — ver
CLAUDE.md. Los otros 11 hallazgos del reporte quedan documentados (con su
veredicto: reales, exagerados, o ya resueltos) para retomar después.

---

## 2026-09-17 — Verificado: las reseñas nuevas no se pueden auto-aprobar

Último ítem pendiente de seguimiento operativo, cerrado. Se pidieron las
reglas reales de Firebase para confirmar (no suponer) que una reseña nueva
solo puede crearse con el estado "pendiente de aprobación" — y ya era así:
las reglas de la base de datos rechazan cualquier intento de crear una
reseña que llegue marcada como ya aprobada, sin importar por dónde se
mande. No fue necesario ningún cambio, solo se confirmó y se dejó
documentado con evidencia. No queda ningún paso manual pendiente por ahora.

---

## 2026-09-16 — El popup del 10% ya no dice "revisa tu correo" si en realidad falló

Último hallazgo de la revisión del lado cliente. El popup mostraba el
mensaje de éxito apenas se apretaba el botón, sin esperar a confirmar que
el registro realmente había llegado al servidor — si había un corte de
red o el sistema estaba caído en ese momento, a la clienta se le decía que
ya tenía su código de 10% cuando en realidad nunca se mandó nada, y no
había forma de que se diera cuenta ni de volver a intentarlo. Ahora el
popup espera la respuesta real: si funcionó, mismo mensaje de siempre; si
falló, avisa que algo salió mal y deja reintentar en el momento, en vez de
cerrarse solo. Aplicado en las 4 versiones del popup (home y tienda, ES/EN).

## 2026-09-16 — Leads: un solo escaneo por request en vez de hasta 3

Revisión de confiabilidad sobre el refactor de leads de más arriba. El
sistema nuevo era correcto, pero cada registro del popup del 10% podía
disparar hasta 3 escaneos completos de todos los leads guardados (uno al
guardar, otro al mandar el correo, otro al revisar carritos abandonados),
cada uno reescribiendo la misma caché. Con la cantidad de leads de hoy no
pasaba nada, pero era trabajo de más sin necesidad, y a futuro se acercaba
antes de lo esperado a un límite técnico de Cloudflare. Ahora es un solo
escaneo por registro — mismo comportamiento visible, menos trabajo real
detrás.

## 2026-09-16 — Barrido de seguridad: correo blindado y envío gratis atado a su dueña

Revisión de seguridad sobre todo lo construido hoy. Salieron dos cosas
serias, las dos ya corregidas:

**El correo automático se podía usar para mandar correo ajeno.** El sistema
armaba el mensaje pegando la dirección tal cual la escribía la persona en el
popup del 10%. Alguien podía escribir ahí algo preparado y hacer que el
correo saliera *desde la cuenta real del negocio*
(`facturacioncacusa@gmail.com`) hacia terceros — phishing usando la marca, y
riesgo de que Gmail terminara bloqueando o suspendiendo la cuenta. Se
confirmó con una prueba real antes de arreglarlo. Ahora toda dirección pasa
por una validación de verdad, y además hay una segunda barrera justo antes
de enviar, para que ninguna función futura se salte el control por olvido.

**El código de envío gratis de Cacusa Lovers servía para cualquiera, para
siempre.** No estaba atado a la suscriptora que lo pedía, no vencía, y nunca
se apagaba al cancelar (estaba anotado como "se desactiva desde el panel",
pero eso no existía). Compartirlo una vez era regalarlo de por vida. Ahora
queda atado al teléfono de quien lo pidió —funcionando igual si escribe su
número con o sin código de país— y se apaga solo cuando cancela, junto con
el cupón del 5%. Si vuelve a suscribirse y lo pide de nuevo, se reactiva.
Los códigos entregados antes de este cambio quedan atados la próxima vez que
su dueña los pida.

## 2026-09-16 — Fix: los leads (10% + carritos abandonados) ya no comparten un blob único

Una auditoría del sistema de notificaciones push encontró una condición de
carrera real en cómo se guardaban los leads (registros del popup del 10% y
de carritos abandonados): todos vivían en un solo bloque de datos, así que
dos clientas distintas actuando al mismo tiempo (una completando su carrito
mientras a otra se le marcaba un aviso de abandono) podían pisarse el
cambio una a la otra en silencio. Ahora cada lead vive en su propio
registro independiente — mismo esquema que ya usan los pedidos desde
antes — así que dos leads distintos nunca compiten por la misma escritura.
El respaldo diario a R2 también se actualizó para seguir cubriendo los
leads con el nuevo esquema. Sin cambios visibles para Tita/Robin en el
panel — mismo comportamiento, guardado de forma más segura por dentro.

## 2026-09-16 — Fix: el correo del cupón exclusivo de Lovers ya no adivina el idioma por país

El correo del 5% (ver entrada de abajo) elegía español o inglés según el
país de envío de la suscriptora — fallaba para cualquiera que vive en un
país distinto al de su idioma real (ej. alguien en Estados Unidos que se
suscribió desde la versión en español del sitio). Ahora
`cacusa-lovers.html`/`en/cacusa-lovers.html` guardan el idioma real de la
página donde se suscribió, y el correo usa ese dato en vez de adivinar.
Para suscriptoras de antes de este cambio (que no tienen ese dato guardado),
sigue cayendo al heurístico por país como antes — no se pierde nada, solo
deja de ser la única fuente para las suscriptoras nuevas.

## 2026-09-16 — Rediseño visual de los correos automáticos (10% y cupón exclusivo)

Los dos correos automáticos (código de bienvenida del 10% y cupón
exclusivo de Lovers) salían en texto plano, sin ningún parecido con la
marca. Ahora usan una plantilla HTML compartida con los colores y
tipografía de CACUSA, pensada para verse bien en Gmail/Outlook/Apple Mail.

## 2026-09-16 — Cupón exclusivo de Cacusa Lovers: 5% real en toda compra

Los planes de Cacusa Lovers prometían "Cupones de descuento exclusivos"
desde hace tiempo, pero no había nada real detrás. Ahora cada suscriptora
activa recibe por correo un código de **5% de descuento, sin límite de
usos, válido mientras siga activa** — se activa solo al confirmarse el
primer pago y se desactiva sola si cancela, sin que nadie del equipo
tenga que acordarse. Para las que ya estaban activas antes de esto, hay
un botón en el panel (pestaña Cacusa Lovers) para mandárselo ya mismo.

De paso se corrigió un bug real que ya existía: el sistema bloqueaba por
error a cualquier suscriptora que intentara usar su código de **envío
gratis** más de una vez — se rompía en silencio desde la segunda compra.
Ya no le pasa a ningún cupón pensado para reusarse.

## 2026-09-16 — Fix: pagos con tarjeta no revisaban a quién pertenecía el código 10%

`square-payment-worker.js` (pagos con tarjeta/Apple Pay/Google Pay vía
Square) tiene su propia copia de la validación de cupones, separada de
`admin-worker.js` — al agregar la restricción por email del código de
bienvenida (ver entrada de abajo), esta copia quedó sin actualizar: se
podía pagar con tarjeta usando el código de bienvenida de otra clienta y
el 10% se aplicaba igual, aunque pagar por Zelle/WhatsApp ya lo hubiera
bloqueado. Corregido el mismo día — ahora revisa el email en los dos
lugares.

## 2026-09-16 — Código de bienvenida del 10% de verdad, por correo

El popup del 10% ("quiero mi descuento") solo abría WhatsApp — el
descuento lo daba alguien del equipo a mano, coordinando por chat, sin
ningún cupón real detrás. Ahora se manda un correo automático desde
`facturacioncacusa@gmail.com` (vía Gmail API) con un código real:

- Un solo uso, vence a los 3 meses, y solo lo puede usar el email que se
  registró (aunque alguien más lo conociera, el checkout lo rechaza).
- Automático para quien se registra de ahora en adelante. Para los ~70
  leads que ya estaban guardados antes de esto, nuevo botón "Enviar
  código" en el panel (pestaña Leads).
- Un carrito abandonado nunca dispara este correo — son flujos separados.

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

## 2026-09-14 — La causa real: Cloudflare bloqueaba la llamada entre Workers

Después de los dos arreglos de más abajo, el usuario probó de nuevo con logs
en vivo de Cloudflare abiertos y apareció la causa de fondo real:
`claim-pending respondió 404 error code: 1042`. Ese código no es un bug de
la lógica de este repo — es una restricción propia de la plataforma:
**Cloudflare bloquea que un Worker le haga `fetch()` a otro Worker de la
misma cuenta usando su URL pública `*.workers.dev`** (antiabuso, para evitar
loops entre Workers gratuitos). Como `cacusa-admin` y `cacusa-lovers-webhook`
se llamaban entre sí con `fetch()` directo, esa llamada nunca pudo funcionar
— ninguno de los dos arreglos anteriores (el de ayer ni el de más abajo)
podía tener efecto mientras siguiera siendo un `fetch()` plano.

- **Ya estaba resuelto una vez, en otro Worker, y nunca se replicó**:
  `square-payment-worker.js` ya tenía, desde antes, exactamente este mismo
  problema documentado y resuelto con un *Service Binding* (una forma de
  Worker-a-Worker que Cloudflare sí permite, sin pasar por la restricción).
  Ese arreglo nunca se copió a los otros 3 Workers.
- Se replicó el mismo patrón en `admin-worker.js`, `lovers-webhook-worker.js`
  y `backup-worker.js`. Requiere agregar 3 Service Bindings nuevos a mano en
  el dashboard de Cloudflare (Settings → Bindings de cada Worker) — sin eso,
  el código sigue cayendo al `fetch()` que dispara el error.
- Se verificó primero (con una captura del dashboard) que el Service Binding
  de `cacusa-square` → `cacusa-admin` sí estaba configurado — los pedidos
  pagados con tarjeta nunca estuvieron en riesgo, este problema afectaba
  solo a las llamadas relacionadas con Cacusa Lovers.
- Esto también explica por qué el programa de referidos
  (`/referral/code`) y el código de envío gratis para suscriptoras
  (`/lovers/shipping-code`) probablemente nunca funcionaron — ambos
  dependen de la misma llamada bloqueada.

## 2026-09-14 — El aviso de suscripción pendiente, en el momento real

Después del arreglo de más abajo entró otra suscripción pendiente (Mery
Allauca) y tampoco sonó. Revisando el flujo completo apareció una causa más
de fondo que ningún arreglo del lado de los webhooks podía cubrir:

- **El formulario de la página de Cacusa Lovers nunca hablaba con el
  servidor.** Guardaba la suscriptora directo en la base de datos desde el
  navegador y mandaba a la clienta a pagar a Square. El único código capaz
  de mandar una notificación vivía en el Worker que escucha a Square, y ese
  solo corre cuando la clienta **completa el pago**.
- Consecuencia: si alguien llenaba el formulario y abandonaba el pago, el
  registro quedaba "pendiente" para siempre y **nadie se enteraba jamás** —
  no había ninguna notificación posible. Se confirmó revisando el registro
  de Mery: no tiene Subscription ID, o sea que Square nunca llegó a crear la
  suscripción.
- **Ahora el aviso se dispara al enviar el formulario**, que es el momento
  real en que ocurre. El servidor verifica contra la base de datos que la
  suscripción exista de verdad antes de avisar (nadie puede hacer sonar
  notificaciones falsas), arma el texto él mismo, y marca la suscriptora
  para no volver a avisar por la misma persona aunque recargue la página o
  reintente el pago.
- Resultado por clienta: un aviso al llenar el formulario y otro al
  confirmarse el pago. Si abandona el pago, queda el primero — que es
  justamente el que servía para hacer seguimiento por WhatsApp.

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
