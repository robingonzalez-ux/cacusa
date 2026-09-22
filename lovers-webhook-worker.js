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
 *   invoice.payment_made            → marca suscriptora como "activo"
 *   invoice.scheduled_charge_failed → marca suscriptora como "pago_fallido"
 *   subscription.updated            → si status=CANCELED, marca "cancelado"
 *
 * Rutas:
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
const ADMIN_ORIGIN = 'https://cacusabytaitus.com';
const ADMIN_WORKER_URL = 'https://cacusa-admin.facturacioncacusa.workers.dev';
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
  return env.ADMIN_WORKER ? env.ADMIN_WORKER.fetch(url, options) : fetch(url, options);
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
      body: JSON.stringify({ title, body, url: 'https://cacusabytaitus.com/ui_kits/admin/', tag: 'cacusa-lovers', urgency }),
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
async function notifyLoversShipment(direccionFields, plan, squareInvoiceId, env) {
  if (!env.ORDER_INGEST_KEY) return;
  try {
    const r = await adminFetch(env, '/order/lovers-shipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ ...direccionFields, plan, squareInvoiceId }),
    });
    if (!r.ok) console.error('order/lovers-shipment failed:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('order/lovers-shipment error:', e.message);
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
async function notifyExclusiveCoupon(action, email, langOrPais, env, phone) {
  if (!env.ORDER_INGEST_KEY || !email) return;
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
  } catch (e) {
    console.error('exclusive-coupon error:', e.message);
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
  'Access-Control-Allow-Origin': ADMIN_ORIGIN,
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
  return String(email || '').trim().toLowerCase().replace(/[.#$[\]/]/g, ',');
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

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
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
      const active = Object.values(subscribers).some(s => {
        if (!s || String(s.telefono || '').replace(/\D/g, '').slice(-7) !== phoneDigits.slice(-7)) return false;
        if (s.estado_pago !== 'activo') return false;
        if (s.vence && s.vence < todayIso) return false;
        return true;
      });
      return adminJson({ active }, 200);
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
      const ok = await updateSubscriber(key, 'pendiente', {
        email,
        nombre: String(b.nombre || '').slice(0, 100),
        apellido: String(b.apellido || '').slice(0, 100),
        telefono: String(b.telefono || '').slice(0, 30),
        direccion: String(b.direccion || '').slice(0, 200),
        apto: String(b.apto || '').slice(0, 40),
        ciudad: String(b.ciudad || '').slice(0, 100),
        estado: String(b.estado || '').slice(0, 50),
        zip: String(b.zip || '').slice(0, 20),
        pais: String(b.pais || '').slice(0, 40),
        plan: String(b.plan || '').slice(0, 60),
        monto: String(b.monto || '').slice(0, 40),
        fecha: String(b.fecha || '').slice(0, 10),
        metodo_pago: String(b.metodo_pago || 'square').slice(0, 20),
        idioma: b.idioma === 'en' ? 'en' : 'es',
      }, dbUrl, fbAuth);
      if (!ok) return adminJson({ error: 'No se pudo guardar en Firebase' }, 500);
      console.log('confirm-register: registro confirmado para', email, '→ key:', key);
      return adminJson({ ok: true }, 200);
    }

    // ── Rutas de administración (todas usan X-Admin-Key, no la firma de Square) ──
    if (url.pathname === '/admin/cancel-subscription' || url.pathname === '/admin/lovers' ||
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

        const result = await cancelSquareSubscription(subscriptionId, env.SQUARE_ACCESS_TOKEN);
        if (!result.ok) {
          console.error('Admin cancel failed:', result.status, JSON.stringify(result.body));
          return adminJson({ error: 'Square rechazó la cancelación', detail: result.body }, 502);
        }

        // Reflejar la cancelación en Firebase de inmediato — el webhook subscription.updated
        // de Square también la marcará al llegar, esto solo evita la espera en el admin.
        try {
          await updateSubscriber(firebaseKey, 'cancelado', {
            fecha_cancelacion: new Date().toISOString().slice(0, 10),
          }, dbUrl, fbAuth);
        } catch (e) { console.error('Firebase update after cancel failed:', e.message); }

        return adminJson({ ok: true }, 200);
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
        const id = decodeURIComponent(idMatch[1]);

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
          ]);
          const badField = Object.keys(fields).find((k) => !LOVERS_PATCH_FIELDS.has(k));
          if (badField) return adminJson({ error: `Campo no permitido: ${badField}` }, 400);

          // Si estado_pago cambia de/a 'cancelado', hay que reconciliar los cupones
          // asociados (el 5% exclusivo + el envío gratis) — antes solo se reconciliaban
          // si el cambio venía del webhook real de Square; un PATCH manual del panel los
          // dejaba huérfanos (activos aunque la suscriptora ya estuviera cancelada, o
          // sin reactivar tras reactivarla a mano).
          // getSubscriberByKey() lanza si Firebase responde un error real (no solo si la
          // key no existe) — esta ruta no está dentro del try/catch general del webhook
          // más abajo, así que se envuelve acá para no dejar una excepción sin atrapar.
          let existing = null;
          if (fields.estado_pago === 'cancelado' || fields.estado_pago === 'activo') {
            try {
              existing = await getSubscriberByKey(id, dbUrl, fbAuth);
            } catch (e) {
              return adminJson({ error: 'No se pudo leer la suscriptora antes de actualizar', detail: e.message }, 502);
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
            if (fields.estado_pago === 'cancelado') {
              await notifyExclusiveCoupon('deactivate', email, idioma, env, existing.telefono);
            } else {
              await notifyExclusiveCoupon('activate', email, idioma, env);
            }
          }
          return adminJson({ ok: true }, 200);
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
        const productId = decodeURIComponent(revApprove[1]);
        const reviewId = decodeURIComponent(revApprove[2]);
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
        const productId = decodeURIComponent(revMatch[1]);
        const reviewId = decodeURIComponent(revMatch[2]);
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
          const key = subscriberKey(email);
          const existing = await getSubscriberByKey(key, dbUrl, fbAuth);
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
            }, dbUrl, fbAuth);
            console.log('Created subscriber record (subscription.created):', email, '→', key);
          } else {
            // Ya existe (vino del formulario): solo adjuntar la referencia de Square,
            // sin tocar sus datos ni su estado_pago actual.
            dbOk = await updateSubscriber(key, null, {
              square_subscription_id: sub.id || '',
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
        const invoice = data?.invoice;

        // Solo procesar facturas de suscripción recurrente; ignorar pagos únicos
        if (!invoice?.subscription_id) {
          console.log('Ignoring non-subscription invoice:', invoice?.id);
          return new Response('OK', { status: 200 });
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
          const key = subscriberKey(email);
          const existing = await getSubscriberByKey(key, dbUrl, fbAuth);
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
            dbOk = await updateSubscriber(key, 'activo', {
              ultimo_pago: today,
              square_invoice_id: invoice?.id || '',
              square_subscription_id: invoiceSubId,
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
              // El pedido de envío se crea con la dirección de Firebase (existing),
              // NUNCA con customerFields de Square — mismo criterio que el resto de
              // esta rama: no pisar/mezclar con datos de Square que suelen venir
              // incompletos, la fuente de verdad de la dirección ya confirmada es
              // Firebase.
              await notifyLoversShipment({
                nombre: existing.nombre, apellido: existing.apellido, telefono: existing.telefono,
                direccion: existing.direccion, apto: existing.apto, ciudad: existing.ciudad,
                estado: existing.estado, zip: existing.zip, pais: existing.pais,
              }, existing.plan, invoice?.id || '', env);
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
              ultimo_pago: today,
              square_invoice_id: invoice?.id || '',
              // Auditoría de integridad (19 sep, F08): este era el único camino que
              // creaba un registro 'activo' SIN guardar square_subscription_id — dejaba
              // la guardia de arriba (isStaleForCanceled) incapaz de reconocer una
              // factura vieja/de otra suscripción en el futuro, porque no tenía nada
              // guardado contra qué comparar.
              square_subscription_id: invoiceSubId,
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
              await notifyLoversShipment({
                nombre: customerFields.nombre, apellido: customerFields.apellido, telefono: '',
                direccion: customerFields.direccion, apto: customerFields.apto, ciudad: customerFields.ciudad,
                estado: customerFields.estado, zip: customerFields.zip, pais: customerFields.pais,
              }, isAnnual ? 'Cacusa Lovers Anual' : 'Cacusa Lovers', invoice?.id || '', env);
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
      }

      // ── invoice.scheduled_charge_failed → pago_fallido ────────────────────
      else if (type === 'invoice.scheduled_charge_failed' || type === 'invoice.payment_failed') {
        const invoice = data?.invoice;
        const customerId = invoice?.primary_recipient?.customer_id;
        const email = invoice?.primary_recipient?.email_address
          || (customerId ? await getSquareCustomerEmail(customerId, env.SQUARE_ACCESS_TOKEN) : null);

        if (email) {
          const key = subscriberKey(email);
          const existing = await getSubscriberByKey(key, dbUrl, fbAuth);
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
          if (email) {
            const key = subscriberKey(email);
            const existing = await getSubscriberByKey(key, dbUrl, fbAuth);
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
  },
};
