/**
 * Cacusa Lovers — Square Webhook Worker
 * Deploy to Cloudflare Workers as: cacusa-lovers-webhook.facturacioncacusa.workers.dev
 *
 * Environment variables (Secrets in CF Dashboard):
 *   SQUARE_WEBHOOK_SIGNATURE_KEY  — from Square Dashboard → Webhooks → signature key
 *   SQUARE_ACCESS_TOKEN           — Square API access token (from Square Developer Dashboard)
 *   FB_DB_SECRET                  — Firebase Realtime Database secret (Firebase Console →
 *                                   Configuración del proyecto → Cuentas de servicio →
 *                                   Secretos de la base de datos). Da acceso total a la base
 *                                   de datos, ignorando las reglas de seguridad — por eso vive
 *                                   SOLO acá como secret de Cloudflare, nunca en el frontend.
 *   FB_DB_URL                     — https://cacusa-pos-default-rtdb.firebaseio.com
 *   SESSION_SECRET                — MISMO valor que el secret SESSION_SECRET del Worker
 *                                   cacusa-admin. Las rutas /admin/* de este worker validan el
 *                                   token de sesión que emite el login de cacusa-admin (HMAC +
 *                                   expiración) en vez de una clave fija — así el panel admin
 *                                   ya no necesita ningún secreto embebido en el HTML público
 *                                   para administrar suscriptoras o borrar reseñas.
 *   ORDER_INGEST_KEY              — MISMO valor que el secret ORDER_INGEST_KEY del Worker
 *                                   cacusa-admin. Se usa para avisarle a cacusa-admin (vía
 *                                   POST /push/notify) que nació una suscriptora nueva, para
 *                                   que mande la notificación push a los celulares de Tita y
 *                                   Robin — sin este secret, la notificación simplemente no
 *                                   se envía (el resto del webhook sigue funcionando igual).
 *                                   También autentica la dirección contraria: cacusa-admin
 *                                   llama a GET /internal/lovers/active con este mismo header
 *                                   para saber si un teléfono es de una suscriptora activa
 *                                   antes de emitir un código de referido — sin este secret,
 *                                   esa ruta rechaza la llamada y el programa de referidos
 *                                   no puede emitir códigos.
 *
 * Square events subscribed (in Square Dashboard → Webhooks):
 *   subscription.created            → crea registro en Firebase cuando nace la suscripción
 *   invoice.payment_made            → marca suscriptora como "activo" (suscripción vieja de
 *                                     Square O factura de Lovers — ver "Cobro por factura")
 *   invoice.scheduled_charge_failed → marca suscriptora como "pago_fallido"
 *   subscription.updated            → si status=CANCELED, marca "cancelado"
 *
 * Rutas:
 *   POST   /internal/lovers/marketing-list → Worker-a-Worker (X-Order-Ingest-Key): email,
 *                                          idioma y estado de cada suscriptora, para la
 *                                          pestaña Marketing de cacusa-admin
 *   GET    /internal/lovers/active      → Worker-a-Worker (X-Order-Ingest-Key), usado por
 *                                          cacusa-admin para saber si un teléfono es de una
 *                                          suscriptora activa antes de emitir un código de
 *                                          referido
 *   POST   /webhook                    → recibe webhooks de Square (firmados)
 *   POST   /admin/cancel-subscription  → cancela una suscripción en Square
 *   GET    /admin/lovers                → lista suscriptoras + fotos destacadas
 *   POST   /admin/lovers                → alta manual de una suscriptora (pago por
 *                                          transferencia, sin suscripción real en Square)
 *   PATCH  /admin/lovers/{id}           → actualiza campos de una suscriptora
 *   DELETE /admin/lovers/{id}           → elimina una suscriptora
 *   PUT    /admin/lovers-photos         → guarda las fotos destacadas de la página pública
 *   DELETE /admin/reviews/{productId}/{reviewId} → elimina una reseña de producto
 *   POST   /admin/reviews/{productId}/{reviewId}/approve → publica una reseña pendiente
 *   Todas las rutas /admin/* se autentican con el header X-Admin-Key, que lleva el token de
 *   sesión del panel admin (no la firma de Square, y ya no una clave fija).
 *
 * Cobro por factura (2 oct — Apple Pay):
 *   Square no acepta Apple Pay en Square Subscriptions (solo tarjeta guardada). Las altas
 *   NUEVAS ya no usan los links fijos de suscripción: cada ciclo es una FACTURA de Square
 *   (su página de pago sí ofrece Apple Pay/Google Pay/tarjeta). Primer pago: AW
 *   /lovers/register → POST /internal/lovers/start-invoice (acá) → factura SHARE_MANUALLY
 *   y la página redirige a su public_url. Renovaciones: el cron diario (scheduled(),
 *   runLoversBilling) manda por EMAIL la factura del ciclo siguiente 3 días antes de
 *   `vence`; a los 7 días de `vence` sin pagar → estado_pago 'vencido' (cupones apagados,
 *   push a Tita/Robin, correo "se pausó"); si paga después, invoice.payment_made reactiva.
 *   Registro con modo_cobro:'factura'. Las suscriptoras viejas (Square Subscriptions,
 *   square_subscription_id) siguen exactamente como antes. Requiere el Cron Trigger en
 *   Cloudflare (Settings → Triggers → Cron, ej. 0 14 * * *) y opcionalmente el secret
 *   SQUARE_LOCATION_ID (si falta, se usa la ubicación principal de la cuenta).
 *   Rutas nuevas: POST /internal/lovers/start-invoice (Worker-a-Worker),
 *   POST /admin/cancel-lovers-invoice, POST /admin/lovers-billing-run (corre el cron a mano).
 *
 * Por qué existe este worker en el medio (en vez de que el admin hable directo con Firebase):
 *   Las reglas de Firebase para cacusa_lovers / cacusa_lovers_photos / cacusa_reviews solo
 *   permiten CREAR un registro nuevo con auth anónimo (lo que necesitan el formulario público
 *   de suscripción y el formulario público de reseñas) — leer/editar/borrar un registro
 *   existente requiere el FB_DB_SECRET, que nunca se expone al navegador. El admin panel pasa
 *   esas acciones por acá.
 *
 * Setup:
 *   1. Deploy this worker (pegar en Cloudflare Dashboard → Edit code → Save and deploy)
 *   2. Set the secrets above (5, incluyendo ORDER_INGEST_KEY)
 *   3. Square Dashboard → Developers → Webhooks → Add endpoint
 *      URL: https://cacusa-lovers-webhook.facturacioncacusa.workers.dev/webhook
 *      Events: subscription.created, invoice.payment_made, invoice.scheduled_charge_failed, subscription.updated
 *   4. Copy the "Signature key" from the webhook detail page → set as SQUARE_WEBHOOK_SIGNATURE_KEY
 */

const SQUARE_API = 'https://connect.squareup.com/v2';
// El primero es el valor por defecto de ADMIN_CORS; withAdminOrigin() refleja el que corresponda.
// Auditoría (12 oct): la tienda (cacusabytaitus.com, carga GTM) ya no es un origen del
// panel desde que se mudó a su subdominio (26 sep) — se quita para que un script de
// terceros en la tienda no pueda llamar /admin/* aunque consiguiera un token.
const ADMIN_ORIGINS = ['https://admin.cacusabytaitus.com'];
const ADMIN_PANEL_URL = 'https://admin.cacusabytaitus.com/';
const ADMIN_WORKER_URL = 'https://cacusa-admin.facturacioncacusa.workers.dev';

// ── Presupuesto de llamadas externas de la tarea diaria (12 oct, auditoría) ─────
// En el plan gratis de Cloudflare cada ejecución tiene ~50 llamadas externas; pasado el
// tope, fetch() lanza "Too many subrequests" y un paso puede quedar a medias (ej. marcar
// beneficios_off sin llegar a apagar el cupón). Mientras corre scheduled(), este fetch()
// (sombrea al global dentro de este módulo) y adminFetch() cuentan cada llamada; cada
// fase deja margen para las siguientes y lo que no entra hoy se hace mañana (todo es
// idempotente). Fuera de la tarea diaria no limita nada.
const CRON_SUBREQ_MAX = 45;
let cronSubreq = null; // { n } solo mientras corre scheduled()
function fetch(input, init) {
  if (cronSubreq) cronSubreq.n++;
  return globalThis.fetch(input, init);
}
function cronBudget(need, reserve = 0) {
  return !cronSubreq || cronSubreq.n + need + reserve <= CRON_SUBREQ_MAX;
}
// Mismo presupuesto para los botones del panel (Sincronizar, Crear pedidos del lote,
// facturación a mano): cada request también tiene ~50 llamadas en el plan gratis. Lo
// que no entra queda en `pendientes` y se completa volviendo a tocar el botón.
async function withBudget(fn) {
  const prev = cronSubreq;
  cronSubreq = { n: 0 };
  try { return await fn(); } finally { cronSubreq = prev; }
}
// Mismos usuarios válidos que admin-worker.js (duplicado a propósito — no hay módulos
// compartidos entre Workers). verifyToken() los usa para revalidar el token de sesión,
// no solo su firma — ver el comentario en verifyToken() más abajo.
const VALID_USERS = new Set(['tita.jaramillo', 'robin.gonzalez']);

// Cloudflare bloquea que un Worker le haga fetch() a otro Worker de la misma cuenta usando
// su URL *.workers.dev (error 1042, "This request could not be routed"). El Service Binding
// ADMIN_WORKER (Cloudflare → cacusa-lovers-webhook → Settings → Bindings → Add → Service
// binding → apunta a cacusa-admin) enruta la llamada directo entre Workers sin pasar por ese
// límite. Si el binding todavía no está configurado, cae de vuelta al fetch() normal — que
// es justamente el que dispara el 1042, así que hasta configurarlo estas llamadas siguen
// fallando. Mismo patrón que adminFetch() en square-payment-worker.js.
function adminFetch(env, path, options) {
  const url = `${ADMIN_WORKER_URL}${path}`;
  if (!env.ADMIN_WORKER) return fetch(url, options);
  if (cronSubreq) cronSubreq.n++;
  return env.ADMIN_WORKER.fetch(url, options);
}

// ── Avisa a cacusa-admin para que mande la notificación push (best-effort — nunca
// bloquea ni rompe el procesamiento del webhook de Square si falla) ──────────────
// tag='cacusa-lovers' agrupa todos los eventos de Lovers bajo un mismo tipo (pero
// distinto del de pedidos) para que no se tapen entre sí en el centro de
// notificaciones; urgency='high' en pago fallido para que el dispositivo lo
// despierte más agresivo que un simple "se unió al club".
async function notifyAdminPush(title, body, env, { urgency = 'normal' } = {}) {
  if (!env.ORDER_INGEST_KEY) {
    console.error('notifyAdminPush: ORDER_INGEST_KEY no está configurado en este Worker — la notificación no se envía. Revisar Cloudflare → cacusa-lovers-webhook → Settings → Variables.');
    return;
  }
  try {
    const r = await adminFetch(env, '/push/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ title, body, url: ADMIN_PANEL_URL, tag: 'cacusa-lovers', urgency }),
    });
    if (!r.ok) console.error('push/notify failed:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('push/notify error:', e.message);
  }
}

// ── Crea el "pedido de envío" del ciclo en cacusa-admin (nuevo, 20 sep) ────────────
// Antes de esto no quedaba ningún registro de "qué se le envía a quién este mes" —
// solo se actualizaba el estado de la suscriptora en Firebase. Mismo patrón
// best-effort que notifyAdminPush()/notifyExclusiveCoupon(): si esto falla (ej. el
// Service Binding hacia cacusa-admin cae), NUNCA rompe el procesamiento del webhook
// de Square — en el peor caso, Tita/Robin arman ese envío puntual a mano como
// siempre, sin generación automática de guía para ese ciclo. squareInvoiceId es la
// clave de idempotencia real del lado de cacusa-admin (nunca crea 2 pedidos para el
// mismo cobro, ni siquiera si Square reintenta la entrega del webhook).
// direccionFields lleva además email/idioma (12 oct): sin email el pedido del lote nunca
// mandaba el correo con el número de guía al generar la guía USPS.
async function notifyLoversShipment(direccionFields, plan, squareInvoiceId, env, loteKey) {
  if (!env.ORDER_INGEST_KEY) return null;
  try {
    const r = await adminFetch(env, '/order/lovers-shipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ ...direccionFields, plan, squareInvoiceId, ...(loteKey ? { loteKey } : {}) }),
    });
    if (!r.ok) { console.error('order/lovers-shipment failed:', r.status, await r.text().catch(() => '')); return null; }
    return await r.json().catch(() => ({}));
  } catch (e) {
    console.error('order/lovers-shipment error:', e.message);
    return null;
  }
}

// ── Activa/desactiva el cupón exclusivo del 5% de Lovers en cacusa-admin ───────────
// Mismo patrón best-effort que notifyAdminPush() — nunca bloquea ni rompe el
// procesamiento del webhook de Square si falla. langOrPais acepta 2 formas:
// 'es'/'en' directo (viene de existing.idioma, el idioma real de la página donde
// se suscribió — ver cacusa-lovers.html/en/cacusa-lovers.html) o, si no hay ese
// dato (suscriptora de antes de este campo, o alta manual desde el admin sin
// idioma capturado), un nombre de país como aproximación (Ecuador → es, cualquier
// otro → en).
// Devuelve true si cacusa-admin confirmó (12 oct): la tarea diaria solo marca un paso
// como hecho (beneficios_off, vencido) si el cupón de verdad se apagó.
async function notifyExclusiveCoupon(action, email, langOrPais, env, phone) {
  if (!env.ORDER_INGEST_KEY || !email) return false;
  const lang = langOrPais === 'es' || langOrPais === 'en'
    ? langOrPais
    : (langOrPais === 'Ecuador' ? 'es' : 'en');
  try {
    // El teléfono solo se usa al desactivar: cancelar apaga los DOS beneficios, el
    // 5% (que se ubica por email) y el envío gratis (que se ubica por teléfono).
    const r = await adminFetch(env, '/internal/lovers/exclusive-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ action, email, lang, phone: phone || '' }),
    });
    if (!r.ok) console.error('exclusive-coupon failed:', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('exclusive-coupon error:', e.message);
    return false;
  }
}

// ── Correo de bienvenida/confirmación de suscripción (22 sep) — SOLO en la
// transición hacia estado_pago:'activo' (ver wasActive, calculado en
// invoice.payment_made antes de llamar a updateSubscriber con el valor NUEVO), nunca
// en una renovación normal. Mismo patrón Worker-a-Worker best-effort que
// notifyExclusiveCoupon()/notifyLoversShipment() — nunca bloquea ni rompe el
// procesamiento del webhook de Square si falla.
async function notifySubscriptionEmail(email, fields, env) {
  if (!env.ORDER_INGEST_KEY || !email) return;
  try {
    const r = await adminFetch(env, '/internal/lovers/subscription-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ email, ...fields }),
    });
    if (!r.ok) console.error('subscription-email failed:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('subscription-email error:', e.message);
  }
}
const ADMIN_CORS = {
  'Access-Control-Allow-Origin': ADMIN_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
function adminJson(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...ADMIN_CORS, ...(extraHeaders || {}) },
  });
}

// ── Verify Square webhook signature ──────────────────────────────────────────
async function verifySignature(request, body, sigKey) {
  const sigHeader = request.headers.get('x-square-hmacsha256-signature');
  if (!sigHeader || !sigKey) return false;
  const url = new URL(request.url).href;
  const payload = url + body;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sigKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return safeEqual(expected, sigHeader);
}

// ── Key determinística por email ──────────────────────────────────────────────
// Antes, cada alta (formulario público + subscription.created + invoice.payment_made
// + alta manual del admin) buscaba "¿ya existe alguien con este email?" vía una
// query indexada y, si no encontraba nada, creaba un registro nuevo con ID
// aleatorio. Esa búsqueda-y-decide tiene una ventana de carrera real: si dos de
// esos 4 caminos corren cerca uno del otro (típico — Square puede mandar
// subscription.created e invoice.payment_made casi al mismo tiempo), ambos
// pueden creer "no existe" y crear su propio registro — resultado: 2 o 3 copias
// de la misma suscriptora, como pasó con Elizabeth Galarza el 10 de septiembre.
//
// La key ahora se calcula siempre igual, directo del email, en los 4 caminos —
// así todos apuntan al MISMO nodo de Firebase sin necesidad de preguntar nada
// antes. Aunque dos lleguen "al mismo tiempo", como escriben a la misma key,
// Firebase los fusiona (PATCH) en un solo registro — nunca puede haber 2.
// Firebase no permite '.', '#', '$', '[', ']', '/' en una key, por eso se
// reemplazan por ','.
function subscriberKey(email) {
  return String(email || '').replace(/\s+/g, '').toLowerCase().replace(/[.#$[\]/]/g, ',');
}

// Dos fichas con el mismo nombre son personas distintas si tienen suscripciones de
// Square distintas o teléfonos distintos (últimos 7 dígitos).
function dedupeConflict(a, b) {
  if (a.square_subscription_id && b.square_subscription_id && a.square_subscription_id !== b.square_subscription_id) return true;
  const ta = String(a.telefono || '').replace(/\D/g, '').slice(-7);
  const tb = String(b.telefono || '').replace(/\D/g, '').slice(-7);
  return ta.length === 7 && tb.length === 7 && ta !== tb;
}

// ── Ubicar a la suscriptora de un evento de Square (11 oct) ──────────────────
// Bug real: cada renovación creaba una suscriptora DUPLICADA cuando el email que trae
// Square (factura o cliente) no daba exactamente la misma key que el del formulario
// (otro correo, un punto de más, espacios) — la búsqueda era solo por email, así que
// caía en "Subscriber not in Firebase yet" y creaba otro registro 'activo'. Ahora se
// busca primero por los IDs de Square ya guardados (square_subscription_id, después
// square_customer_id) y recién si no aparecen se usa el email. Una lectura de toda
// cacusa_lovers por evento — la lista es chica (decenas) y se hace igual en otras rutas.
// 12 oct: si el email de Square tampoco coincide con ninguna ficha, se busca además por
// teléfono (últimos 7 dígitos) + primer nombre del cliente de Square — solo si hay UNA
// ficha no cancelada que coincida (2 personas de la misma familia pueden compartir
// teléfono: en ese caso no se adivina). Así una renovación con otro correo ya no crea
// una ficha duplicada (caso real: Lilia Alvarez).
const primerNombre = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/)[0] || '';
async function resolveSubscriber(dbUrl, fbAuth, { email, subscriptionId, customerId, phone, nombre }) {
  let all = null;
  const loadAll = async () => {
    if (all) return all;
    const r = await fetch(`${dbUrl}/cacusa_lovers.json?auth=${fbAuth}`);
    if (!r.ok) throw new Error(`Firebase GET falló (${r.status}) para cacusa_lovers`);
    all = (await r.json()) || {};
    return all;
  };
  if (subscriptionId || customerId) {
    const entries = Object.entries(await loadAll()).filter(([, v]) => v && typeof v === 'object');
    // Si varias coinciden (duplicados viejos), se prefiere la más antigua: es la original.
    const oldest = list => list.sort((a, b) => String(a[1].fecha || '').localeCompare(String(b[1].fecha || '')))[0];
    if (subscriptionId) {
      const m = entries.filter(([, v]) => v.square_subscription_id === subscriptionId);
      if (m.length) { const [key, existing] = oldest(m); return { key, existing }; }
    }
    if (customerId) {
      const m = entries.filter(([, v]) => v.square_customer_id === customerId);
      if (m.length) { const [key, existing] = oldest(m); return { key, existing }; }
    }
  }
  if (!email) return { key: null, existing: null };
  const key = subscriberKey(email);
  const existing = await getSubscriberByKey(key, dbUrl, fbAuth);
  // Fichas de antes del 12 sep: el formulario las guardaba con un identificador ALEATORIO
  // de Firebase, no en la llave del correo — buscarlas solo por la llave no las encuentra
  // y el pago creaba otra ficha (caso real: Lilia Fernanda Álvarez, mismo correo en las
  // 2). Se busca también por el email guardado en cada ficha.
  if (!existing) {
    const mismoCorreo = Object.entries(await loadAll()).filter(([k, v]) => v && typeof v === 'object' && validId(k, true)
      && subscriberKey(v.email) === key);
    if (mismoCorreo.length) {
      const rank = v => (v.estado_pago === 'cancelado' ? 2 : 0) + (String(v.telefono || '').replace(/\D/g, '').length >= 7 ? 0 : 1);
      mismoCorreo.sort((a, b) => rank(a[1]) - rank(b[1]) || String(a[1].fecha || '').localeCompare(String(b[1].fecha || '')));
      return { key: mismoCorreo[0][0], existing: mismoCorreo[0][1] };
    }
  }
  const tel = String(phone || '').replace(/\D/g, '').slice(-7);
  const nom = primerNombre(nombre);
  if (!existing && tel.length === 7 && nom) {
    const m = Object.entries(await loadAll()).filter(([k, v]) => v && typeof v === 'object' && validId(k, true)
      && v.estado_pago !== 'cancelado'
      && String(v.telefono || '').replace(/\D/g, '').slice(-7) === tel
      && primerNombre(v.nombre) === nom);
    if (m.length === 1) return { key: m[0][0], existing: m[0][1] };
  }
  return { key, existing };
}

// ── Lee un registro por su key determinística — lookup directo por ID, no una
// query indexada (más confiable, no depende de que Firebase tenga .indexOn) ──
async function getSubscriberByKey(key, dbUrl, fbAuth) {
  const r = await fetch(`${dbUrl}/cacusa_lovers/${key}.json?auth=${fbAuth}`);
  if (!r.ok) {
    // Auditoría externa (19 sep, ronda nueva): antes esto devolvía null igual que
    // "esa key no existe" — un 401/500 real de Firebase (ej. FB_DB_SECRET mal
    // configurado, o Firebase caído) quedaba indistinguible de una suscriptora que
    // genuinamente no existe. En invoice.payment_failed/scheduled_charge_failed y en
    // subscription.updated (cancelación), eso hacía que un error real de Firebase
    // cayera en la rama "no matching subscriber" sin escribir nada, y el webhook
    // respondía 200 igual (dbOk nunca se tocaba) — Square nunca reintenta un 200, así
    // que el pago fallido o la cancelación se perdían para siempre. Ahora se lanza una
    // excepción real para que el catch general del webhook (ver 'dbOk = false' más
    // abajo) SÍ la trate como una falla y fuerce el reintento de Square.
    console.error(`Firebase GET falló (${r.status}) para cacusa_lovers/${key}`);
    throw new Error(`Firebase GET falló (${r.status}) para cacusa_lovers/${key}`);
  }
  return await r.json(); // null si esa key no existe todavía
}

// ── Mezcla (PATCH) campos en el registro de esa key. Si la key no existe
// todavía, Firebase la crea con exactamente esos campos — llamarlo 2+ veces
// con los mismos datos nunca duplica nada, solo actualiza el mismo nodo.
// estadoPago=null deja el estado_pago como está (no lo toca).
async function updateSubscriber(key, estadoPago, extras, dbUrl, fbAuth) {
  const url = `${dbUrl}/cacusa_lovers/${key}.json?auth=${fbAuth}`;
  const body = { ...extras };
  if (estadoPago != null) body.estado_pago = estadoPago;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => r.status);
    console.error(`Firebase PATCH failed (${r.status}):`, errText);
  }
  return r.ok;
}

// ── Get customer from Square ──────────────────────────────────────────────────
// Auditoría de integridad (19 sep, F09): antes esto devolvía null tanto si el cliente
// genuinamente no existía como si la API de Square respondió un error real (503, etc.)
// — el llamador (ej. subscription.updated CANCELED) trataba ambos casos igual, y un
// error transitorio de Square terminaba respondiendo 200 sin haber tocado Firebase.
// Mismo patrón que ya se usó para getSubscriberByKey(): 404 real = no existe (null);
// cualquier otro !ok = lanza, para que el catch general del handler responda 500.
async function getSquareCustomer(customerId, squareToken) {
  if (!customerId) return null;
  const r = await fetch(`${SQUARE_API}/customers/${customerId}`, {
    headers: { 'Authorization': `Bearer ${squareToken}`, 'Square-Version': '2024-11-20' }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Square Customers API respondió ${r.status} al recuperar ${customerId}`);
  const d = await r.json();
  return d.customer || null;
}

async function getSquareCustomerEmail(customerId, squareToken) {
  const c = await getSquareCustomer(customerId, squareToken);
  return c?.email_address || null;
}

// ── Cancel a subscription in Square (llamado desde el admin panel) ───────────
async function cancelSquareSubscription(subscriptionId, squareToken) {
  const r = await fetch(`${SQUARE_API}/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${squareToken}`, 'Square-Version': '2024-11-20' },
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: d };
}

// ── Cobro por factura (2 oct) ─────────────────────────────────────────────────
// Ver el bloque "Cobro por factura" del encabezado. Montos en centavos — mismos precios
// que muestra la página (config.lovers en data/products.json); si cambian allá, cambiar acá.
const LOVERS_PRICES_CENTS = { mensual: 1999, anual: 21989 };
const LOVERS_MONTO_TXT = { mensual: '$19.99/mes', anual: '$219.89/año' };
const LOVERS_INVOICE_LEAD_DAYS = 3;  // la factura de renovación sale 3 días antes de `vence`
const LOVERS_GRACE_DAYS = 7;         // a los 7 días de `vence` sin pagar → 'vencido'
const SQUARE_VERSION = '2024-11-20';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// +1 mes (31 ene → 28/29 feb, nunca salta a marzo) o +1 año.
function addPeriodIso(iso, periodo) {
  const d = new Date(iso + 'T00:00:00Z');
  if (periodo === 'anual') {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }
  const day = d.getUTCDate();
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}
function planPeriodo(plan) { return /anual|annual/i.test(String(plan || '')) ? 'anual' : 'mensual'; }
// ¿Una suscripción 'activo' tiene el pago al día? (12 oct, caso Rachely: "Activa" en el
// panel sin ningún pago registrado — el estado guardado no lo decía). Misma regla que el
// panel (pagoAlDia en cacusa-admin). No cambia el estado: lo marca para revisar.
//  - manual: hasta `vence`;  - factura: hasta `vence` + 7 días de gracia;
//  - Square: último pago en los últimos 35 días (370 si es anual).
function pagoAlDia(s, today = todayIso()) {
  if (!s || s.estado_pago !== 'activo') return { ok: true };
  const vence = ISO_DATE_RE.test(s.vence || '') ? s.vence : '';
  if (s.metodo_pago === 'manual') {
    if (!vence) return { ok: false, motivo: 'pago manual sin fecha de vencimiento' };
    return vence >= today ? { ok: true } : { ok: false, motivo: `pago manual venció el ${vence}` };
  }
  if (s.modo_cobro === 'factura' && vence) {
    return addDaysIso(vence, LOVERS_GRACE_DAYS) >= today ? { ok: true } : { ok: false, motivo: `factura sin pagar desde ${vence}` };
  }
  const pago = ISO_DATE_RE.test(s.ultimo_pago || '') ? s.ultimo_pago : '';
  if (!pago) return { ok: false, motivo: 'sin ningún pago registrado' };
  const limite = addDaysIso(today, planPeriodo(s.plan) === 'anual' ? -370 : -35);
  return pago >= limite ? { ok: true } : { ok: false, motivo: `último pago el ${pago}: no llegó el cobro siguiente` };
}
function planNombre(periodo) { return periodo === 'anual' ? 'Cacusa Lovers Anual' : 'Cacusa Lovers'; }

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Claves de idempotencia deterministas: si un reintento repite la misma llamada, Square
// devuelve el mismo objeto en vez de crear otro (nunca 2 facturas para el mismo ciclo).
async function idemKey(...parts) { return (await sha256Hex(parts.join('|'))).slice(0, 40); }

async function squareApi(env, path, method = 'GET', body) {
  const r = await fetch(`${SQUARE_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Square ${method} ${path} → ${r.status}: ${JSON.stringify(d.errors || d).slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  return d;
}

async function loversLocationId(env) {
  if (env.SQUARE_LOCATION_ID) return env.SQUARE_LOCATION_ID;
  const d = await squareApi(env, '/locations/main');
  return d.location.id;
}

// Cliente de Square por email (la factura necesita un customer_id con email para que
// Square pueda mandarla por correo). Busca primero para no duplicar clientes.
async function ensureSquareCustomer(env, { email, nombre, apellido }) {
  const s = await squareApi(env, '/customers/search', 'POST', {
    query: { filter: { email_address: { exact: email } } }, limit: 1,
  });
  if (s.customers && s.customers[0]) return s.customers[0].id;
  const c = await squareApi(env, '/customers', 'POST', {
    idempotency_key: await idemKey('lovers-cust', email),
    email_address: email,
    ...(nombre ? { given_name: String(nombre).slice(0, 100) } : {}),
    ...(apellido ? { family_name: String(apellido).slice(0, 100) } : {}),
  });
  return c.customer.id;
}

// Crea + publica la factura de un ciclo. `tag` identifica el ciclo (alta-<fecha> o la
// fecha de vence que renueva): con la misma key+periodo+tag nunca se crea una segunda
// factura (KV + claves de idempotencia de Square). El order lleva en metadata todo lo
// que invoice.payment_made necesita para saber de quién es y qué periodo cubre.
async function createLoversInvoice(env, { key, email, nombre, apellido, periodo, desde, dueDate, delivery, idioma, tag }) {
  const kvKey = `loversinv:${key}:${periodo}:${tag}`;
  if (env.CACUSA_KV) {
    const cached = await env.CACUSA_KV.get(kvKey);
    if (cached) { try { const c = JSON.parse(cached); if (c && c.url) return { ...c, reused: true }; } catch (_) {} }
  }
  const en = idioma === 'en';
  const customerId = await ensureSquareCustomer(env, { email, nombre, apellido });
  const locationId = await loversLocationId(env);
  const itemName = periodo === 'anual'
    ? (en ? 'Cacusa Lovers — annual membership' : 'Cacusa Lovers — membresía anual')
    : (en ? 'Cacusa Lovers — monthly membership' : 'Cacusa Lovers — membresía mensual');
  const order = await squareApi(env, '/orders', 'POST', {
    idempotency_key: await idemKey('lovers-ord', kvKey),
    order: {
      location_id: locationId,
      customer_id: customerId,
      reference_id: 'lovers',
      line_items: [{ name: itemName, quantity: '1', base_price_money: { amount: LOVERS_PRICES_CENTS[periodo], currency: 'USD' } }],
      metadata: { lovers_key: key, lovers_periodo: periodo, lovers_desde: desde || 'pago', lovers_idioma: en ? 'en' : 'es' },
    },
  });
  const reminders = delivery === 'EMAIL' ? [
    { relative_scheduled_days: 0, message: en ? 'Your Cacusa Lovers payment is due today. Pay with Apple Pay, Google Pay or card.' : 'Hoy vence tu pago de Cacusa Lovers. Puedes pagar con Apple Pay, Google Pay o tarjeta.' },
    { relative_scheduled_days: 3, message: en ? 'Reminder: your Cacusa Lovers payment is still pending. Your benefits pause 7 days after the due date.' : 'Recordatorio: tu pago de Cacusa Lovers sigue pendiente. Tus beneficios se pausan 7 días después del vencimiento.' },
  ] : undefined;
  const inv = await squareApi(env, '/invoices', 'POST', {
    idempotency_key: await idemKey('lovers-inv', kvKey),
    invoice: {
      location_id: locationId,
      order_id: order.order.id,
      primary_recipient: { customer_id: customerId },
      payment_requests: [{
        request_type: 'BALANCE',
        due_date: dueDate,
        automatic_payment_source: 'NONE',
        ...(reminders ? { reminders } : {}),
      }],
      delivery_method: delivery,
      // card:true habilita también Apple Pay y Google Pay en la página de pago de Square.
      accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false },
      title: 'Cacusa Lovers',
      description: periodo === 'anual'
        ? (en ? '2 handmade pieces every month for a year. Thank you for being part of the club ♡' : '2 piezas hechas a mano cada mes durante un año. Gracias por ser parte del club ♡')
        : (en ? '2 handmade pieces this month. Thank you for being part of the club ♡' : '2 piezas hechas a mano este mes. Gracias por ser parte del club ♡'),
    },
  });
  const pub = await squareApi(env, `/invoices/${inv.invoice.id}/publish`, 'POST', {
    version: inv.invoice.version,
    idempotency_key: await idemKey('lovers-pub', kvKey),
  });
  const out = { invoiceId: pub.invoice.id, url: pub.invoice.public_url || '', customerId, dueDate };
  if (env.CACUSA_KV && out.url) await env.CACUSA_KV.put(kvKey, JSON.stringify(out), { expirationTtl: 400 * 86400 });
  return out;
}

// Correo "tu suscripción se pausó" (lo arma y manda cacusa-admin, igual que el de
// bienvenida). Best-effort.
async function notifyPausedEmail(email, fields, env) {
  if (!env.ORDER_INGEST_KEY || !email) return;
  try {
    const r = await adminFetch(env, '/internal/lovers/paused-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ email, ...fields }),
    });
    if (!r.ok) console.error('paused-email failed:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('paused-email error:', e.message);
  }
}

// Correos de ciclo de vida de Lovers (11 oct) que arma y manda cacusa-admin:
// 'expiring' (suscripción manual por vencer en ≤7 días) y 'goodbye' (cancelación).
// Best-effort, igual que notifyPausedEmail().
async function notifyLoversEmail(kind, s, env, extra = {}) {
  if (!env.ORDER_INGEST_KEY || !s || !s.email) return false;
  try {
    const r = await adminFetch(env, '/internal/lovers/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ kind, email: s.email, nombre: s.nombre || '', idioma: idiomaDe(s), vence: s.vence || '', ...extra }),
    });
    if (!r.ok) console.error('lovers email', kind, 'failed:', r.status);
    return r.ok;
  } catch (e) { console.error('lovers email', kind, 'error:', e.message); return false; }
}

function idiomaDe(s) {
  return s && (s.idioma === 'es' || s.idioma === 'en') ? s.idioma : (s && s.pais === 'Ecuador' ? 'es' : 'en');
}

// Cron diario: factura de renovación 3 días antes de `vence` y pausa a los 7 días sin
// pagar. Solo toca registros modo_cobro:'factura'. Cada suscriptora va en su propio
// try/catch: un error de Square con una no frena a las demás.
// Lectura única de cacusa_lovers para la tarea diaria (11 oct, revisión): en el plan
// gratis de Cloudflare cada ejecución tiene un tope de llamadas externas (~50); las 3
// fases (facturas, sincronización con Square, lote) comparten esta lectura en vez de
// hacer una cada una.
async function loadAllLovers(env) {
  const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
  const r = await fetch(`${dbUrl}/cacusa_lovers.json?auth=${env.FB_DB_SECRET}`);
  if (!r.ok) throw new Error(`Firebase ${r.status}`);
  return (await r.json()) || {};
}

// reserve: llamadas que deja libres para las fases siguientes de la tarea diaria (ver
// cronBudget). Orden de cada paso (12 oct, auditoría): primero el efecto real (correo,
// apagar cupón) y DESPUÉS la marca que dice "hecho" — antes era al revés, y si el efecto
// fallaba la marca ya estaba puesta y nunca se reintentaba (ej. beneficios_off:true con el
// cupón todavía activo).
async function runLoversBilling(env, { all: preloaded, reserve = 0 } = {}) {
  const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
  const fbAuth = env.FB_DB_SECRET;
  const summary = { facturas: 0, vencidas: 0, errores: [] };
  if (!fbAuth || !env.SQUARE_ACCESS_TOKEN) { summary.errores.push('Faltan FB_DB_SECRET o SQUARE_ACCESS_TOKEN'); return summary; }
  let all = preloaded;
  if (!all) { try { all = await loadAllLovers(env); } catch (e) { summary.errores.push(e.message); return summary; } }
  const today = todayIso();
  summary.recordatorios = 0;
  summary.pendientes = 0;
  const apagarCupones = s => s.email ? notifyExclusiveCoupon('deactivate', s.email, s.idioma || s.pais, env, s.telefono) : Promise.resolve(true);
  // Suscripciones MANUALES (transferencia): recordatorio por correo cuando faltan 7 días
  // o menos para `vence` — una sola vez por fecha de vencimiento (recordatorio_vence).
  for (const [key, s] of Object.entries(all)) {
    if (!s || s.metodo_pago !== 'manual' || s.estado_pago !== 'activo') continue;
    if (!validId(key, true) || !ISO_DATE_RE.test(s.vence || '') || !s.email) continue;
    if (s.vence < today || s.vence > addDaysIso(today, 7) || s.recordatorio_vence === s.vence) continue;
    if (!cronBudget(2, reserve)) { summary.pendientes++; continue; }
    try {
      if (!(await notifyLoversEmail('expiring', s, env))) throw new Error('No se pudo mandar el recordatorio');
      const ok = await updateSubscriber(key, null, { recordatorio_vence: s.vence }, dbUrl, fbAuth);
      if (!ok) throw new Error('No se pudo marcar recordatorio_vence');
      summary.recordatorios++;
    } catch (e) { summary.errores.push(`${key}: ${e.message}`.slice(0, 300)); }
  }
  // Manuales vencidas (12 oct, auditoría): antes una manual con `vence` ya pasado seguía
  // 'activo' para siempre — sin caja (el lote mira `vence`), pero con el 5% y el envío
  // gratis funcionando. Al día siguiente de `vence` pasa a 'vencido' y se apagan sus
  // cupones; se reactiva desde el panel poniendo la nueva fecha y cambiándola a Activo.
  summary.manualesVencidas = 0;
  for (const [key, s] of Object.entries(all)) {
    if (!s || s.metodo_pago !== 'manual' || s.modo_cobro === 'factura' || s.estado_pago !== 'activo') continue;
    if (!validId(key, true) || !ISO_DATE_RE.test(s.vence || '') || s.vence >= today) continue;
    if (!cronBudget(3, reserve)) { summary.pendientes++; continue; }
    try {
      if (!(await apagarCupones(s))) throw new Error('No se pudieron apagar sus cupones');
      const ok = await updateSubscriber(key, 'vencido', { fecha_vencido: today }, dbUrl, fbAuth);
      if (!ok) throw new Error('No se pudo marcar vencido en Firebase');
      s.estado_pago = 'vencido';
      summary.manualesVencidas++;
      const nombre = [s.nombre, s.apellido].filter(Boolean).join(' ') || s.email || key;
      await notifyAdminPush('CACUSA · Lovers manual vencida', `⏸ ${nombre} (pago manual) venció el ${s.vence} — se pausaron sus beneficios. Si ya pagó, pon la nueva fecha (Válido hasta) y cámbiala a Activo`, env);
    } catch (e) { summary.errores.push(`${key}: ${e.message}`.slice(0, 300)); }
  }
  // Pausadas: al terminar el último día pagado se apagan sus beneficios (una vez).
  summary.pausasVencidas = 0;
  for (const [key, s] of Object.entries(all)) {
    if (!s || s.estado_pago !== 'pausado' || s.beneficios_off || !validId(key, true)) continue;
    if (ISO_DATE_RE.test(s.vence || '') && s.vence >= today) continue;
    if (!cronBudget(2, reserve)) { summary.pendientes++; continue; }
    try {
      if (!(await apagarCupones(s))) throw new Error('No se pudieron apagar sus cupones');
      const ok = await updateSubscriber(key, null, { beneficios_off: true }, dbUrl, fbAuth);
      if (!ok) throw new Error('No se pudo marcar beneficios_off');
      summary.pausasVencidas++;
    } catch (e) { summary.errores.push(`${key}: ${e.message}`.slice(0, 300)); }
  }
  for (const [key, s] of Object.entries(all)) {
    if (!s || s.modo_cobro !== 'factura' || s.estado_pago !== 'activo') continue;
    if (!validId(key, true) || !ISO_DATE_RE.test(s.vence || '') || !s.email) continue;
    const tocaFactura = today >= addDaysIso(s.vence, -LOVERS_INVOICE_LEAD_DAYS) && s.factura_actual_ciclo !== s.vence;
    const tocaVencer = today > addDaysIso(s.vence, LOVERS_GRACE_DAYS);
    if (!tocaFactura && !tocaVencer) continue;
    if (!cronBudget((tocaFactura ? 6 : 0) + (tocaVencer ? 4 : 0), reserve)) { summary.pendientes++; continue; }
    try {
      let facturaUrl = s.factura_actual || '';
      if (tocaFactura) {
        const inv = await createLoversInvoice(env, {
          key, email: s.email, nombre: s.nombre, apellido: s.apellido,
          periodo: planPeriodo(s.plan), desde: s.vence,
          dueDate: s.vence < today ? today : s.vence,
          delivery: 'EMAIL', idioma: idiomaDe(s), tag: s.vence,
        });
        facturaUrl = inv.url;
        const ok = await updateSubscriber(key, null, {
          factura_actual: inv.url, factura_actual_id: inv.invoiceId, factura_actual_ciclo: s.vence,
        }, dbUrl, fbAuth);
        if (!ok) throw new Error('No se pudo guardar factura_actual en Firebase');
        if (!inv.reused) summary.facturas++;
      }
      if (tocaVencer) {
        if (!(await apagarCupones(s))) throw new Error('No se pudieron apagar sus cupones');
        const ok = await updateSubscriber(key, 'vencido', { fecha_vencido: today }, dbUrl, fbAuth);
        if (!ok) throw new Error('No se pudo marcar vencido en Firebase');
        summary.vencidas++;
        const nombre = [s.nombre, s.apellido].filter(Boolean).join(' ') || s.email;
        await notifyAdminPush('CACUSA · Lovers sin pagar', `⏸ ${nombre} no pagó su factura (vencía ${s.vence}) — se pausaron sus beneficios`, env);
        await notifyPausedEmail(s.email, { nombre: s.nombre, idioma: idiomaDe(s), url: facturaUrl }, env);
      }
    } catch (e) {
      console.error('runLoversBilling:', key, e.message);
      summary.errores.push(`${key}: ${e.message}`.slice(0, 300));
    }
  }
  console.log('runLoversBilling:', JSON.stringify(summary));
  return summary;
}

// invoice.payment_made de una factura de Lovers (sin subscription_id, con metadata
// lovers_* en su order). Devuelve dbOk. Reusa los mismos avisos/cupón/envío/correo que
// el camino de suscripción, con las mismas reglas de idempotencia.
// Fecha REAL del pago (11 oct): el webhook llega el mismo día del cobro, pero un pago
// recuperado por la sincronización con Square se procesa días después — antes se
// anotaba la fecha del registro como ultimo_pago y eso sacaba a la clienta del lote
// que le tocaba (caso real: Alejandra, anual pagada el 6 sep, registrada el 11 oct).
// La sincronización pasa la fecha de cobro en invoice._paid_date.
function paidDateOf(invoice) {
  const d = invoice && invoice._paid_date;
  return ISO_DATE_RE.test(d || '') && d <= todayIso() ? d : todayIso();
}

// ── Cajas pagadas por lote (12 oct, auditoría) ───────────────────────────────
// Antes el lote miraba solo `ultimo_pago`: si alguien pagaba tarde (después del 10) y su
// cobro siguiente caía antes del 10 del mes siguiente, los 2 pagos quedaban en la misma
// ventana y una caja se perdía; y una anual pagada entre el 11 y el 14 recibía 11 cajas.
// Ahora cada pago anota a qué lote(s) va su caja en `lotes` ({"YYYY-MM": idFactura}):
// mensual 1, anual 12, desde su lote natural (pagado hasta el 10 → ese mes; después → el
// siguiente), nunca antes del mes en curso (un pago recuperado tarde no cae en un lote ya
// cerrado), y si ese mes ya tiene caja pasa al siguiente libre. Cada pago = sus cajas,
// nunca se pierde ni se duplica una. Las fichas sin `lotes` (pagos de antes de este
// cambio) siguen con la regla anterior en buildLoversBatch().
function ymAdd(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
function loteNatural(isoDate) {
  return Number(isoDate.slice(8, 10)) <= LOVERS_CUTOFF_DAY ? isoDate.slice(0, 7) : ymAdd(isoDate.slice(0, 7), 1);
}
// Devuelve el `lotes` nuevo, o null si este pago ya estaba anotado (reintento).
function asignarLotes(prev, invoiceId, payDate, periodo, today = todayIso()) {
  const lotes = {};
  if (prev && typeof prev === 'object') {
    for (const [k, v] of Object.entries(prev)) if (/^\d{4}-\d{2}$/.test(k) && v) lotes[k] = String(v);
  }
  const ref = String(invoiceId || `pago-${payDate}`).slice(0, 100);
  if (Object.values(lotes).includes(ref)) return null;
  const cur = today.slice(0, 7);
  let m = ISO_DATE_RE.test(payDate || '') ? loteNatural(payDate) : cur;
  if (m < cur) m = cur;
  for (let n = periodo === 'anual' ? 12 : 1, guard = 0; n > 0 && guard < 60; guard++, m = ymAdd(m, 1)) {
    if (!lotes[m]) { lotes[m] = ref; n--; }
  }
  const min = ymAdd(cur, -13);
  for (const k of Object.keys(lotes)) if (k < min) delete lotes[k];
  return lotes;
}
function periodoDeFactura(invoice, fallbackPlan) {
  const cents = invoice?.payment_requests?.[0]?.computed_amount_money?.amount || 0;
  if (cents > 5000) return 'anual';
  if (cents > 0) return 'mensual';
  return planPeriodo(fallbackPlan);
}

async function handleLoversInvoicePaid(invoice, meta, env, dbUrl, fbAuth) {
  let key = String(meta.lovers_key || '');
  if (!validId(key, true)) { console.warn('factura Lovers con lovers_key inválido:', invoice.id); return true; }
  const periodo = meta.lovers_periodo === 'anual' ? 'anual' : 'mensual';
  const today = todayIso();
  let existing = await getSubscriberByKey(key, dbUrl, fbAuth);
  // Misma protección contra duplicados que el camino de suscripción: si la key de la
  // factura no existe pero el cliente de Square ya está guardado en otra, se usa esa.
  if (!existing && invoice.primary_recipient?.customer_id) {
    const found = await resolveSubscriber(dbUrl, fbAuth, { customerId: invoice.primary_recipient.customer_id });
    if (found.existing) { key = found.key; existing = found.existing; }
  }
  const alreadyProcessed = !!invoice.id && existing?.square_invoice_id === invoice.id;
  const wasActive = existing?.estado_pago === 'activo';
  // Periodo anclado al ciclo que cubre la factura (lovers_desde = vence anterior en una
  // renovación). Si se paga tan tarde que ese periodo ya pasó, arranca desde hoy.
  const desde = ISO_DATE_RE.test(meta.lovers_desde || '') ? meta.lovers_desde : today;
  let vence = addPeriodIso(desde, periodo);
  if (vence <= today) vence = addPeriodIso(today, periodo);
  if (existing?.vence && existing.vence > vence && alreadyProcessed) vence = existing.vence;

  let customer = null;
  const customerId = invoice.primary_recipient?.customer_id || '';
  if (!existing) customer = customerId ? await getSquareCustomer(customerId, env.SQUARE_ACCESS_TOKEN) : null;
  const email = existing?.email || invoice.primary_recipient?.email_address || customer?.email_address || key.replace(/,/g, '.');
  const hasAddress = !!(existing && existing.direccion);
  const plan = planNombre(periodo);
  const lotesNuevos = asignarLotes(existing?.lotes, invoice.id, paidDateOf(invoice), periodo);
  const fields = {
    ...(lotesNuevos ? { lotes: lotesNuevos } : {}),
    ultimo_pago: paidDateOf(invoice),
    square_invoice_id: invoice.id || '',
    square_customer_id: customerId,
    modo_cobro: 'factura',
    // Pagó una factura de Square: deja de ser manual (ej. una que pagó un link suelto y se
    // volvió a inscribir por la página) — si no, recibiría además los recordatorios manuales.
    metodo_pago: 'square',
    plan,
    monto: LOVERS_MONTO_TXT[periodo],
    vence,
    // La factura pagada deja de ser "la pendiente".
    ...(existing?.factura_actual_id === invoice.id || !existing?.factura_actual_id ? { factura_actual: '', factura_actual_id: '' } : {}),
    // Pagó antes de confirmar su correo: todavía no hay dirección confirmada (doble
    // opt-in, S07), así que el envío del ciclo queda pendiente hasta que confirme
    // (ver /internal/lovers/confirm-register).
    ...(!hasAddress ? { envio_pendiente: invoice.id || '' } : {}),
    ...(!existing ? {
      email: String(email).toLowerCase(),
      nombre: customer?.given_name || '',
      apellido: customer?.family_name || '',
      fecha: today,
      metodo_pago: 'square',
      idioma: meta.lovers_idioma === 'en' ? 'en' : 'es',
    } : {}),
  };
  const dbOk = await updateSubscriber(key, 'activo', fields, dbUrl, fbAuth);
  if (!dbOk) return false;
  const merged = { ...(existing || {}), ...fields };
  const nombre = [merged.nombre, merged.apellido].filter(Boolean).join(' ') || email;
  if (!alreadyProcessed) {
    const txt = wasActive
      ? `🔁 ${nombre} pagó su ${periodo === 'anual' ? 'renovación anual' : 'mes'} (vence ${vence})`
      : (hasAddress ? `✅ ${nombre} confirmó su pago (${periodo})` : `✅ ${nombre} pagó (${periodo}) — falta que confirme su correo para tener la dirección`);
    await notifyAdminPush('CACUSA · Pago confirmado - Lovers', txt, env);
  }
  await notifyExclusiveCoupon('activate', email, merged.idioma || merged.pais, env);
  // Lote mensual (11 oct): el pago ya NO crea el pedido de envío; la suscriptora entra al
  // lote del mes que le toca (buildLoversBatch, corte día 10, sale la 3ra semana).
  if (!wasActive) {
    await notifySubscriptionEmail(email, {
      nombre: merged.nombre, apellido: merged.apellido, plan, monto: LOVERS_MONTO_TXT[periodo], idioma: idiomaDe(merged),
    }, env);
  }
  return true;
}

// invoice.payment_made (suscripción o factura de Lovers). Extraído (11 oct) para que lo
// usen igual el webhook y la sincronización con Square (reconcileLoversWithSquare),
// que recupera pagos cuyo webhook nunca llegó. Devuelve dbOk.
async function processPaidInvoice(invoice, env, dbUrl, fbAuth) {
  let dbOk = true;

  // Sin subscription_id: puede ser una factura de Lovers (cobro por factura, 2 oct —
  // se reconoce por la metadata lovers_* de su order) o cualquier otra factura de la
  // cuenta (esas se siguen ignorando).
  if (!invoice?.subscription_id) {
    const orderId = invoice?.order_id;
    const meta = orderId && validId(orderId)
      ? ((await squareApi(env, `/orders/${orderId}`)).order?.metadata || {})
      : {};
    if (!meta.lovers_key) {
      console.log('Ignoring non-subscription invoice:', invoice?.id);
      return true;
    }
    dbOk = await handleLoversInvoicePaid(invoice, meta, env, dbUrl, fbAuth);
    return dbOk;
  }

  const customerId = invoice?.primary_recipient?.customer_id;
  const customer = customerId ? await getSquareCustomer(customerId, env.SQUARE_ACCESS_TOKEN) : null;
  const email = invoice?.primary_recipient?.email_address
    || customer?.email_address
    || null;

  if (email) {
    const today = new Date().toISOString().slice(0, 10);
    const addr = customer?.address || {};
    const customerFields = {
      nombre:    customer?.given_name  || '',
      apellido:  customer?.family_name || '',
      direccion: addr.address_line_1   || '',
      apto:      addr.address_line_2   || '',
      ciudad:    addr.locality         || '',
      estado:    addr.administrative_district_level_1 || '',
      zip:       addr.postal_code      || '',
      pais:      addr.country          || '',
    };
    const { key, existing } = await resolveSubscriber(dbUrl, fbAuth, {
      email, subscriptionId: invoice.subscription_id, customerId,
      phone: customer?.phone_number, nombre: customer?.given_name,
    });
    // Correo de bienvenida/confirmación de suscripción (22 sep) — se calcula ANTES
    // de que updateSubscriber() escriba 'activo' más abajo, así que captura el
    // estado VIEJO. Cubre pendiente→activo (primer pago real, o el registro ni
    // siquiera existía todavía) y cancelado→activo (resuscripción) — NO cubre
    // activo→activo (renovación normal, no debe mandar nada).
    const wasActive = existing?.estado_pago === 'activo';
    // A04 (auditoría externa, 19 sep): mismo patrón que subscription.created de arriba —
    // Square reintenta el webhook si no ve un 200 rápido, o si esta función devolvió 500
    // antes por una falla transitoria de Firebase. Sin este chequeo, la MISMA factura
    // procesada 2 veces mandaba 2 avisos push de "pago confirmado" para el mismo pago
    // (notifyExclusiveCoupon ya era idempotente por su cuenta, pero igual se salta acá
    // para no repetir el llamado sin necesidad).
    const alreadyProcessed = !!invoice?.id && existing?.square_invoice_id === invoice.id;
    // Auditoría externa (19 sep, ronda nueva; generalizado 22 sep — S06): esta
    // rama reactivaba con CUALQUIER factura de esa clienta, sin comparar la
    // suscripción de la factura contra la que ya se conocía. El fix del 19 sep
    // solo cerró el caso "cancelado + misma suscripción vieja reenviada" — dejaba
    // un hueco real: una factura VIEJA de una suscripción YA REEMPLAZADA por otra
    // (ej. existing sigue 'activo' bajo la suscripción B, pero llega/reintenta una
    // factura de la suscripción A, anterior) no era detectada como stale (el
    // chequeo solo miraba `estado_pago === 'cancelado'`) — pisaba
    // `square_subscription_id` con el id VIEJO y podía disparar de nuevo avisos/
    // cupón como si fuera un evento real. `invoice.subscription_id` ya viene
    // garantizado no-nulo (se filtra arriba). Regla generalizada: si ya hay una
    // suscripción guardada, el id de esta factura NO coincide, y el estado actual
    // NO es 'cancelado' (o sea, no es una resuscripción legítima tras cancelar),
    // se trata como evento viejo/de otra suscripción y se ignora — sin importar si
    // el estado actual es 'activo' o 'pendiente'. Si el estado SÍ es 'cancelado' y
    // el id difiere, es una suscripción genuinamente nueva/resuscripción — se
    // reactiva normal y se actualiza la referencia.
    const invoiceSubId = invoice.subscription_id;
    const hasStoredSub = !!existing?.square_subscription_id;
    const subMatches = hasStoredSub && invoiceSubId === existing.square_subscription_id;
    const isStaleEvent = hasStoredSub && !subMatches && existing?.estado_pago !== 'cancelado';
    if (isStaleEvent) {
      console.warn('invoice.payment_made ignorado: factura de otra suscripción (vieja/reemplazada)', email, invoiceSubId, 'vs', existing?.square_subscription_id);
    } else if (existing) {
      // Ya existe (vino del formulario o de subscription.created): solo confirmar el pago,
      // NO pisar sus datos con lo que tenga Square (suele venir incompleto o vacio).
      const lotesNuevos = asignarLotes(existing.lotes, invoice?.id, paidDateOf(invoice), periodoDeFactura(invoice, existing.plan));
      dbOk = await updateSubscriber(key, 'activo', {
        ...(lotesNuevos ? { lotes: lotesNuevos } : {}),
        ultimo_pago: paidDateOf(invoice),
        square_invoice_id: invoice?.id || '',
        square_subscription_id: invoiceSubId,
        metodo_pago: 'square',
        ...(customerId ? { square_customer_id: customerId } : {}),
      }, dbUrl, fbAuth);
      if (dbOk) {
        if (!alreadyProcessed) {
          console.log('Marked activo:', email);
          const nombreActivo = [existing.nombre, existing.apellido].filter(Boolean).join(' ') || email;
          await notifyAdminPush('CACUSA · Pago confirmado - Lovers', `✅ ${nombreActivo} confirmó su pago`, env);
        }
        // Auditoría de integridad (19 sep, F09): antes esta llamada vivía DENTRO del
        // `!alreadyProcessed` — si la primera entrega de esta factura ya había guardado
        // square_invoice_id pero notifyExclusiveCoupon() nunca llegó a completarse (ej.
        // el Service Binding hacia cacusa-admin falló), una redelivery de Square de la
        // MISMA factura veía alreadyProcessed=true y saltaba el cupón para siempre, sin
        // volver a intentarlo. handleLoversExclusiveCoupon() ya es idempotente por su
        // cuenta (no repite nada si el cupón ya existe y está activo), así que llamarla
        // en cada entrega solo recupera un intento que había fallado, nunca duplica.
        await notifyExclusiveCoupon('activate', email, existing.idioma || existing.pais, env);
        // Lote mensual (11 oct): el pago ya NO crea el pedido de envío; la suscriptora entra al
        // lote del mes que le toca (buildLoversBatch, corte día 10, sale la 3ra semana).
        if (!wasActive) {
          const idiomaResuelto = existing.idioma === 'es' || existing.idioma === 'en'
            ? existing.idioma
            : (existing.pais === 'Ecuador' ? 'es' : 'en');
          await notifySubscriptionEmail(email, {
            nombre: existing.nombre, apellido: existing.apellido,
            plan: existing.plan, monto: existing.monto, idioma: idiomaResuelto,
          }, env);
        }
      }
    } else {
      // Subscriber not in Firebase yet — create minimal record
      // Detect annual vs monthly from invoice amount (annual = ~$219.89 = 21989 cents)
      const amountCents = invoice?.payment_requests?.[0]?.computed_amount_money?.amount || 0;
      const isAnnual = amountCents > 5000;
      dbOk = await updateSubscriber(key, 'activo', {
        email: email.toLowerCase(),
        ...customerFields,
        plan: isAnnual ? 'Cacusa Lovers Anual' : 'Cacusa Lovers',
        monto: isAnnual ? '$219.89/año' : '$19.99/mes',
        fecha: today,
        lotes: asignarLotes(null, invoice?.id, paidDateOf(invoice), isAnnual ? 'anual' : 'mensual'),
        ultimo_pago: paidDateOf(invoice),
        square_invoice_id: invoice?.id || '',
        // Auditoría de integridad (19 sep, F08): este era el único camino que
        // creaba un registro 'activo' SIN guardar square_subscription_id — dejaba
        // la guardia de arriba (isStaleForCanceled) incapaz de reconocer una
        // factura vieja/de otra suscripción en el futuro, porque no tenía nada
        // guardado contra qué comparar.
        square_subscription_id: invoiceSubId,
        ...(customerId ? { square_customer_id: customerId } : {}),
      }, dbUrl, fbAuth);
      if (dbOk) {
        console.log('Created activo record for:', email, '→', key);
        const nombreCompleto2 = [customerFields.nombre, customerFields.apellido].filter(Boolean).join(' ') || email;
        await notifyAdminPush(
          'CACUSA · Nueva suscriptora Lovers',
          `✨ ${nombreCompleto2} se unió al club (${isAnnual ? 'anual' : 'mensual'})`,
          env
        );
        await notifyExclusiveCoupon('activate', email, customerFields.pais, env);
        // wasActive es siempre false acá (existing era null) — se mantiene el mismo
        // guard por simetría/legibilidad con la rama de arriba, no porque haga
        // falta la condición.
        if (!wasActive) {
          await notifySubscriptionEmail(email, {
            nombre: customerFields.nombre, apellido: customerFields.apellido,
            plan: isAnnual ? 'Cacusa Lovers Anual' : 'Cacusa Lovers',
            monto: isAnnual ? '$219.89/año' : '$19.99/mes',
            idioma: customerFields.pais === 'Ecuador' ? 'es' : 'en',
          }, env);
        }
      }
    }
  }
  return dbOk;
}

// ── Sincronización con Square (11 oct) ────────────────────────────────────────
// El sistema se enteraba de un pago SOLO por el webhook invoice.payment_made. Si el
// aviso no llegaba, fallaba o caía en una ficha duplicada (bug del email, mismo día),
// el pago se perdía en silencio: la suscriptora quedaba sin "Último pago" y sin pedido
// del mes (caso real: Lilia, renovación de octubre). Esto le pregunta directo a Square
// por las facturas de cada suscriptora y procesa las PAGADAS que nunca se registraron,
// con el mismo processPaidInvoice() del webhook (pedido idempotente por factura:
// lovershipinvoice:<id>). Corre en el cron diario y a mano desde el panel (vista previa
// primero). Solo mira los últimos LOVERS_SYNC_DAYS días.
const LOVERS_SYNC_DAYS = 60;
async function squareCustomerFor(env, s) {
  if (s.square_customer_id && validId(s.square_customer_id)) return s.square_customer_id;
  const email = String(s.email || '').trim().toLowerCase();
  if (email) {
    const d = await squareApi(env, '/customers/search', 'POST', { query: { filter: { email_address: { exact: email } } }, limit: 1 });
    if (d.customers && d.customers[0]) return d.customers[0].id;
  }
  const digits = String(s.telefono || '').replace(/\D/g, '');
  const e164 = digits.length === 10 ? '+1' + digits : (digits.length === 11 && digits[0] === '1' ? '+' + digits : (digits.length > 7 ? '+' + digits : ''));
  if (e164) {
    const d = await squareApi(env, '/customers/search', 'POST', { query: { filter: { phone_number: { exact: e164 } } }, limit: 1 });
    if (d.customers && d.customers[0]) return d.customers[0].id;
  }
  return '';
}
// En la tarea diaria (cron:true) solo se revisa a quien puede tener un cobro nuevo y con
// un tope por corrida (ver loadAllLovers); el botón del panel revisa a todas.
const LOVERS_SYNC_CRON_MAX = 12;
function syncDue(s, today) {
  if (s.estado_pago === 'vencido' || s.estado_pago === 'pago_fallido') return true;
  if (s.estado_pago === 'pendiente') return ISO_DATE_RE.test(s.fecha || '') && s.fecha >= addDaysIso(today, -14);
  if (s.estado_pago !== 'activo') return false;
  if (!ISO_DATE_RE.test(s.ultimo_pago || '')) return true;
  return s.ultimo_pago <= addDaysIso(today, planPeriodo(s.plan) === 'anual' ? -360 : -25);
}
// Reparación única (11 oct): los pagos recuperados con "Sincronizar" ANTES del arreglo de
// paidDateOf quedaron con ultimo_pago = día del registro (2026-10-11). syncDue no vuelve a
// mirar un pago "reciente", así que la tarea diaria nunca corregía esa fecha y el lote de
// octubre las dejaba fuera (caso real: Ale, Maria Lopez — Pedidos sin sus cajas). Se
// revisan primero en la fila de la tarea diaria; cuando todas pasaron sin error se marca
// en KV y no se repite. Solo cambia la fecha si Square dice que ESA factura se cobró antes.
const LOVERS_FECHA_MALA = '2026-10-11';
const LOVERS_REPAIR_KEY = 'loversrepair:fechas-2026-10-11';
// start: desde qué ficha seguir (botón del panel cortado por el límite de llamadas —
// sin esto, cada toque volvía a revisar las mismas primeras y nunca avanzaba).
async function reconcileLoversWithSquare(env, { dryRun = true, all: preloaded, cron = false, max = LOVERS_SYNC_CRON_MAX, reserve = 0, start = 0 } = {}) {
  const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
  const fbAuth = env.FB_DB_SECRET;
  const out = { dryRun, pagosSinRegistrar: [], pagosAnteriores: [], pagosFallidos: [], noEncontradas: [], registrados: 0, errores: [] };
  if (!fbAuth || !env.SQUARE_ACCESS_TOKEN) { out.errores.push('Faltan FB_DB_SECRET o SQUARE_ACCESS_TOKEN'); return out; }
  let all = preloaded;
  if (!all) { try { all = await loadAllLovers(env); } catch (e) { out.errores.push(e.message); return out; } }
  // Manuales: no (se pagan fuera de Square), salvo las que pagaron con un link de Square
  // (pago_link_id) — si pagan otro link, se registra y se extiende su vigencia solo.
  let entries = Object.entries(all).filter(([k, s]) => s && typeof s === 'object' && s.estado_pago !== 'cancelado' && (s.metodo_pago !== 'manual' || s.pago_link_id) && validId(k, true));
  let reparar = null; // keys de la reparación única, si está pendiente
  const fallidas = new Set();
  if (cron) {
    const t0 = todayIso();
    if (env.CACUSA_KV && !dryRun && !(await env.CACUSA_KV.get(LOVERS_REPAIR_KEY))) {
      reparar = entries.filter(([, s]) => s.ultimo_pago === LOVERS_FECHA_MALA).map(([k]) => k);
    }
    const esReparar = k => !!reparar && reparar.includes(k);
    entries = [
      ...entries.filter(([k]) => esReparar(k)),
      ...entries.filter(([k, s]) => !esReparar(k) && syncDue(s, t0))
        .sort((a, b) => String(a[1].ultimo_pago || '').localeCompare(String(b[1].ultimo_pago || ''))),
    ].slice(0, max);
    if (!entries.length) {
      if (reparar) await env.CACUSA_KV.put(LOVERS_REPAIR_KEY, t0);
      return out;
    }
  } else {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    out.desde = Math.max(0, Math.min(Number(start) || 0, entries.length));
    out.total = entries.length;
    entries = entries.slice(out.desde);
    if (!entries.length) return out;
  }
  const locs = ((await squareApi(env, '/locations')).locations || []).map(l => l.id).slice(0, 10);
  if (!locs.length) { out.errores.push('Square no devolvió ubicaciones'); return out; }
  const since = addDaysIso(todayIso(), -LOVERS_SYNC_DAYS);
  const today = todayIso();
  // Pagos de la ventana (una sola lista por corrida, hasta 2 páginas de 100 por ubicación):
  // un pago por link queda ligado al CLIENTE (Payment.customer_id / buyer_email_address),
  // pero su orden muchas veces no — por eso buscar la orden por cliente no la encontraba
  // (caso Rachely: Square la muestra en el filtro "Customer", orders/search no).
  let pagosCache = null;
  const pagosDeLaVentana = async () => {
    if (pagosCache) return pagosCache;
    pagosCache = [];
    for (const loc of locs.slice(0, 3)) {
      let cursor = '';
      for (let pg = 0; pg < 2; pg++) {
        if (!cronBudget(1, reserve)) return pagosCache;
        const q = `begin_time=${encodeURIComponent(since + 'T00:00:00Z')}&sort_order=DESC&limit=100&location_id=${encodeURIComponent(loc)}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
        const d = await squareApi(env, '/payments?' + q);
        pagosCache.push(...(d.payments || []));
        cursor = d.cursor || '';
        if (!cursor) break;
      }
    }
    return pagosCache;
  };
  const esOrdenLovers = o => !!o && o.reference_id !== 'lovers' && validId(o.id || '')
    && (o.line_items || []).some(li => /lovers/i.test(li.name || ''));
  const revisadas = new Set();
  for (const [key, s] of entries) {
    const nombre = [s.nombre, s.apellido].filter(Boolean).join(' ') || s.email || key;
    // Presupuesto de la tarea diaria (ver cronBudget): ~3 llamadas por ficha + las de
    // registrar un pago; las que no entran hoy se revisan mañana.
    if (!cronBudget(4, reserve)) {
      if (!out.pendientes && !cron) out.siguiente = (out.desde || 0) + revisadas.size;
      out.pendientes = (out.pendientes || 0) + 1; continue;
    }
    revisadas.add(key);
    try {
      const customerId = await squareCustomerFor(env, s);
      if (!customerId) { out.noEncontradas.push({ id: key, nombre, email: s.email || '' }); continue; }
      const d = await squareApi(env, '/invoices/search', 'POST', {
        query: { filter: { location_ids: locs, customer_ids: [customerId] }, sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' } },
        limit: 50,
      });
      // Solo el pago sin registrar MÁS RECIENTE de cada suscriptora crea pedido: los
      // anteriores (ej. el primer mes de alguien que nunca quedó registrada) casi
      // seguro ya se enviaron a mano — se listan aparte, sin crear pedido.
      let yaHayReciente = false;
      const invs = (d.invoices || []).slice().sort((a, c) => String(c.payment_requests?.[0]?.due_date || c.created_at || '').localeCompare(String(a.payment_requests?.[0]?.due_date || a.created_at || '')));
      for (const inv of invs) {
        const due = inv.payment_requests?.[0]?.due_date || String(inv.created_at || '').slice(0, 10);
        if (due && due < since) continue;
        // Solo facturas de Lovers: de su suscripción (o de cualquier suscripción si aún no
        // tiene una guardada), o facturas de Lovers por factura (reference 'lovers').
        const esSuya = inv.subscription_id
          ? (!s.square_subscription_id || inv.subscription_id === s.square_subscription_id)
          : false;
        let esFacturaLovers = false;
        if (!inv.subscription_id && inv.order_id && validId(inv.order_id)) {
          const o = (await squareApi(env, `/orders/${inv.order_id}`)).order || {};
          esFacturaLovers = !!(o.metadata && o.metadata.lovers_key);
        }
        if (!esSuya && !esFacturaLovers) continue;
        const item = { id: key, nombre, factura: inv.id, fecha: due, monto: (inv.payment_requests?.[0]?.computed_amount_money?.amount || 0) / 100, estado: inv.status };
        if (inv.status === 'PAID') {
          const yaProcesada = s.square_invoice_id === inv.id
            || (env.CACUSA_KV && await env.CACUSA_KV.get(`lovershipinvoice:${inv.id}`));
          if (yaProcesada) {
            // Reparación: si se registró con la fecha del registro en vez de la del
            // cobro, se corrige para que entre al lote correcto.
            if (!yaHayReciente && s.square_invoice_id === inv.id && ISO_DATE_RE.test(due || '') && due <= today
                && ISO_DATE_RE.test(s.ultimo_pago || '') && s.ultimo_pago > due) {
              out.fechasCorregidas = (out.fechasCorregidas || []);
              out.fechasCorregidas.push({ ...item, antes: s.ultimo_pago });
              if (!dryRun) {
                if (!(await updateSubscriber(key, null, { ultimo_pago: due }, dbUrl, fbAuth))) throw new Error('No se pudo corregir ultimo_pago');
                s.ultimo_pago = due;
              }
            }
            yaHayReciente = true; continue;
          }
          if (yaHayReciente) { out.pagosAnteriores.push(item); continue; }
          yaHayReciente = true;
          out.pagosSinRegistrar.push(item);
          if (!dryRun) {
            // Deja los ids de Square en SU ficha antes de procesar, así processPaidInvoice
            // la encuentra a ella (y no crea un duplicado si el email de Square es otro).
            const ids = { square_customer_id: customerId, ...(inv.subscription_id && !s.square_subscription_id ? { square_subscription_id: inv.subscription_id } : {}) };
            if (!(await updateSubscriber(key, null, ids, dbUrl, fbAuth))) throw new Error('No se pudo guardar los ids de Square');
            Object.assign(s, ids);
            const ok = await processPaidInvoice({ ...inv, _paid_date: due }, env, dbUrl, fbAuth);
            if (!ok) throw new Error(`No se pudo registrar la factura ${inv.id}`);
            out.registrados++;
            // (processPaidInvoice ya avisa "Pago confirmado"; sin un segundo push acá para
            // no gastar llamadas de la tarea diaria.)
          }
        } else if (inv.status === 'FAILED' || (inv.status === 'UNPAID' && due && due < today)) {
          out.pagosFallidos.push(item);
        }
      }
      // Pagos por LINK de Square (12 oct, caso real: Rachely Mendoza, "Activa" sin fecha de
      // pago). El link de respaldo de la página de Lovers — y cualquier link armado a mano —
      // cobra con una orden de Checkout, no con una factura: el aviso invoice.payment_made
      // nunca llega y esta sincronización solo buscaba facturas, así que el pago quedaba sin
      // registrar y la suscriptora fuera del lote. Si en la ventana no hay ninguna factura
      // pagada, se busca la última orden COMPLETADA de este cliente con un producto de Lovers.
      if (!yaHayReciente && cronBudget(5, reserve)) {
        let orden = null;
        try {
          const emailLc = String(s.email || '').trim().toLowerCase();
          const candidatos = (await pagosDeLaVentana()).filter(pg => pg.status === 'COMPLETED' && (pg.amount_money?.amount || 0) > 0
            && pg.order_id && validId(pg.order_id)
            && (pg.customer_id === customerId || (emailLc && String(pg.buyer_email_address || '').trim().toLowerCase() === emailLc)));
          for (const pg of candidatos.slice(0, 3)) {
            if (!cronBudget(1, reserve)) break;
            const o = (await squareApi(env, `/orders/${pg.order_id}`)).order;
            if (esOrdenLovers(o)) { orden = { id: o.id, closed_at: pg.created_at, total_money: pg.amount_money }; break; }
          }
          // Respaldo: órdenes del cliente (por si el pago no trae cliente ni correo).
          if (!orden && cronBudget(2, reserve)) {
            const od = await squareApi(env, '/orders/search', 'POST', {
              location_ids: locs,
              query: {
                filter: {
                  customer_filter: { customer_ids: [customerId] },
                  state_filter: { states: ['COMPLETED'] },
                  date_time_filter: { closed_at: { start_at: since + 'T00:00:00Z' } },
                },
                sort: { sort_field: 'CLOSED_AT', sort_order: 'DESC' },
              },
              limit: 10,
            });
            orden = (od.orders || []).find(o => esOrdenLovers(o) && (o.total_money?.amount || 0) > 0) || null;
          }
        } catch (e) {
          out.errores.push(`${nombre} (buscando pagos por link): ${e.message}`.slice(0, 300));
        }
        if (!orden && !ISO_DATE_RE.test(s.ultimo_pago || '')) {
          // Para que el panel diga por qué no se encontró nada, en vez de quedarse callado.
          out.sinPagoEncontrado = out.sinPagoEncontrado || [];
          out.sinPagoEncontrado.push({ id: key, nombre, clienteSquare: customerId });
        }
        const fechaLink = orden ? String(orden.closed_at || orden.created_at || '').slice(0, 10) : '';
        if (orden && ISO_DATE_RE.test(fechaLink) && s.pago_link_id !== orden.id) {
          const cents = orden.total_money.amount;
          const periodo = cents > 5000 ? 'anual' : 'mensual';
          out.pagosLink = out.pagosLink || [];
          out.pagosLink.push({ id: key, nombre, orden: orden.id, fecha: fechaLink, monto: cents / 100 });
          if (!dryRun) {
            // ¿El link dejó una suscripción de Square? Entonces Square cobra solo los meses
            // siguientes. Si no (pago único), queda como MANUAL con vigencia = pago + periodo
            // (decisión de la usuaria, 12 oct, caso Rachely): no se le cobra nada solo; le
            // llega el recordatorio 7 días antes, al vencer se pausan sus beneficios y se
            // avisa a Tita/Robin para que la contacten y se vuelva a inscribir.
            let subId = s.square_subscription_id || '';
            if (!subId) {
              const sd = await squareApi(env, '/subscriptions/search', 'POST', { query: { filter: { customer_ids: [customerId] } }, limit: 10 });
              const sub = (sd.subscriptions || []).find(x => (x.status === 'ACTIVE' || x.status === 'PENDING') && validId(x.id || ''));
              subId = sub ? sub.id : '';
            }
            const eraActiva = s.estado_pago === 'activo';
            const lotes = asignarLotes(s.lotes, orden.id, fechaLink, periodo);
            const campos = {
              ultimo_pago: fechaLink, pago_link_id: orden.id, square_customer_id: customerId,
              ...(lotes ? { lotes } : {}),
              ...(subId
                ? { square_subscription_id: subId }
                : (() => {
                  const venceLink = addPeriodIso(fechaLink, periodo);
                  const venceAntes = ISO_DATE_RE.test(s.vence || '') ? s.vence : '';
                  return { metodo_pago: 'manual', vence: venceAntes > venceLink ? venceAntes : venceLink, plan: planNombre(periodo), monto: LOVERS_MONTO_TXT[periodo] };
                })()),
            };
            if (!(await updateSubscriber(key, 'activo', campos, dbUrl, fbAuth))) throw new Error('No se pudo registrar el pago por link');
            Object.assign(s, campos, { estado_pago: 'activo' });
            out.registrados++;
            if (!eraActiva) await notifyExclusiveCoupon('activate', s.email, s.idioma || s.pais, env);
            await notifyAdminPush('CACUSA · Pago confirmado - Lovers',
              `💳 ${nombre} pagó con un link de Square (${fechaLink}) — registrado${subId ? '' : `; vigente hasta el ${campos.vence}, no se le cobra solo`}`, env);
          }
        }
      }
    } catch (e) {
      fallidas.add(key);
      out.errores.push(`${nombre}: ${e.message}`.slice(0, 300));
    }
  }
  if (reparar) {
    if (reparar.every(k => revisadas.has(k) && !fallidas.has(k))) await env.CACUSA_KV.put(LOVERS_REPAIR_KEY, todayIso());
  }
  console.log('reconcileLoversWithSquare:', JSON.stringify({ dryRun, sinRegistrar: out.pagosSinRegistrar.length, registrados: out.registrados, fallidos: out.pagosFallidos.length, errores: out.errores.length }));
  return out;
}

// ── Lote mensual de envíos (11 oct) ──────────────────────────────────────────
// Los cobros caen cualquier día, pero TODAS las cajas salen juntas la 3ra semana
// (15–21). Corte: día 10. Lote del mes M (YYYY-MM):
//  - mensual Square/factura: pago (ultimo_pago) entre el 11 de M-1 y el 10 de M;
//  - mensual manual: activa con vence >= 15 de M;
//  - anual (cualquiera): su año cubre el 15 de M y pagó antes del corte del 10 de M;
//  - pausada: solo si sigue vigente al 15 de M; cancelada/sin pagar/fallido: no.
// 1 pedido por suscriptora por lote (idempotencia loverslote:<M>:<key> en cacusa-admin).
const LOVERS_CUTOFF_DAY = 10;
function loteFechas(month) {
  const [y, m] = month.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  return {
    desde: `${prev}-${pad(LOVERS_CUTOFF_DAY + 1)}`,
    corte: `${month}-${pad(LOVERS_CUTOFF_DAY)}`,
    envio: `${month}-15`,
  };
}
async function buildLoversBatch(env, { month, dryRun = true, all: preloaded, maxNew = Infinity, vacios = false, limpiarVacios = false } = {}) {
  const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
  const fbAuth = env.FB_DB_SECRET;
  // fueraDelLote: activas/pausadas que NO entran a este lote, con el motivo — para ver
  // de un vistazo por qué alguien que pagó no tiene caja (antes solo se veían las que sí).
  const out = { month, dryRun, incluidas: [], yaConPedido: [], sinDireccion: [], fueraDelLote: [], creados: 0, pendientes: 0, errores: [] };
  if (!/^\d{4}-\d{2}$/.test(month || '')) { out.errores.push('Mes inválido'); return out; }
  if (!fbAuth) { out.errores.push('Falta FB_DB_SECRET'); return out; }
  const { desde, corte, envio } = loteFechas(month);
  const reconciliar = []; // suscriptoras del lote para cacusa-admin (adoptar/completar/dedupe)
  let all = preloaded;
  if (!all) { try { all = await loadAllLovers(env); } catch (e) { out.errores.push(e.message); return out; } }
  for (const [key, s] of Object.entries(all)) {
    if (!s || typeof s !== 'object') continue;
    // `lotes` (ver asignarLotes): cajas ya pagadas. Si la de este mes está pagada entra
    // aunque hoy esté pausada, vencida o con un cobro posterior fallido — esa caja se pagó.
    const lotes = s.lotes && typeof s.lotes === 'object' && Object.keys(s.lotes).length ? s.lotes : null;
    const pagadaEsteMes = !!(lotes && lotes[month]);
    if (s.estado_pago !== 'activo' && s.estado_pago !== 'pausado' && !pagadaEsteMes) continue;
    if (!validId(key, true)) {
      // Antes se saltaba en silencio: así queda a la vista en el panel.
      out.errores.push(`Revisar el email de ${[s.nombre, s.apellido].filter(Boolean).join(' ') || 'una suscriptora'}: tiene caracteres que el sistema no acepta, no entró al lote`);
      continue;
    }
    const periodo = planPeriodo(s.plan);
    const manual = s.metodo_pago === 'manual';
    const pago = ISO_DATE_RE.test(s.ultimo_pago || '') ? s.ultimo_pago : '';
    let vence = ISO_DATE_RE.test(s.vence || '') ? s.vence : '';
    if (!vence && periodo === 'anual' && pago) vence = addPeriodIso(pago, 'anual');
    const nombre = [s.nombre, s.apellido].filter(Boolean).join(' ') || s.email || key;
    if (pagadaEsteMes && s.estado_pago === 'cancelado') {
      out.fueraDelLote.push({ id: key, nombre, plan: periodo, motivo: 'cancelada, pero tenía pagada la caja de este mes: decidir a mano' });
      continue;
    }
    let motivo = '';
    let fuera = '';
    if (pagadaEsteMes) {
      motivo = periodo === 'anual' ? 'anual' : 'mensual';
    } else if (manual) {
      if (vence && vence >= envio) motivo = 'mensual manual';
      else fuera = vence ? `pago manual vence el ${vence}, antes del ${envio}` : 'pago manual sin fecha de vencimiento';
    } else if (lotes) {
      const proxima = Object.keys(lotes).filter(k => k > month).sort()[0];
      fuera = proxima ? `su caja pagada siguiente va en el lote ${proxima}` : 'sin caja pagada para este mes (el cobro todavía no llega)';
    } else if (periodo === 'anual') {
      const inicio = pago || (ISO_DATE_RE.test(s.fecha || '') ? s.fecha : '');
      if (vence && vence >= envio && inicio && inicio <= corte) motivo = 'anual';
      else if (!inicio) fuera = 'anual sin fecha de pago';
      else if (!vence || vence < envio) fuera = `anual vencida${vence ? ` el ${vence}` : ''}`;
      else fuera = `anual pagada el ${inicio}, después del corte del ${corte}: entra desde el lote siguiente`;
    } else if (pago && pago >= desde && pago <= corte) {
      motivo = 'mensual';
    } else {
      fuera = !pago ? 'sin fecha de último pago'
        : pago > corte ? `pagó el ${pago}, después del corte del ${corte}: va al lote del mes siguiente`
        : `último pago el ${pago}: el cobro de este mes todavía no llega`;
    }
    if (s.estado_pago === 'pausado' && !pagadaEsteMes && !(vence && vence >= envio) && motivo !== 'mensual' && motivo) {
      motivo = ''; fuera = `pausada, vigente solo hasta ${vence || '—'}`;
    }
    if (!motivo) { out.fueraDelLote.push({ id: key, nombre, plan: periodo, motivo: fuera }); continue; }
    const item = { id: key, nombre, plan: periodo, motivo, ciudad: s.ciudad || '', pais: s.pais || '' };
    // Pedidos del sistema anterior (uno por pago, ya sin uso): antes se saltaba a quien tenía
    // uno, y quedaba SOLO ese — muchas veces sin dirección (nacieron de una ficha duplicada
    // creada con datos de Square) —, o se duplicaba (las anuales). Ahora cacusa-admin lo
    // ADOPTA o lo completa con la dirección de la ficha (invoiceIds + reconcile-orders).
    // Con ':' — los ids de factura de Square son "inv:0-ChC…" (sin él se filtraban todos).
    const invoiceIds = [...new Set([s.square_invoice_id, ...Object.values(lotes || {})].filter(v => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(v)))].slice(0, 6);
    const fichaCliente = {
      nombre: s.nombre, apellido: s.apellido, telefono: s.telefono,
      direccion: s.direccion, apto: s.apto, ciudad: s.ciudad,
      estado: s.estado, zip: s.zip, pais: s.pais,
      email: s.email || '', idioma: idiomaDe(s),
    };
    reconciliar.push({ key, plan: s.plan || planNombre(periodo), invoiceIds, cliente: fichaCliente });
    if (!s.direccion) { out.sinDireccion.push(item); continue; }
    out.incluidas.push(item);
    if (!dryRun) {
      // Si la caja ya se creó (marcador en KV), no se gasta una llamada a cacusa-admin.
      if (env.CACUSA_KV && await env.CACUSA_KV.get(`loverslote:${month}:${key}`)) continue;
      // Tope por ejecución (tarea diaria): las que falten se crean al día siguiente.
      // reserva 2: el refresco único de la lista de pedidos y el aviso final.
      if (out.creados >= maxNew || !cronBudget(1, 2)) { out.pendientes++; continue; }
      const res = await notifyLoversShipment({
        nombre: s.nombre, apellido: s.apellido, telefono: s.telefono,
        direccion: s.direccion, apto: s.apto, ciudad: s.ciudad,
        estado: s.estado, zip: s.zip, pais: s.pais,
        email: s.email || '', idioma: idiomaDe(s),
        invoiceIds,
        // Un solo refresco de la lista de pedidos al final (ver abajo), no uno por caja.
        noRefresh: true,
      }, s.plan || planNombre(periodo), '', env, `${month}:${key}`);
      if (!res) { out.errores.push(`${nombre}: no se pudo crear el pedido`); continue; }
      if (res.yaTrabajado) out.yaConPedido.push(item);
      if (!res.alreadyExisted) out.creados++;
    }
  }
  // Una sola llamada a cacusa-admin: completa los pedidos del lote con la dirección de la
  // ficha, adopta los viejos y quita los duplicados que nadie tocó (ver
  // handleLoversReconcileOrders en admin-worker.js). En la vista previa solo informa.
  if ((reconciliar.length || vacios) && env.ORDER_INGEST_KEY && cronBudget(1)) {
    try {
      const r = await adminFetch(env, '/internal/lovers/reconcile-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
        body: JSON.stringify({ month, dryRun, subs: reconciliar, vacios, limpiar: limpiarVacios }),
      });
      if (r.ok) {
        const d = await r.json().catch(() => null);
        if (d) out.reparacion = { adoptados: d.adoptados || [], completados: d.completados || [], borrados: d.borrados || [], sinResolver: d.sinResolver || [], sinDireccion: d.sinDireccion || [], vacios: d.vacios || [] };
      } else {
        console.error('reconcile-orders respondió', r.status);
        out.errores.push(`No se pudo revisar los pedidos viejos de Lovers (${r.status})`);
      }
    } catch (e) { console.error('reconcile-orders error:', e.message); }
  }
  // Las cajas se crearon con noRefresh (KV acepta 1 escritura por segundo a la misma llave:
  // 20 refrescos seguidos de la lista de pedidos fallaban y la lista quedaba sin las
  // últimas). Un solo refresco al final, para que aparezcan todas en Pedidos → Nuevo.
  if (!dryRun && out.creados > 0 && env.ORDER_INGEST_KEY) {
    try {
      const r = await adminFetch(env, '/internal/orders/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
        body: '{}',
      });
      if (!r.ok) console.error('orders/refresh respondió', r.status);
    } catch (e) { console.error('orders/refresh error:', e.message); }
  }
  console.log('buildLoversBatch:', JSON.stringify({ month, dryRun, incluidas: out.incluidas.length, creados: out.creados }));
  return out;
}

// ── Fichas duplicadas (11 oct; automático desde el 12 oct) ─────────────────────
// Agrupa por square_subscription_id, square_customer_id y nombre completo (este último
// solo si no hay datos que digan que son personas distintas — dedupeConflict).
// En cada grupo se conserva la ficha del FORMULARIO (la que tiene teléfono: dirección e
// idioma reales; si hay varias, la más antigua) y se le copia lo de la ficha "viva" —
// la del pago más reciente, que es la que recibe los avisos de Square: estado, ids de
// Square, último pago, factura y modo de cobro —, las cajas pagadas (`lotes`) de todas y
// los datos de dirección que le falten. Las demás se borran.
//  - soloNombre: el grupo se armó solo por el nombre → se revisa a mano en el panel.
//  - auto: comparten un id de Square y no hay 2 suscripciones de Square distintas
//    (podría ser alguien que paga 2 suscripciones de regalo) → la tarea diaria lo junta
//    sola. Bug real (12 oct): el arreglo del 11 oct solo evitaba duplicados NUEVOS; los
//    que ya existían (Lilia Alvarez) seguían ahí — una ficha "Sin pagar" y la otra con el
//    pago — y el lote podía crearle 2 cajas, una por ficha.
function planLoversDedupe(all) {
  const parent = {};
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const keys = Object.keys(all).filter(k => all[k] && typeof all[k] === 'object' && validId(k, true));
  keys.forEach(k => { parent[k] = k; });
  const byId = {};
  for (const k of keys) {
    const fullName = [all[k].nombre, all[k].apellido].every(x => String(x || '').trim())
      ? 'n:' + [all[k].nombre, all[k].apellido].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
      : '';
    // 'e:' mismo correo guardado = misma persona (fichas de antes del 12 sep con llave
    // aleatoria + la que creó un pago en la llave del correo — caso Lilia).
    const correo = all[k].email ? 'e:' + subscriberKey(all[k].email) : '';
    for (const id of [all[k].square_subscription_id && 's:' + all[k].square_subscription_id, all[k].square_customer_id && 'c:' + all[k].square_customer_id, correo, fullName]) {
      if (!id) continue;
      if (!byId[id]) { byId[id] = k; continue; }
      if (id.startsWith('n:') && dedupeConflict(all[k], all[byId[id]])) continue;
      parent[find(k)] = find(byId[id]);
    }
  }
  const groups = {};
  keys.forEach(k => { (groups[find(k)] = groups[find(k)] || []).push(k); });
  const plan = [];
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    const tel = k => String(all[k].telefono || '').replace(/\D/g, '').length >= 7 ? 0 : 1;
    g.sort((a, c) => tel(a) - tel(c) || String(all[a].fecha || '9999').localeCompare(String(all[c].fecha || '9999')));
    const ids = new Set();
    const subs = new Set();
    const correos = new Set();
    let compartenId = false;
    let mismoCorreo = false;
    for (const k2 of g) {
      if (all[k2].email) {
        const ck = subscriberKey(all[k2].email);
        if (correos.has(ck)) mismoCorreo = true;
        correos.add(ck);
      }
      if (all[k2].square_subscription_id) subs.add(all[k2].square_subscription_id);
      for (const id of [all[k2].square_subscription_id && 's:' + all[k2].square_subscription_id, all[k2].square_customer_id && 'c:' + all[k2].square_customer_id]) {
        if (!id) continue;
        if (ids.has(id)) compartenId = true;
        ids.add(id);
      }
    }
    // keep = la ficha de la que salen los datos personales (formulario). target = la llave
    // que queda: la del correo si está en el grupo (donde la buscan todas las rutas), si
    // no la misma keep.
    const keep = g[0];
    const canonica = all[keep].email ? subscriberKey(all[keep].email) : '';
    const target = canonica && g.includes(canonica) ? canonica : keep;
    const rest = g.slice(1);
    const recs = g.map(k => all[k]);
    const maxOf = f => recs.map(x => x[f] || '').sort().pop() || '';
    // Ficha viva: la del pago más reciente (empate: la que no es la conservada).
    const vivo = recs.filter(x => ISO_DATE_RE.test(x.ultimo_pago || ''))
      .sort((a, c) => a.ultimo_pago.localeCompare(c.ultimo_pago) || (a === all[keep] ? -1 : 1)).pop() || null;
    const merged = {};
    if (maxOf('ultimo_pago')) merged.ultimo_pago = maxOf('ultimo_pago');
    if (maxOf('vence')) merged.vence = maxOf('vence');
    if (vivo && vivo.square_invoice_id) merged.square_invoice_id = vivo.square_invoice_id;
    // La suscripción de Square de la ficha viva (antes se dejaba la de la conservada: si
    // eran distintas, los cobros siguientes se ignoraban como "de otra suscripción").
    const subId = (vivo && vivo.square_subscription_id) || all[keep].square_subscription_id || recs.map(x => x.square_subscription_id).find(Boolean);
    if (subId) merged.square_subscription_id = subId;
    const custId = (vivo && vivo.square_customer_id) || all[keep].square_customer_id || recs.map(x => x.square_customer_id).find(Boolean);
    if (custId) merged.square_customer_id = custId;
    if (vivo && vivo !== all[keep]) {
      if (vivo.estado_pago) merged.estado_pago = vivo.estado_pago;
      for (const f of ['modo_cobro', 'metodo_pago', 'plan', 'monto', 'factura_actual', 'factura_actual_id', 'factura_actual_ciclo']) {
        if (vivo[f]) merged[f] = vivo[f];
      }
    } else if (!vivo && recs.some(x => x.estado_pago === 'activo')) {
      merged.estado_pago = 'activo';
    }
    // Cajas pagadas (`lotes`) de todas las fichas del grupo (12 oct): si 2 pagos
    // distintos cayeron en el mismo mes, el segundo pasa al mes siguiente libre.
    const lotesUnion = {};
    for (const x of recs) {
      if (!x.lotes || typeof x.lotes !== 'object') continue;
      for (const [k, v] of Object.entries(x.lotes).sort()) {
        if (!/^\d{4}-\d{2}$/.test(k) || !v) continue;
        let m = k;
        for (let guard = 0; lotesUnion[m] && lotesUnion[m] !== v && guard < 60; guard++) m = ymAdd(m, 1);
        lotesUnion[m] = v;
      }
    }
    if (Object.keys(lotesUnion).length) merged.lotes = lotesUnion;
    for (const f of ['direccion', 'apto', 'ciudad', 'estado', 'zip', 'pais', 'telefono', 'nombre', 'apellido', 'idioma']) {
      if (!all[keep][f]) { const v = rest.map(k => all[k][f]).find(Boolean); if (v) merged[f] = v; }
    }
    // El patrón exacto del bug de renovación (12 oct): mismo nombre completo, 2 fichas,
    // una del formulario (con teléfono, sin ningún id de Square: sus pagos nunca la
    // encontraron) y otra que creó Square al cobrar con otro correo (con ids de Square,
    // sin teléfono — esa ruta nunca lo guarda). Para que fueran 2 personas distintas,
    // otra con el mismo nombre y apellido tendría que haber pagado sin llenar el
    // formulario: no pasa en la práctica. Se junta solo, igual que si compartieran un id.
    const tieneIds = x => !!(x.square_subscription_id || x.square_customer_id);
    const tieneTel = x => String(x.telefono || '').replace(/\D/g, '').length >= 7;
    const patronRenovacion = !compartenId && g.length === 2 && recs.filter(x => tieneTel(x) && !tieneIds(x)).length === 1
      && recs.filter(x => tieneIds(x) && !tieneTel(x)).length === 1;
    // Si la llave que queda no es la del formulario, se le escribe la ficha completa del
    // formulario con lo de arriba encima (sus datos personales pisan los que trajo Square).
    const actualizar = target === keep ? merged : (() => {
      const base = {};
      for (const [f, v] of Object.entries(all[keep])) if (v !== undefined && v !== null && f !== 'lotes') base[f] = v;
      return { ...base, ...merged };
    })();
    plan.push({
      conservar: { id: target, nombre: [all[keep].nombre, all[keep].apellido].filter(Boolean).join(' '), email: all[keep].email || '', fecha: all[keep].fecha || '' },
      borrar: g.filter(k => k !== target).map(k => ({ id: k, nombre: [all[k].nombre, all[k].apellido].filter(Boolean).join(' '), email: all[k].email || '', fecha: all[k].fecha || '', estado_pago: all[k].estado_pago || '' })),
      actualizar,
      soloNombre: !compartenId && !mismoCorreo && !patronRenovacion,
      auto: ((compartenId || mismoCorreo) && subs.size <= 1) || patronRenovacion,
    });
  }
  return plan;
}
// Al borrar o mover una ficha: si su llave ya tenía la caja del mes en curso, el marcador
// pasa a la llave que queda — si no, el lote le crearía una segunda caja con la llave nueva.
async function moverMarcadoresLote(env, deKey, aKey) {
  if (!env.CACUSA_KV || deKey === aKey) return;
  const mes = todayIso().slice(0, 7);
  const v = await env.CACUSA_KV.get(`loverslote:${mes}:${deKey}`);
  if (v && !(await env.CACUSA_KV.get(`loverslote:${mes}:${aKey}`))) {
    await env.CACUSA_KV.put(`loverslote:${mes}:${aKey}`, v, { expirationTtl: 400 * 24 * 3600 });
  }
}
// Aplica un plan de planLoversDedupe(). Con `all`, refleja el resultado en memoria (la
// tarea diaria sigue con los datos ya juntados, sin volver a leer Firebase).
async function applyLoversDedupe(env, plan, all = null, reserve = 0) {
  const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
  const fbAuth = env.FB_DB_SECRET;
  const hechos = [];
  for (const p of plan) {
    if (!cronBudget(1 + p.borrar.length, reserve)) break;
    const ok = await updateSubscriber(p.conservar.id, null, p.actualizar, dbUrl, fbAuth);
    if (!ok) return { hechos, error: `No se pudo actualizar ${p.conservar.id}` };
    if (all) all[p.conservar.id] = { ...(all[p.conservar.id] || {}), ...p.actualizar };
    for (const d of p.borrar) {
      await moverMarcadoresLote(env, d.id, p.conservar.id);
      const rd = await fetch(`${dbUrl}/cacusa_lovers/${d.id}.json?auth=${fbAuth}`, { method: 'DELETE' });
      if (!rd.ok) return { hechos, error: `No se pudo borrar ${d.id}` };
      if (all) delete all[d.id];
    }
    hechos.push(p);
  }
  return { hechos };
}
// Fichas sueltas guardadas con identificador aleatorio (altas de antes del 12 sep): se
// mudan a la llave de su correo, donde las buscan el formulario, las facturas y los pagos.
// Sin esto, su próxima renovación podía crear un duplicado (caso Lilia). Hasta `max` por día.
async function moverFichasALlaveDeCorreo(env, all, { max = 5, reserve = 0 } = {}) {
  const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
  const fbAuth = env.FB_DB_SECRET;
  const movidas = [];
  for (const [k, v] of Object.entries(all)) {
    if (movidas.length >= max) break;
    if (!v || typeof v !== 'object' || !v.email || !validId(k, true)) continue;
    const destino = subscriberKey(v.email);
    if (destino === k || !validId(destino, true) || all[destino]) continue;
    if (!cronBudget(2, reserve)) break;
    const datos = {};
    for (const [f, x] of Object.entries(v)) if (x !== undefined && x !== null) datos[f] = x;
    if (!(await updateSubscriber(destino, null, datos, dbUrl, fbAuth))) { console.error('mover ficha: no se pudo escribir', destino); break; }
    await moverMarcadoresLote(env, k, destino);
    const rd = await fetch(`${dbUrl}/cacusa_lovers/${k}.json?auth=${fbAuth}`, { method: 'DELETE' });
    if (!rd.ok) { console.error('mover ficha: no se pudo borrar', k); break; }
    all[destino] = v;
    delete all[k];
    movidas.push([v.nombre, v.apellido].filter(Boolean).join(' ') || v.email);
  }
  return movidas;
}

// ── Sesión (duplicado de admin-worker.js — no hay módulo compartido entre Workers) ──
// Valida el mismo token HMAC-SHA256 firmado que emite el login de cacusa-admin, usando el
// secret compartido SESSION_SECRET. Este worker nunca EMITE tokens (no hay login acá), solo
// los valida.
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function verifyToken(token, env) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const expected = await hmac(p, env.SESSION_SECRET);
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  // Barrido de seguridad (2da ronda, 19 sep) — mismo fix que admin-worker.js: revalidar el
  // usuario del payload, no solo la firma, para invalidar de inmediato cualquier token
  // histórico que no sea de un usuario real.
  if (!VALID_USERS.has(payload.user)) return null;
  // Auditoría (20 sep, F21-c) — misma copia que admin-worker.js (que es quien firma la
  // sesión y quien atiende /logout-all): si el token tiene jti, su sesión debe seguir
  // registrada en `sess:<user>:<jti>`. Requiere el binding CACUSA_KV en este Worker —
  // ANTES no lo tenía (nunca lo necesitó), hace falta agregarlo a mano en Cloudflare
  // (Settings → Bindings → Add → KV Namespace → nombre CACUSA_KV → mismo namespace que
  // ya usan cacusa-admin/cacusa-square). Sin el binding, o en tokens viejos sin jti, esto
  // no bloquea nada (mismo criterio que la copia de admin-worker.js).
  if (payload.jti && env.CACUSA_KV) {
    const active = await env.CACUSA_KV.get(`sess:${payload.user}:${payload.jti}`);
    if (!active) return null;
  }
  return payload;
}

// ── Autenticación de las rutas /admin/* ───────────────────────────────────────
async function isAuthorizedAdmin(request, env) {
  const token = request.headers.get('x-admin-key');
  if (!token || !env.SESSION_SECRET) return false;
  const session = await verifyToken(token, env);
  return !!session;
}

// ── Autenticación Worker-a-Worker (mismo ORDER_INGEST_KEY que ya comparten
// cacusa-admin y cacusa-square) — usado por /internal/lovers/active, que cacusa-admin
// llama para saber si un teléfono pertenece a una suscriptora activa antes de emitir un
// código de referido. Nunca se expone al navegador: sin este header, la ruta rechaza.
function isInternalIngest(request, env) {
  return !!env.ORDER_INGEST_KEY && safeEqual(request.headers.get('x-order-ingest-key') || '', env.ORDER_INGEST_KEY);
}

// ── Ids que se interpolan en URLs de Firebase/Square: solo caracteres seguros.
// Las keys de suscriptoras derivan del email (subscriberKey: '.'→','), así que
// para esas se permite además '@', ',' y '+'. Nunca '.', '/', '%', '?', '#'.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_LOVER_KEY_RE = /^[A-Za-z0-9_@,+-]{1,128}$/;
function validId(v, loverKey = false) {
  return typeof v === 'string' && (loverKey ? SAFE_LOVER_KEY_RE : SAFE_ID_RE).test(v);
}
function decodeId(raw) {
  try { return decodeURIComponent(raw); } catch (_) { return null; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    return withAdminOrigin(request, await handleRequest(request, env));
  },
  // Cron Trigger diario (Cloudflare → Settings → Triggers → Cron) — ver runLoversBilling().
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      cronSubreq = { n: 0 };
      try { await runDailyLovers(env); }
      finally { console.log('cron llamadas externas:', cronSubreq.n); cronSubreq = null; }
    })());
  },
};

// Tarea diaria completa. Presupuesto (ver cronBudget): cada fase deja libres las llamadas
// que necesitan las siguientes — del 11 en adelante el lote es lo más importante.
async function runDailyLovers(env) {
  let all;
  try { all = await loadAllLovers(env); } catch (e) { console.error('cron Firebase:', e.message); return; }
  // Duplicados seguros (mismo id de Square) se juntan solos ANTES de cobrar, sincronizar
  // y armar el lote — si no, la misma persona podía recibir 2 cajas o un aviso de "sin
  // pagar" en la ficha que no recibe los pagos. Los que coinciden solo por nombre quedan
  // para revisar a mano (Herramientas avanzadas → Revisar duplicados).
  try {
    const auto = planLoversDedupe(all).filter(p => p.auto);
    let hechos = [];
    if (auto.length) {
      const res = await applyLoversDedupe(env, auto, all, 35);
      if (res.error) console.error('dedupe automático:', res.error);
      hechos = res.hechos;
    }
    const movidas = await moverFichasALlaveDeCorreo(env, all, { max: 5, reserve: 35 });
    if (movidas.length) console.log('fichas movidas a la llave de su correo:', movidas.join(', '));
    if (hechos.length) {
      const nombres = hechos.slice(0, 3).map(p => p.conservar.nombre || p.conservar.email).join(', ') + (hechos.length > 3 ? '…' : '');
      await notifyAdminPush('CACUSA · Lovers', `🔗 Se juntaron ${hechos.length} ficha(s) duplicada(s): ${nombres}`, env);
    }
  } catch (e) { console.error('dedupe automático:', e.message); }
  // 12 oct: el Worker anterior (290f445) pasaba a cobro por factura a quien pagó con un
  // link de Square; la usuaria decidió que quede manual (vigencia = el mes pagado, sin
  // cobro automático). Se revierte antes de facturar — nunca si ya pagó o se le mandó una
  // factura de Lovers.
  try {
    const dbUrlR = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
    for (const [k, x] of Object.entries(all)) {
      if (!x || x.modo_cobro !== 'factura' || !x.pago_link_id || x.square_invoice_id || x.factura_actual_id || !validId(k, true)) continue;
      if (!cronBudget(1, 35)) break;
      if (await updateSubscriber(k, null, { modo_cobro: null, metodo_pago: 'manual' }, dbUrlR, env.FB_DB_SECRET)) {
        delete x.modo_cobro; x.metodo_pago = 'manual';
      }
    }
  } catch (e) { console.error('revertir link→factura:', e.message); }
  const dia0 = Number(todayIso().slice(8, 10));
  const armaLote = dia0 > LOVERS_CUTOFF_DAY;
  await runLoversBilling(env, { all, reserve: armaLote ? 30 : 15 }).catch(e => console.error('runLoversBilling:', e.message));
  const rec = await reconcileLoversWithSquare(env, { dryRun: false, all, cron: true, max: armaLote ? 8 : LOVERS_SYNC_CRON_MAX, reserve: armaLote ? 12 : 1 }).catch(e => { console.error('reconcile:', e.message); return null; });
  // Si la sincronización registró pagos, se vuelve a leer para que entren hoy al lote.
  if (rec && (rec.registrados > 0 || (rec.fechasCorregidas || []).length > 0)) {
    try { all = await loadAllLovers(env); } catch (_) {}
  }
  // Activas sin el pago al día (después de sincronizar, así no cuenta a quien recién se
  // le registró el pago): aviso a Tita/Robin cuando la lista cambia — no todos los días.
  try {
    const sinPago = Object.entries(all).filter(([, x]) => x && typeof x === 'object' && !pagoAlDia(x).ok)
      .map(([k, x]) => ({ k, nombre: [x.nombre, x.apellido].filter(Boolean).join(' ') || x.email || k }));
    const firma = sinPago.map(x => x.k).sort().join('|');
    if (env.CACUSA_KV && firma !== ((await env.CACUSA_KV.get('loverssinpago')) || '')) {
      if (sinPago.length) {
        const nombres = sinPago.slice(0, 3).map(x => x.nombre).join(', ') + (sinPago.length > 3 ? '…' : '');
        await notifyAdminPush('CACUSA · Lovers sin pago al día', `⚠ ${sinPago.length} suscripción(es) en Activo sin el pago al día: ${nombres}. Revísalas en Lovers`, env);
      }
      await env.CACUSA_KV.put('loverssinpago', firma, { expirationTtl: 40 * 24 * 3600 });
    }
  } catch (e) { console.error('aviso sin pago:', e.message); }
  // Del 11 a fin de mes: arma (o completa) el lote del mes — así un pago recuperado
  // tarde igual entra solo. Idempotente: nunca duplica.
  const hoy = todayIso();
  const dia = Number(hoy.slice(8, 10));
  if (dia > LOVERS_CUTOFF_DAY) {
    // Tope de 20 cajas nuevas por ejecución: en el plan gratis de Cloudflare cada
    // ejecución tiene ~50 llamadas externas; el resto sale al día siguiente.
    const mes = hoy.slice(0, 7);
    const b = await buildLoversBatch(env, { month: mes, dryRun: false, all, maxNew: 20 }).catch(e => { console.error('lote:', e.message); return null; });
    // Las que entran al lote pero no tienen dirección no reciben caja: se avisa una vez
    // por mes (y de nuevo solo si la lista cambia), para que no queden olvidadas.
    const sinDir = b ? b.sinDireccion.map(x => x.id).sort().join('|') : '';
    const avisoKey = `loversloteaviso:${mes}`;
    const avisarSinDir = !!sinDir && !!env.CACUSA_KV && (await env.CACUSA_KV.get(avisoKey)) !== sinDir;
    const rep2 = b && b.reparacion ? b.reparacion : null;
    const reparados = rep2 ? rep2.adoptados.length + rep2.completados.length + rep2.borrados.length : 0;
    if (b && (b.creados > 0 || avisarSinDir || reparados > 0)) {
      const partes = [];
      if (reparados > 0) partes.push(`🔧 Pedidos Lovers: ${rep2.adoptados.length + rep2.completados.length} completado(s), ${rep2.borrados.length} duplicado(s) quitado(s)`);
      if (b.creados > 0) partes.push(`📦 ${b.creados} caja(s) ${dia === LOVERS_CUTOFF_DAY + 1 ? 'en el lote del mes' : 'se sumaron al lote'} — salen del 15 al 21${b.pendientes ? ` · faltan ${b.pendientes}, se crean mañana` : ''}`);
      if (avisarSinDir) {
        const nombres = b.sinDireccion.slice(0, 3).map(x => x.nombre).join(', ') + (b.sinDireccion.length > 3 ? '…' : '');
        partes.push(`${b.sinDireccion.length} sin dirección (${nombres}): complétala en Lovers para que entren`);
      }
      await notifyAdminPush('CACUSA · Lote Lovers ' + mes, partes.join(' · '), env);
      if (avisarSinDir) await env.CACUSA_KV.put(avisoKey, sinDir, { expirationTtl: 60 * 60 * 24 * 45 });
    }
  }
}

// CORS de /admin/*: refleja el Origin solo si es uno de los orígenes del panel.
function withAdminOrigin(request, res) {
  const origin = request.headers.get('Origin') || '';
  if (!ADMIN_ORIGINS.includes(origin) || res.headers.get('Access-Control-Allow-Origin') !== ADMIN_ORIGINS[0]) return res;
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.append('Vary', 'Origin');
  return out;
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
    const fbAuth = env.FB_DB_SECRET;

    // Auditoría (20 sep, F20): ninguna ruta tenía límite de tamaño de body — 200KB deja
    // margen de sobra sobre cualquier payload real de este Worker (webhooks de Square,
    // altas/ediciones manuales de suscriptoras) sin dejar de acotar un abuso real.
    if (Number(request.headers.get('content-length') || 0) > 200_000) {
      return new Response('Payload too large', { status: 413 });
    }

    // ── GET /internal/lovers/active?phone=... — Worker-a-Worker, autenticado con
    // ORDER_INGEST_KEY. Responde si ese teléfono pertenece a una suscriptora activa
    // (estado_pago === 'activo' y, si tiene fecha de vencimiento manual, que no haya
    // vencido) — sin devolver ningún otro dato de la suscriptora.
    if (url.pathname === '/internal/lovers/active') {
      if (request.method !== 'GET') return adminJson({ error: 'Method not allowed' }, 405);
      if (!isInternalIngest(request, env)) return adminJson({ error: 'Unauthorized' }, 401);
      if (!fbAuth) return adminJson({ error: 'FB_DB_SECRET no está configurado en el worker' }, 500);

      const phoneDigits = String(url.searchParams.get('phone') || '').replace(/\D/g, '');
      if (phoneDigits.length < 7) return adminJson({ active: false }, 200);

      const r = await fetch(`${dbUrl}/cacusa_lovers.json?auth=${fbAuth}`);
      if (!r.ok) return adminJson({ error: 'No se pudo leer cacusa_lovers' }, 502);
      const subscribers = (await r.json()) || {};
      const todayIso = new Date().toISOString().slice(0, 10);
      const match = Object.values(subscribers).find(s => {
        if (!s || String(s.telefono || '').replace(/\D/g, '').slice(-7) !== phoneDigits.slice(-7)) return false;
        // Pausada: conserva beneficios hasta el último día ya pagado.
        if (s.estado_pago === 'pausado') return ISO_DATE_RE.test(s.vence || '') && s.vence >= todayIso;
        if (s.estado_pago !== 'activo') return false;
        // Factura: los beneficios siguen durante los 7 días de gracia después de `vence`
        // (el cron la pasa a 'vencido' recién ahí). Manual: `vence` es el límite exacto.
        const limite = s.modo_cobro === 'factura' && ISO_DATE_RE.test(s.vence || '')
          ? addDaysIso(s.vence, LOVERS_GRACE_DAYS) : s.vence;
        if (limite && limite < todayIso) return false;
        return true;
      });
      // email/idioma solo para cacusa-admin (manda el código de envío por correo).
      if (!match) return adminJson({ active: false }, 200);
      return adminJson({ active: true, email: String(match.email || ''), idioma: match.idioma === 'en' ? 'en' : 'es' }, 200);
    }

    // ── POST /internal/lovers/marketing-list — Worker-a-Worker (ORDER_INGEST_KEY), para la
    // pestaña "✉ Marketing" de cacusa-admin (13 oct). Solo lo mínimo para mandar un correo:
    // email, idioma y estado (para filtrar activas/pausadas/canceladas) — sin dirección,
    // teléfono ni datos de pago. Las bajas de promociones las guarda cacusa-admin en su KV.
    if (url.pathname === '/internal/lovers/marketing-list') {
      if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
      if (!isInternalIngest(request, env)) return adminJson({ error: 'Unauthorized' }, 401);
      if (!fbAuth) return adminJson({ error: 'FB_DB_SECRET no está configurado en el worker' }, 500);
      let all;
      try { all = await loadAllLovers(env); } catch (e) { return adminJson({ error: e.message }, 502); }
      const subs = Object.values(all || {})
        .filter(x => x && typeof x === 'object' && typeof x.email === 'string' && x.email.includes('@'))
        .map(x => ({ email: x.email.trim().toLowerCase().slice(0, 100), idioma: idiomaDe(x), estado: String(x.estado_pago || '') }));
      return adminJson({ subs }, 200);
    }

    // ── POST /internal/lovers/claim-pending — Worker-a-Worker, autenticado con
    // ORDER_INGEST_KEY. Lo llama cacusa-admin cuando el formulario de la página de
    // Lovers acaba de escribir una suscriptora en estado 'pendiente', para decidir si
    // corresponde mandar el push de "nueva suscripción pendiente".
    //
    // Por qué existe: el formulario escribe directo en Firebase desde el navegador y
    // se va a Square, sin pasar por ningún Worker. Si la clienta abandona el pago,
    // Square nunca manda un webhook y nadie se entera jamás de esa pendiente — por eso
    // el aviso tiene que dispararse desde el formulario, no desde un webhook.
    //
    // "claim" y no "check": marca push_pendiente en el mismo llamado, así el dedup vive
    // en el propio dato (recargar la página o reintentar el pago no vuelve a sonar) y
    // subscription.created sabe después que ese aviso ya sonó.
    if (url.pathname === '/internal/lovers/claim-pending') {
      if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
      if (!isInternalIngest(request, env)) return adminJson({ error: 'Unauthorized' }, 401);
      if (!fbAuth) return adminJson({ error: 'FB_DB_SECRET no está configurado en el worker' }, 500);

      const b = await request.json().catch(() => ({}));
      const email = String(b.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return adminJson({ notify: false }, 200);

      const key = subscriberKey(email);
      let existing;
      try {
        existing = await getSubscriberByKey(key, dbUrl, fbAuth);
      } catch (e) {
        // getSubscriberByKey() ahora lanza si Firebase falló de verdad (ver su propio
        // comentario) — acá no hay un catch general como en el webhook de Square, así
        // que se atrapa acá mismo: un error real de Firebase debe responder 500 (para
        // que quien llama pueda reintentar), nunca "notify:false" como si la
        // suscriptora no existiera.
        return adminJson({ error: 'Firebase no disponible' }, 500);
      }
      console.log('claim-pending:', email, '→ key:', key, 'existing:',
        existing ? { estado_pago: existing.estado_pago, push_pendiente: !!existing.push_pendiente } : null);
      // Falla cerrado: sin registro real, o que no esté pendiente, o que ya se haya
      // avisado, no se notifica nada.
      if (!existing || existing.estado_pago !== 'pendiente' || existing.push_pendiente) {
        return adminJson({ notify: false }, 200);
      }
      // Auditoría de integridad (19 sep, F09): antes se descartaba el resultado de este
      // PATCH — si fallaba, igual se respondía notify:true, avisando de una "suscriptora
      // pendiente" que en realidad nunca quedó marcada como avisada (el próximo
      // subscription.created/claim-pending podía volver a avisar por la misma, o peor,
      // el estado real quedó sin confirmar sin que nadie lo notara).
      const patched = await updateSubscriber(key, null, { push_pendiente: true }, dbUrl, fbAuth);
      if (!patched) return adminJson({ error: 'No se pudo marcar push_pendiente en Firebase' }, 500);
      const nombre = [existing.nombre, existing.apellido].filter(Boolean).join(' ') || email;
      return adminJson({ notify: true, nombre, plan: existing.plan || 'Cacusa Lovers' }, 200);
    }

    // ── POST /internal/lovers/start-invoice — Worker-a-Worker (ORDER_INGEST_KEY). Lo
    // llama cacusa-admin desde /lovers/register: crea (o reusa) la factura del PRIMER
    // pago y devuelve su URL pública para que la página redirija ahí (Apple Pay). La
    // factura es SHARE_MANUALLY: Square no le manda ningún correo a nadie, así que un
    // email ajeno escrito en el formulario no recibe nada (el rate limit por IP vive en
    // cacusa-admin). No escribe en Firebase: el registro lo crea la confirmación del
    // correo (doble opt-in) o el pago.
    if (url.pathname === '/internal/lovers/start-invoice') {
      if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
      if (!isInternalIngest(request, env)) return adminJson({ error: 'Unauthorized' }, 401);
      if (!fbAuth || !env.SQUARE_ACCESS_TOKEN) return adminJson({ error: 'Worker no configurado' }, 500);
      const b = await request.json().catch(() => ({}));
      const email = String(b.email || '').trim().toLowerCase().slice(0, 150);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return adminJson({ error: 'Email inválido' }, 400);
      const key = subscriberKey(email);
      if (!validId(key, true)) return adminJson({ error: 'Email inválido' }, 400);
      let current;
      try { current = await getSubscriberByKey(key, dbUrl, fbAuth); }
      catch (e) { return adminJson({ error: 'Firebase no disponible' }, 500); }
      // Pausada: ya tiene membresía (se reanuda desde el panel, no con un alta nueva que
      // dejaría su suscripción de Square en pausa y otra factura aparte).
      if (current && (current.estado_pago === 'activo' || current.estado_pago === 'pago_fallido' || current.estado_pago === 'pausado')) {
        return adminJson({ already: true }, 200);
      }
      // Ya tenía una factura de renovación sin pagar: se le devuelve esa misma.
      if (current && current.estado_pago === 'vencido' && current.factura_actual) {
        return adminJson({ url: current.factura_actual }, 200);
      }
      const periodo = planPeriodo(b.plan);
      const today = todayIso();
      try {
        const inv = await createLoversInvoice(env, {
          key, email,
          nombre: String(b.nombre || '').slice(0, 100), apellido: String(b.apellido || '').slice(0, 100),
          periodo, desde: 'pago', dueDate: today, delivery: 'SHARE_MANUALLY',
          idioma: b.idioma === 'en' ? 'en' : 'es', tag: `alta-${today}`,
        });
        if (!inv.url) return adminJson({ error: 'Square no devolvió la URL de la factura' }, 502);
        return adminJson({ url: inv.url }, 200);
      } catch (e) {
        console.error('start-invoice:', e.message);
        return adminJson({ error: 'No se pudo crear la factura en Square' }, 502);
      }
    }

    // ── POST /internal/lovers/confirm-register — Worker-a-Worker, autenticado con
    // ORDER_INGEST_KEY. Nuevo (22 sep — auditoría externa S07): antes el formulario
    // público (cacusa-lovers.html) escribía DIRECTO a este mismo nodo de Firebase
    // desde el navegador, sin que nadie probara que quien llena el formulario controla
    // ese email — cualquiera podía crear el PRIMER registro de un email ajeno con una
    // dirección inventada, y esa dirección terminaba usándose el día que la dueña real
    // pagara de verdad (invoice.payment_made preserva la dirección YA guardada, nunca
    // la de Square). Ahora cacusa-admin solo llama acá DESPUÉS de que la persona hizo
    // click en el link de confirmación que le llegó a SU correo — cierra el ataque real
    // (un atacante no controla el inbox de la víctima).
    if (url.pathname === '/internal/lovers/confirm-register') {
      if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
      if (!isInternalIngest(request, env)) return adminJson({ error: 'Unauthorized' }, 401);
      if (!fbAuth) return adminJson({ error: 'FB_DB_SECRET no está configurado en el worker' }, 500);

      const b = await request.json().catch(() => ({}));
      const email = String(b.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return adminJson({ error: 'Email inválido' }, 400);

      const key = subscriberKey(email);
      // Si ya existe con suscripción vigente (activo/pago_fallido), no se toca nada:
      // misma respuesta de éxito + aviso a las admins. Una 'cancelado' que vuelve a
      // suscribirse sí puede actualizar su dirección (sin envíos vigentes que desviar).
      let current;
      try {
        current = await getSubscriberByKey(key, dbUrl, fbAuth);
      } catch (e) {
        return adminJson({ error: 'Firebase no disponible' }, 500);
      }
      // Cobro por factura: si pagó ANTES de confirmar su correo, el registro ya está
      // 'activo' pero sin dirección (el pago no trae una dirección confirmada). Esta
      // confirmación es justamente la prueba de que controla el email: recién acá se
      // guarda la dirección y se crea el envío del ciclo que quedó pendiente.
      if (current && current.estado_pago === 'activo' && current.modo_cobro === 'factura' && !current.direccion) {
        const addr = {
          nombre: current.nombre || String(b.nombre || '').slice(0, 100),
          apellido: current.apellido || String(b.apellido || '').slice(0, 100),
          telefono: String(b.telefono || '').slice(0, 30),
          direccion: String(b.direccion || '').slice(0, 200),
          apto: String(b.apto || '').slice(0, 40),
          ciudad: String(b.ciudad || '').slice(0, 100),
          estado: String(b.estado || '').slice(0, 50),
          zip: String(b.zip || '').slice(0, 20),
          pais: String(b.pais || '').slice(0, 40),
        };
        const okAddr = await updateSubscriber(key, null, { ...addr, envio_pendiente: '' }, dbUrl, fbAuth);
        if (!okAddr) return adminJson({ error: 'No se pudo guardar en Firebase' }, 500);
        return adminJson({ ok: true }, 200);
      }
      // 'pausado' también (12 oct): antes una pausada que volvía a llenar el formulario
      // quedaba rebajada a 'pendiente' y perdía los días ya pagados.
      if (current && (current.estado_pago === 'activo' || current.estado_pago === 'pago_fallido' || current.estado_pago === 'pausado')) {
        console.warn('confirm-register: re-registro ignorado para', email, 'estado:', current.estado_pago);
        const txt = current.estado_pago === 'activo'
          ? `⚠ Intento de re-registro de una suscriptora activa: ${email}`
          : `⚠ Intento de re-registro de una suscriptora (${current.estado_pago}): ${email}`;
        await notifyAdminPush('CACUSA · Lovers', txt, env);
        return adminJson({ ok: true }, 200);
      }
      const addrFields = {
        telefono: String(b.telefono || '').slice(0, 30),
        direccion: String(b.direccion || '').slice(0, 200),
        apto: String(b.apto || '').slice(0, 40),
        ciudad: String(b.ciudad || '').slice(0, 100),
        estado: String(b.estado || '').slice(0, 50),
        zip: String(b.zip || '').slice(0, 20),
        pais: String(b.pais || '').slice(0, 40),
      };
      // Vencida (factura sin pagar) que vuelve: solo se actualiza la dirección — su estado
      // lo cambia el pago de la factura pendiente (start-invoice le devuelve esa misma).
      if (current && current.estado_pago === 'vencido') {
        const okV = await updateSubscriber(key, null, addrFields, dbUrl, fbAuth);
        if (!okV) return adminJson({ error: 'No se pudo guardar en Firebase' }, 500);
        return adminJson({ ok: true }, 200);
      }
      // metodo_pago / fecha / monto los fija el servidor (12 oct, auditoría): venían del
      // formulario público, que podía marcarse 'manual' (y quedar fuera de la
      // sincronización con Square) o elegir una fecha vieja (y pasar por la ficha
      // "original" al fusionar duplicados).
      const periodoAlta = planPeriodo(b.plan);
      const ok = await updateSubscriber(key, 'pendiente', {
        email,
        nombre: String(b.nombre || '').slice(0, 100),
        apellido: String(b.apellido || '').slice(0, 100),
        ...addrFields,
        plan: planNombre(periodoAlta),
        monto: LOVERS_MONTO_TXT[periodoAlta],
        fecha: (current && ISO_DATE_RE.test(current.fecha || '')) ? current.fecha : todayIso(),
        metodo_pago: 'square',
        idioma: b.idioma === 'en' ? 'en' : 'es',
      }, dbUrl, fbAuth);
      if (!ok) return adminJson({ error: 'No se pudo guardar en Firebase' }, 500);
      console.log('confirm-register: registro confirmado para', email, '→ key:', key);
      return adminJson({ ok: true }, 200);
    }

    // ── Rutas de administración (todas usan X-Admin-Key, no la firma de Square) ──
    if (url.pathname === '/admin/cancel-subscription' || url.pathname === '/admin/lovers' ||
        url.pathname === '/admin/cancel-lovers-invoice' || url.pathname === '/admin/lovers-billing-run' ||
        url.pathname === '/admin/lovers-dedupe' || url.pathname === '/admin/lovers-sync' ||
        url.pathname === '/admin/lovers-batch' ||
        url.pathname === '/admin/lovers-photos' || url.pathname.startsWith('/admin/lovers/') ||
        url.pathname.startsWith('/admin/reviews/')) {

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: ADMIN_CORS });
      }
      if (!(await isAuthorizedAdmin(request, env))) {
        return adminJson({ error: 'Unauthorized' }, 401);
      }
      if (!fbAuth) {
        return adminJson({ error: 'FB_DB_SECRET no está configurado en el worker' }, 500);
      }

      // POST /admin/cancel-subscription — cancelar en Square + marcar en Firebase
      if (url.pathname === '/admin/cancel-subscription') {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);

        let payload;
        try { payload = await request.json(); } catch { return adminJson({ error: 'Invalid JSON' }, 400); }
        const { subscriptionId, firebaseKey } = payload || {};
        if (!subscriptionId || !firebaseKey) {
          return adminJson({ error: 'Falta subscriptionId o firebaseKey' }, 400);
        }
        if (!validId(subscriptionId) || !validId(firebaseKey, true)) {
          return adminJson({ error: 'Id inválido' }, 400);
        }

        const result = await cancelSquareSubscription(subscriptionId, env.SQUARE_ACCESS_TOKEN);
        if (!result.ok) {
          console.error('Admin cancel failed:', result.status, JSON.stringify(result.body));
          return adminJson({ error: 'Square rechazó la cancelación', detail: result.body }, 502);
        }

        // Reflejar la cancelación en Firebase de inmediato — el webhook subscription.updated
        // de Square también la marcará al llegar, esto solo evita la espera en el admin.
        // El correo de despedida va acá solo si todavía no estaba cancelada (el webhook
        // que llega después ve 'cancelado' y no lo repite).
        try {
          const prev = await getSubscriberByKey(firebaseKey, dbUrl, fbAuth);
          if (prev && prev.estado_pago !== 'cancelado') await notifyLoversEmail('goodbye', prev, env);
        } catch (e) { console.error('goodbye tras cancelar:', e.message); }
        try {
          await updateSubscriber(firebaseKey, 'cancelado', {
            fecha_cancelacion: new Date().toISOString().slice(0, 10),
          }, dbUrl, fbAuth);
        } catch (e) { console.error('Firebase update after cancel failed:', e.message); }

        return adminJson({ ok: true }, 200);
      }

      // POST /admin/cancel-lovers-invoice — cancelar una suscriptora de cobro por factura:
      // anula en Square la factura pendiente (si hay) y la marca 'cancelado'. Ya no se le
      // generan más facturas (el cron solo factura a las 'activo').
      if (url.pathname === '/admin/cancel-lovers-invoice') {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
        const { firebaseKey } = (await request.json().catch(() => null)) || {};
        if (!validId(firebaseKey, true)) return adminJson({ error: 'Id inválido' }, 400);
        let s;
        try { s = await getSubscriberByKey(firebaseKey, dbUrl, fbAuth); }
        catch (e) { return adminJson({ error: 'Firebase no disponible' }, 502); }
        if (!s) return adminJson({ error: 'No existe esa suscriptora' }, 404);
        if (s.factura_actual_id && validId(s.factura_actual_id)) {
          try {
            const g = await squareApi(env, `/invoices/${s.factura_actual_id}`);
            const st = g.invoice?.status;
            if (st === 'UNPAID' || st === 'SCHEDULED' || st === 'DRAFT') {
              await squareApi(env, `/invoices/${s.factura_actual_id}/cancel`, 'POST', { version: g.invoice.version });
            }
          } catch (e) {
            console.error('cancel-lovers-invoice:', e.message);
            return adminJson({ error: 'Square rechazó la anulación de la factura', detail: e.message }, 502);
          }
        }
        const ok = await updateSubscriber(firebaseKey, 'cancelado', {
          fecha_cancelacion: todayIso(), factura_actual: '', factura_actual_id: '',
        }, dbUrl, fbAuth);
        if (!ok) return adminJson({ error: 'No se pudo marcar cancelado en Firebase' }, 502);
        await notifyExclusiveCoupon('deactivate', s.email, s.idioma || s.pais, env, s.telefono);
        if (s.estado_pago !== 'cancelado') await notifyLoversEmail('goodbye', s, env);
        return adminJson({ ok: true }, 200);
      }

      // POST /admin/lovers-dedupe — junta suscriptoras duplicadas (ver planLoversDedupe).
      // Por defecto es una vista previa (dryRun) que no toca nada; solo borra con
      // {dryRun:false}. Los grupos seguros (mismo id de Square) ya se juntan solos en la
      // tarea diaria; acá quedan sobre todo los que coinciden solo por nombre.
      if (url.pathname === '/admin/lovers-dedupe') {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
        const b = (await request.json().catch(() => null)) || {};
        const dryRun = b.dryRun !== false;
        const rAll = await fetch(`${dbUrl}/cacusa_lovers.json?auth=${fbAuth}`);
        if (!rAll.ok) return adminJson({ error: 'No se pudo leer cacusa_lovers' }, 502);
        const all = (await rAll.json()) || {};
        const plan = planLoversDedupe(all);
        if (dryRun) return adminJson({ dryRun: true, grupos: plan }, 200);
        const res = await applyLoversDedupe(env, plan);
        if (res.error) return adminJson({ error: res.error, hechos: res.hechos }, 502);
        return adminJson({ ok: true, fusionadas: res.hechos.length, grupos: plan }, 200);
      }

      // POST /admin/lovers-batch — lote mensual de envíos ({month:'YYYY-MM', dryRun}).
      if (url.pathname === '/admin/lovers-batch') {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
        const b = (await request.json().catch(() => null)) || {};
        const month = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : todayIso().slice(0, 7);
        // Desde el panel: también lista (y con limpiarVacios:true quita) los pedidos viejos vacíos.
        return adminJson(await withBudget(() => buildLoversBatch(env, { month, dryRun: b.dryRun !== false, maxNew: 40, vacios: true, limpiarVacios: b.limpiarVacios === true })), 200);
      }

      // POST /admin/lovers-sync — sincronización con Square (vista previa por defecto).
      if (url.pathname === '/admin/lovers-sync') {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
        const b = (await request.json().catch(() => null)) || {};
        return adminJson(await withBudget(() => reconcileLoversWithSquare(env, { dryRun: b.dryRun !== false, reserve: 2, start: b.desde })), 200);
      }

      // POST /admin/lovers-billing-run — corre el cron de facturación a mano (para probar
      // sin esperar al día siguiente). Idempotente: no duplica facturas ni avisos.
      if (url.pathname === '/admin/lovers-billing-run') {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
        return adminJson(await withBudget(() => runLoversBilling(env)), 200);
      }

      // GET /admin/lovers — lista de suscriptoras + fotos destacadas
      if (url.pathname === '/admin/lovers') {
        if (request.method === 'GET') {
          const [rSubs, rPhotos] = await Promise.all([
            fetch(`${dbUrl}/cacusa_lovers.json?auth=${fbAuth}`),
            fetch(`${dbUrl}/cacusa_lovers_photos.json?auth=${fbAuth}`),
          ]);
          if (!rSubs.ok) {
            const errText = await rSubs.text().catch(() => rSubs.status);
            return adminJson({ error: 'No se pudo leer cacusa_lovers', detail: errText }, 502);
          }
          const subscribers = (await rSubs.json()) || {};
          const photos = rPhotos.ok ? ((await rPhotos.json()) || {}) : {};
          return adminJson({ subscribers, photos }, 200);
        }

        // POST /admin/lovers — alta manual de una suscriptora (ej. clientas que pagan por
        // transferencia bancaria, sin suscripción recurrente real en Square). Se guarda con
        // el mismo esquema que un registro real, marcado con metodo_pago:'manual' y sin
        // square_subscription_id — así el botón "Cancelar en Square" del panel ya sabe no
        // ofrecerlo para estos registros.
        if (request.method === 'POST') {
          let body;
          try { body = await request.json(); } catch { return adminJson({ error: 'Invalid JSON' }, 400); }
          const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
          const email  = str(body?.email, 150).toLowerCase();
          const nombre = str(body?.nombre, 100);
          if (!email || !nombre) {
            return adminJson({ error: 'Faltan datos requeridos (nombre, email).' }, 400);
          }
          const isAnnual = body?.plan === 'anual';
          const record = {
            email,
            nombre,
            apellido:  str(body?.apellido, 100),
            telefono:  str(body?.telefono, 30),
            direccion: str(body?.direccion, 200),
            apto:      str(body?.apto, 40),
            ciudad:    str(body?.ciudad, 100),
            estado:    str(body?.estado, 50),
            zip:       str(body?.zip, 20),
            // 40, no 10: evita truncar "Estados Unidos"/"United States" a mitad de
            // palabra si se escriben a mano — ese corte rompía el match de país que
            // usa el botón de USPS en el panel (bug real encontrado 20 sep).
            pais:      str(body?.pais, 40),
            plan:      isAnnual ? 'Cacusa Lovers Anual' : 'Cacusa Lovers',
            monto:     isAnnual ? '$219.89/año' : '$19.99/mes',
            fecha:     new Date().toISOString().slice(0, 10),
            estado_pago: 'activo',
            metodo_pago: 'manual',
            vence:     /^\d{4}-\d{2}-\d{2}$/.test(body?.vence) ? body.vence : '',
            notas:     str(body?.notas, 500),
          };
          const key = subscriberKey(email);
          if (!validId(key, true)) return adminJson({ error: 'Email inválido' }, 400);
          // Auditoría (12 oct): antes pisaba en silencio una ficha existente con el mismo
          // email (fecha, método de pago, estado) — ej. una suscriptora de Square pasaba a
          // 'manual' con sus ids de Square todavía guardados. Solo se permite sobre una
          // cancelada (vuelve como manual); si no, se edita la que ya existe.
          let previa;
          try { previa = await getSubscriberByKey(key, dbUrl, fbAuth); }
          catch (e) { return adminJson({ error: 'No se pudo revisar si ya existe', detail: e.message }, 502); }
          if (previa && previa.estado_pago !== 'cancelado') {
            return adminJson({ error: `Ya existe una suscriptora con ese correo (${previa.estado_pago || 'sin estado'}). Edítala en vez de crear otra.` }, 409);
          }
          const ok = await updateSubscriber(key, null, record, dbUrl, fbAuth);
          if (!ok) return adminJson({ error: 'No se pudo crear la suscriptora' }, 502);
          await notifyExclusiveCoupon('activate', email, record.pais, env);
          return adminJson({ ok: true, id: key, subscriber: record }, 200);
        }

        return adminJson({ error: 'Method not allowed' }, 405);
      }

      // PUT /admin/lovers-photos — guardar las fotos destacadas de la página pública
      if (url.pathname === '/admin/lovers-photos') {
        if (request.method !== 'PUT') return adminJson({ error: 'Method not allowed' }, 405);
        let photos;
        try { photos = await request.json(); } catch { return adminJson({ error: 'Invalid JSON' }, 400); }
        const r = await fetch(`${dbUrl}/cacusa_lovers_photos.json?auth=${fbAuth}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(photos || {}),
        });
        if (!r.ok) {
          const errText = await r.text().catch(() => r.status);
          return adminJson({ error: 'No se pudieron guardar las fotos', detail: errText }, 502);
        }
        return adminJson({ ok: true }, 200);
      }

      // PATCH /admin/lovers/{id} y DELETE /admin/lovers/{id}
      const idMatch = url.pathname.match(/^\/admin\/lovers\/([^/]+)$/);
      if (idMatch) {
        const id = decodeId(idMatch[1]);
        if (!validId(id, true)) return adminJson({ error: 'Id inválido' }, 400);

        if (request.method === 'PATCH') {
          let fields;
          try { fields = await request.json(); } catch { return adminJson({ error: 'Invalid JSON' }, 400); }
          if (!fields || typeof fields !== 'object') {
            return adminJson({ error: 'Body inválido' }, 400);
          }
          // Auditoría (20 sep, F22): antes se mandaba el body COMPLETO a Firebase sin
          // ninguna lista blanca — el secreto FB_DB_SECRET bypassa las reglas públicas
          // (que sí exigen estado_pago:'pendiente' al CREAR), así que un campo inesperado
          // o un typo del panel podía escribir cualquier cosa. `email` queda afuera a
          // propósito: es la identidad real (subscriberKey deriva la key de Firebase del
          // email), cambiarla acá dejaría la key de Firebase desincronizada del campo.
          const LOVERS_PATCH_FIELDS = new Set([
            'nombre', 'apellido', 'telefono', 'direccion', 'apto', 'ciudad', 'estado',
            'zip', 'pais', 'plan', 'monto', 'fecha', 'estado_pago', 'metodo_pago',
            'vence', 'notas', 'idioma',
            // Bug real (12 oct): "Editar datos" del panel manda además estos 4 — sin ellos
            // en la lista, CUALQUIER edición fallaba entera ("Campo no permitido: email")
            // desde el 20 sep. email se acepta solo si no cambia (ver abajo).
            'email', 'ultimo_pago', 'square_invoice_id', 'square_subscription_id',
          ]);
          const badField = Object.keys(fields).find((k) => !LOVERS_PATCH_FIELDS.has(k));
          if (badField) return adminJson({ error: `Campo no permitido: ${badField}` }, 400);
          // Tipos y valores (12 oct, auditoría): antes cualquier valor pasaba tal cual —
          // un estado inventado dejaba a la suscriptora fuera de todo flujo, y un objeto en
          // vez de texto quedaba guardado en Firebase.
          const LOVERS_ESTADOS = ['pendiente', 'activo', 'pausado', 'vencido', 'pago_fallido', 'cancelado'];
          for (const [k, v] of Object.entries(fields)) {
            if (typeof v !== 'string') return adminJson({ error: `Valor inválido en ${k}` }, 400);
            fields[k] = v.slice(0, k === 'notas' ? 500 : 200);
          }
          if (fields.estado_pago !== undefined && !LOVERS_ESTADOS.includes(fields.estado_pago)) {
            return adminJson({ error: 'Estado de pago inválido' }, 400);
          }
          for (const k of ['vence', 'fecha']) {
            if (fields[k] !== undefined && fields[k] !== '' && !ISO_DATE_RE.test(fields[k])) {
              return adminJson({ error: `Fecha inválida en ${k} (AAAA-MM-DD)` }, 400);
            }
          }
          if (fields.metodo_pago !== undefined && !['square', 'manual'].includes(fields.metodo_pago)) {
            return adminJson({ error: 'Método de pago inválido' }, 400);
          }
          if (fields.ultimo_pago !== undefined && fields.ultimo_pago !== '' && !ISO_DATE_RE.test(fields.ultimo_pago)) {
            return adminJson({ error: 'Fecha inválida en ultimo_pago (AAAA-MM-DD)' }, 400);
          }
          for (const k of ['square_invoice_id', 'square_subscription_id']) {
            if (fields[k] !== undefined) {
              fields[k] = fields[k].trim();
              if (fields[k] !== '' && !validId(fields[k])) return adminJson({ error: `Id inválido en ${k}` }, 400);
            }
          }
          // 12 oct: si la ficha ya no existe (se juntó con un duplicado o se mudó a la llave
          // de su correo mientras el panel estaba abierto), 404 — antes Firebase creaba una
          // ficha fantasma en la llave vieja con solo los campos editados.
          let actual;
          try {
            actual = await getSubscriberByKey(id, dbUrl, fbAuth);
          } catch (e) {
            return adminJson({ error: 'No se pudo leer la suscriptora antes de actualizar', detail: e.message }, 502);
          }
          if (!actual) return adminJson({ error: 'Esta suscriptora se actualizó (se juntó con su duplicado o cambió de lugar). Recarga el panel e inténtalo de nuevo.' }, 404);
          // El email es la llave de la ficha (subscriberKey): no se cambia acá. El panel lo
          // manda siempre; si viene igual se ignora, si viene distinto se avisa.
          if (fields.email !== undefined) {
            if (fields.email.trim().toLowerCase() !== String(actual.email || '').trim().toLowerCase()) {
              return adminJson({ error: 'El correo no se puede cambiar desde acá (identifica la ficha). Si está mal, crea la suscriptora de nuevo con el correo correcto y elimina esta.' }, 400);
            }
            delete fields.email;
          }

          // Si estado_pago cambia de/a 'cancelado', hay que reconciliar los cupones
          // asociados (el 5% exclusivo + el envío gratis) — antes solo se reconciliaban
          // si el cambio venía del webhook real de Square; un PATCH manual del panel los
          // dejaba huérfanos (activos aunque la suscriptora ya estuviera cancelada, o
          // sin reactivar tras reactivarla a mano).
          // getSubscriberByKey() lanza si Firebase responde un error real (no solo si la
          // key no existe) — esta ruta no está dentro del try/catch general del webhook
          // más abajo, así que se envuelve acá para no dejar una excepción sin atrapar.
          let existing = null;
          if (['cancelado', 'vencido', 'activo', 'pausado', 'pago_fallido', 'pendiente'].includes(fields.estado_pago)) {
            existing = actual;
          }
          // Pausa (11 oct, revisado): para manuales, Square y factura. La clienta conserva
          // sus beneficios hasta el último día ya pagado (`vence`); el cron los apaga al
          // día siguiente (pausePastVence). No se renueva mientras esté en pausa.
          let venceNuevo = null, aviso = '';
          if (fields.estado_pago === 'pausado' && existing && existing.estado_pago !== 'pausado') {
            if (existing.estado_pago !== 'activo') {
              return adminJson({ error: 'Solo se puede pausar una suscripción activa' }, 400);
            }
            fields.fecha_pausa = todayIso();
            fields.beneficios_off = false;
            if (existing.square_subscription_id && existing.modo_cobro !== 'factura' && existing.metodo_pago !== 'manual') {
              // Square: la pausa empieza en el próximo ciclo de cobro (no se cobra más).
              // `vence` = hasta dónde ya pagó (charged_through_date).
              try {
                await squareApi(env, `/subscriptions/${existing.square_subscription_id}/pause`, 'POST', {});
                const g = await squareApi(env, `/subscriptions/${existing.square_subscription_id}`);
                const ctd = g.subscription?.charged_through_date;
                if (ISO_DATE_RE.test(ctd || '')) { fields.vence = addDaysIso(ctd, -1) >= todayIso() ? addDaysIso(ctd, -1) : todayIso(); venceNuevo = fields.vence; }
              } catch (e) {
                return adminJson({ error: 'Square no permitió pausar la suscripción', detail: e.message }, 502);
              }
            } else if (!ISO_DATE_RE.test(existing.vence || '')) {
              return adminJson({ error: 'Pon primero la fecha de vencimiento (Válido hasta) para saber hasta cuándo conserva sus beneficios' }, 400);
            }
          }
          // Reanudar: los beneficios vuelven SOLO con un pago confirmado.
          if (existing && existing.estado_pago === 'pausado' && fields.estado_pago === 'activo') {
            fields.fecha_pausa = '';
            fields.beneficios_off = false;
            const venceVigente = ISO_DATE_RE.test(fields.vence || existing.vence || '') && (fields.vence || existing.vence) >= todayIso();
            if (existing.square_subscription_id && existing.modo_cobro !== 'factura' && existing.metodo_pago !== 'manual') {
              let cancelóPausaPendiente = false;
              try {
                // La pausa de Square empieza en el próximo ciclo: si se reanuda antes, la
                // suscripción sigue ACTIVE con una acción PAUSE pendiente y /resume falla.
                // En ese caso basta con borrar esa acción (sigue cobrando normal).
                const g = await squareApi(env, `/subscriptions/${existing.square_subscription_id}?include=actions`);
                const sub = g.subscription || {};
                const pausa = (sub.actions || []).find(a => a.type === 'PAUSE');
                if (sub.status === 'ACTIVE' && pausa && validId(pausa.id)) {
                  await squareApi(env, `/subscriptions/${existing.square_subscription_id}/actions/${pausa.id}`, 'DELETE');
                  cancelóPausaPendiente = true;
                } else if (sub.status !== 'ACTIVE') {
                  await squareApi(env, `/subscriptions/${existing.square_subscription_id}/resume`, 'POST', { resume_change_timing: 'IMMEDIATE' });
                }
              } catch (e) {
                return adminJson({ error: 'Square no permitió reanudar la suscripción', detail: e.message }, 502);
              }
              if (!venceVigente && !cancelóPausaPendiente) {
                // Se activa cuando Square confirme el cobro (invoice.payment_made).
                fields.estado_pago = 'pendiente';
                aviso = 'Reanudada en Square: se activa sola cuando Square confirme el cobro.';
              }
            } else if (existing.modo_cobro === 'factura') {
              if (!venceVigente) {
                try {
                  const inv = await createLoversInvoice(env, {
                    key: id, email: existing.email, nombre: existing.nombre, apellido: existing.apellido,
                    periodo: planPeriodo(existing.plan), desde: todayIso(), dueDate: todayIso(),
                    delivery: 'EMAIL', idioma: idiomaDe(existing), tag: 'reanuda-' + todayIso(),
                  });
                  fields.estado_pago = 'vencido';
                  fields.factura_actual = inv.url; fields.factura_actual_id = inv.invoiceId; fields.factura_actual_ciclo = todayIso();
                  aviso = 'Se le envió la factura por correo: se activa sola cuando la pague.';
                } catch (e) {
                  return adminJson({ error: 'No se pudo crear la factura para reanudar', detail: e.message }, 502);
                }
              }
            } else if (!venceVigente) {
              // Manual: pasar a Activo = confirmar que pagó. Exige la nueva fecha.
              return adminJson({ error: 'Su vigencia ya terminó: para reactivarla confirma el pago poniendo la nueva fecha de vencimiento (Editar datos → Válido hasta) y luego cámbiala a Activo.' }, 400);
            }
          }

          const r = await fetch(`${dbUrl}/cacusa_lovers/${id}.json?auth=${fbAuth}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => r.status);
            return adminJson({ error: 'No se pudo actualizar', detail: errText }, 502);
          }

          if (existing && existing.estado_pago !== fields.estado_pago) {
            const email = existing.email || '';
            const idioma = fields.idioma || existing.idioma || existing.pais;
            // Beneficios (5% + envío gratis): activos solo con 'activo'. Cancelada, sin pagar
            // o pago fallido → apagados. Pausada → siguen hasta `vence` (los apaga el cron).
            if (['cancelado', 'vencido', 'pago_fallido', 'pendiente'].includes(fields.estado_pago) && !(existing.estado_pago === 'pausado' && fields.estado_pago === 'pendiente' && existing.beneficios_off)) {
              await notifyExclusiveCoupon('deactivate', email, idioma, env, existing.telefono);
              if (fields.estado_pago === 'cancelado') await notifyLoversEmail('goodbye', existing, env);
            } else if (fields.estado_pago === 'activo') {
              await notifyExclusiveCoupon('activate', email, idioma, env);
            }
          }
          return adminJson({
            ok: true, estado_pago: fields.estado_pago, ...(aviso ? { aviso } : {}),
            ...(venceNuevo ? { vence: venceNuevo } : {}),
            ...(fields.fecha_pausa !== undefined ? { fecha_pausa: fields.fecha_pausa } : {}),
          }, 200);
        }

        if (request.method === 'DELETE') {
          // Auditoría (20 sep, F22): antes borraba el registro sin desactivar el cupón
          // exclusivo del 5% ni el de envío gratis — quedaban huérfanos/activos para
          // siempre, sin ninguna suscripción real detrás. Se lee el registro ANTES de
          // borrarlo para tener con qué identificarla ante notifyExclusiveCoupon. Mismo
          // motivo que en PATCH: envuelto en try/catch porque esta ruta no está dentro
          // del try/catch general del webhook más abajo.
          let existing = null;
          try {
            existing = await getSubscriberByKey(id, dbUrl, fbAuth);
          } catch (e) {
            return adminJson({ error: 'No se pudo leer la suscriptora antes de eliminar', detail: e.message }, 502);
          }
          const r = await fetch(`${dbUrl}/cacusa_lovers/${id}.json?auth=${fbAuth}`, { method: 'DELETE' });
          if (!r.ok) {
            const errText = await r.text().catch(() => r.status);
            return adminJson({ error: 'No se pudo eliminar', detail: errText }, 502);
          }
          if (existing && existing.email) {
            await notifyExclusiveCoupon('deactivate', existing.email, existing.idioma || existing.pais, env, existing.telefono);
          }
          return adminJson({ ok: true }, 200);
        }

        return adminJson({ error: 'Method not allowed' }, 405);
      }

      // POST /admin/reviews/{productId}/{reviewId}/approve — publicar una reseña
      // Desde la auditoría del 13 sep, las reseñas nuevas nacen con approved:false y no
      // se muestran en la tienda ni cuentan para el promedio de estrellas que se publica
      // en la ficha que lee Google. Esta ruta es la que las hace visibles. Va antes del
      // match de DELETE porque su path tiene un segmento más.
      const revApprove = url.pathname.match(/^\/admin\/reviews\/([^/]+)\/([^/]+)\/approve$/);
      if (revApprove) {
        if (request.method !== 'POST') return adminJson({ error: 'Method not allowed' }, 405);
        const productId = decodeId(revApprove[1]);
        const reviewId = decodeId(revApprove[2]);
        if (!validId(productId) || !validId(reviewId)) return adminJson({ error: 'Id inválido' }, 400);
        const r = await fetch(`${dbUrl}/cacusa_reviews/${productId}/${reviewId}.json?auth=${fbAuth}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved: true }),
        });
        if (!r.ok) {
          const errText = await r.text().catch(() => r.status);
          return adminJson({ error: 'No se pudo aprobar la reseña', detail: errText }, 502);
        }
        return adminJson({ ok: true }, 200);
      }

      // DELETE /admin/reviews/{productId}/{reviewId} — moderar una reseña
      const revMatch = url.pathname.match(/^\/admin\/reviews\/([^/]+)\/([^/]+)$/);
      if (revMatch) {
        if (request.method !== 'DELETE') return adminJson({ error: 'Method not allowed' }, 405);
        const productId = decodeId(revMatch[1]);
        const reviewId = decodeId(revMatch[2]);
        if (!validId(productId) || !validId(reviewId)) return adminJson({ error: 'Id inválido' }, 400);
        const r = await fetch(`${dbUrl}/cacusa_reviews/${productId}/${reviewId}.json?auth=${fbAuth}`, { method: 'DELETE' });
        if (!r.ok) {
          const errText = await r.text().catch(() => r.status);
          return adminJson({ error: 'No se pudo eliminar la reseña', detail: errText }, 502);
        }
        return adminJson({ ok: true }, 200);
      }

      return adminJson({ error: 'Not found' }, 404);
    }

    // ── A partir de acá: solo el webhook de Square ──────────────────────────────
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    const body = await request.text();

    // Verify Square signature
    const valid = await verifySignature(request, body, env.SQUARE_WEBHOOK_SIGNATURE_KEY);
    if (!valid) {
      console.warn('Invalid Square signature');
      return new Response('Unauthorized', { status: 401 });
    }

    let event;
    try { event = JSON.parse(body); } catch { return new Response('Bad Request', { status: 400 }); }

    const type = event.type;
    const data = event.data?.object;

    console.log('Square event:', type);

    if (!fbAuth) {
      console.error('FB_DB_SECRET no configurado');
      return new Response('Internal Error', { status: 500 });
    }

    // Barrido de seguridad (3ra ronda, 19 sep): antes se ignoraba el resultado de
    // updateSubscriber() y siempre se devolvía 200 — si Firebase estaba caído (o
    // FB_DB_SECRET fallaba) en el momento exacto de un pago o cancelación, el estado
    // real (activo/cancelado/pago_fallido) se perdía en silencio para siempre, porque
    // Square nunca reintenta un webhook que ya vio 200. Ahora se rastrea si el guardado
    // realmente funcionó (dbOk) — las notificaciones push solo se disparan si el
    // guardado tuvo éxito (si no, se le estaría avisando a Tita/Robin de algo que nunca
    // se guardó), y el webhook devuelve 500 si algo falló, para que Square reintente.
    // updateSubscriber() es un PATCH idempotente, así que reintentar es seguro: no
    // duplica nada, y las notificaciones solo suenan en el intento que sí se guarda.
    let dbOk = true;
    try {
      // ── subscription.created → crear registro inmediatamente ───────────────
      if (type === 'subscription.created') {
        const sub = data?.subscription;
        if (!sub) return new Response('OK', { status: 200 });

        const customerId = sub.customer_id;
        const customer = customerId ? await getSquareCustomer(customerId, env.SQUARE_ACCESS_TOKEN) : null;
        const email = customer?.email_address || null;

        if (email) {
          const today = new Date().toISOString().slice(0, 10);
          const addr = customer?.address || {};
          // Detect annual: monthly price ~$19.99 = ~2000 cents; annual ~$219.89 = ~21989 cents
          const isAnnual = (sub.price_money?.amount || 0) > 5000;
          const { key, existing } = await resolveSubscriber(dbUrl, fbAuth, {
            email, subscriptionId: sub.id, customerId, phone: customer?.phone_number, nombre: customer?.given_name,
          });
          const nombreCompleto = [customer?.given_name, customer?.family_name].filter(Boolean).join(' ') || email;
          // A04 (auditoría externa, 19 sep): Square reintenta un webhook si no recibió un
          // 200 rápido, o si esta misma función devolvió 500 antes por una falla transitoria
          // de Firebase (fix de la 3ra ronda, ver el comentario de arriba). Sin este chequeo,
          // la MISMA suscripción procesada 2 veces mandaba 2 avisos push de "nueva
          // suscriptora" para la misma alta — capturado con el valor de ANTES de este write,
          // así que en el reintento (donde ya quedó guardado) da true y no vuelve a avisar.
          const alreadyProcessed = !!sub.id && existing?.square_subscription_id === sub.id;
          if (!existing) {
            dbOk = await updateSubscriber(key, 'pendiente', {
              email: email.toLowerCase(),
              nombre:    customer?.given_name  || '',
              apellido:  customer?.family_name || '',
              direccion: addr.address_line_1   || '',
              apto:      addr.address_line_2   || '',
              ciudad:    addr.locality         || '',
              estado:    addr.administrative_district_level_1 || '',
              zip:       addr.postal_code      || '',
              pais:      addr.country          || '',
              plan: isAnnual ? 'Cacusa Lovers Anual' : 'Cacusa Lovers',
              monto: isAnnual ? '$219.89/año' : '$19.99/mes',
              fecha: today,
              square_subscription_id: sub.id || '',
              ...(customerId ? { square_customer_id: customerId } : {}),
            }, dbUrl, fbAuth);
            console.log('Created subscriber record (subscription.created):', email, '→', key);
          } else {
            // Ya existe (vino del formulario): solo adjuntar la referencia de Square,
            // sin tocar sus datos ni su estado_pago actual.
            dbOk = await updateSubscriber(key, null, {
              square_subscription_id: sub.id || '',
              ...(customerId ? { square_customer_id: customerId } : {}),
            }, dbUrl, fbAuth);
            console.log('Attached square_subscription_id to existing record (subscription.created):', email);
          }
          // El push va siempre que llega este evento, exista o no el registro
          // todavía: en el flujo real el formulario ya escribió el 'pendiente'
          // en Firebase antes de que Square mande este webhook, así que
          // `existing` casi siempre es verdadero — si el aviso solo viviera en
          // la rama `!existing`, nunca sonaría (ese fue el bug reportado).
          //
          // Excepción: si el aviso de "suscripción pendiente" ya sonó cuando
          // llenó el formulario (push_pendiente), no se repite acá — esa misma
          // clienta recibiría su segundo aviso recién al confirmarse el pago.
          if (dbOk && !existing?.push_pendiente && !alreadyProcessed) {
            await notifyAdminPush(
              'CACUSA · Nueva suscriptora Lovers',
              `✨ ${nombreCompleto} se unió al club (${isAnnual ? 'anual' : 'mensual'})`,
              env
            );
          }
        }
      }

      // ── invoice.payment_made → activo ──────────────────────────────────────
      else if (type === 'invoice.payment_made') {
        const r = await processPaidInvoice(data?.invoice, env, dbUrl, fbAuth);
        if (r === false) dbOk = false;
      }


      // ── invoice.scheduled_charge_failed → pago_fallido ────────────────────
      else if (type === 'invoice.scheduled_charge_failed' || type === 'invoice.payment_failed') {
        const invoice = data?.invoice;
        const customerId = invoice?.primary_recipient?.customer_id;
        const email = invoice?.primary_recipient?.email_address
          || (customerId ? await getSquareCustomerEmail(customerId, env.SQUARE_ACCESS_TOKEN) : null);

        if (email || invoice?.subscription_id || customerId) {
          const { key, existing } = await resolveSubscriber(dbUrl, fbAuth, {
            email, subscriptionId: invoice?.subscription_id, customerId,
          });
          if (existing) {
            // Auditoría de integridad (19 sep, F08; endurecido 22 sep — S06c): a
            // diferencia de invoice.payment_made (arriba), esta rama degradaba el
            // estado con CUALQUIER factura fallida de esa clienta, sin comparar la
            // suscripción de la factura contra la ya guardada — una factura fallida de
            // una suscripción vieja/distinta podía degradar un registro de una
            // suscripción actual sana. El fix del 19 sep solo cerró el caso de id
            // explícitamente distinto — dejaba un hueco: si `invoice.subscription_id`
            // venía ausente/vacío, `invoiceSubId &&` se cortocircuitaba a false,
            // `belongsToOtherSubscription` daba false, y degradaba igual — un evento
            // AMBIGUO (no identifica a qué suscripción pertenece) se trataba como
            // "coincide", el peor de los 2 supuestos posibles. Ahora: si hay un
            // square_subscription_id guardado y este evento NO trae uno que coincida
            // exactamente (sea porque difiere o porque vino vacío), se ignora — solo
            // degrada cuando de verdad coincide, o cuando no hay nada guardado contra
            // qué comparar (registros legados, cada vez menos comunes tras el fix de
            // arriba).
            const invoiceSubId = invoice?.subscription_id;
            const hasStoredSub = !!existing.square_subscription_id;
            const isAmbiguousOrOtherSubscription = hasStoredSub
              && invoiceSubId !== existing.square_subscription_id;
            if (isAmbiguousOrOtherSubscription) {
              console.warn('invoice.scheduled_charge_failed ignorado: factura de otra suscripción o sin subscription_id identificable', email, invoiceSubId);
            } else {
              dbOk = await updateSubscriber(key, 'pago_fallido', {}, dbUrl, fbAuth);
              if (dbOk) {
                // Sin pagar → beneficios pausados hasta que Square confirme el cobro.
                await notifyExclusiveCoupon('deactivate', existing.email || email, existing.idioma || existing.pais, env, existing.telefono);
                console.log('Marked pago_fallido:', email);
                const nombre = [existing.nombre, existing.apellido].filter(Boolean).join(' ') || email;
                await notifyAdminPush('CACUSA · Pago fallido - Lovers', `⚠️ A ${nombre} le falló un cobro`, env, { urgency: 'high' });
              }
            }
          } else {
            console.warn('invoice.scheduled_charge_failed: no matching subscriber for', email);
          }
        }
      }

      // ── subscription.updated → cancelado si status=CANCELED ───────────────
      else if (type === 'subscription.updated') {
        const sub = data?.subscription;
        if (sub?.status === 'CANCELED') {
          const customerId = sub?.customer_id;
          const email = customerId ? await getSquareCustomerEmail(customerId, env.SQUARE_ACCESS_TOKEN) : null;
          if (email || sub?.id) {
            const { key, existing } = await resolveSubscriber(dbUrl, fbAuth, { email, subscriptionId: sub?.id, customerId });
            if (existing) {
              // Auditoría externa (22 sep, S06b): esta rama nunca comparaba la
              // suscripción del evento contra la ya guardada — a diferencia de
              // invoice.payment_made/scheduled_charge_failed (arriba), que ya
              // rechazan un evento de una suscripción distinta a la vigente. Una
              // cancelación de una suscripción VIEJA/reemplazada (ej. la clienta
              // canceló el plan mensual y se pasó al anual, y llega tarde el evento
              // de cancelación del mensual) podía cancelar la suscripción ACTUAL
              // sana. Mismo criterio: si hay un square_subscription_id guardado y
              // este evento no trae uno que coincida exactamente, se ignora.
              const hasStoredSub = !!existing.square_subscription_id;
              const isOtherSubscription = hasStoredSub && sub?.id !== existing.square_subscription_id;
              if (isOtherSubscription) {
                console.warn('subscription.updated CANCELED ignorado: suscripción distinta a la vigente', email, sub?.id, 'vs', existing.square_subscription_id);
              } else {
                dbOk = await updateSubscriber(key, 'cancelado', {
                  fecha_cancelacion: new Date().toISOString().slice(0, 10),
                }, dbUrl, fbAuth);
                if (dbOk) {
                  console.log('Marked cancelado:', email);
                  await notifyExclusiveCoupon('deactivate', email, existing.idioma || existing.pais, env, existing.telefono);
                  if (existing.estado_pago !== 'cancelado') await notifyLoversEmail('goodbye', existing, env);
                }
              }
            } else {
              console.warn('subscription.updated CANCELED: no matching subscriber for', email);
            }
          }
        }
      }

    } catch (err) {
      console.error('Handler error:', err.message);
      dbOk = false;
    }

    // Antes siempre se devolvía 200 (comentario original: "prevents retries") — pero
    // eso significaba que un fallo real de Firebase en el momento exacto de un pago o
    // cancelación se perdía para siempre, porque Square nunca reintenta un webhook que
    // ya vio 200. Ahora solo se devuelve 200 si el guardado (o la falta de guardado
    // necesario) salió bien; 500 fuerza el reintento de Square — seguro porque
    // updateSubscriber() es un PATCH idempotente.
    return new Response(dbOk ? 'OK' : 'Firebase write failed', { status: dbOk ? 200 : 500 });
}
