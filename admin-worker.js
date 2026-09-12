/**
 * CACUSA Admin Worker — backend seguro para el panel de administración.
 * También sirve de proxy de solo-lectura para el POS (robingonzalez-ux.github.io):
 * /square/locations reenvía la consulta a Square porque Square no responde CORS a navegadores.
 *
 * Variables (Cloudflare → Settings → Variables and secrets):
 *   GH_TOKEN         (secret)  GitHub PAT con permiso de escritura al repo
 *   PASS_TITA        (secret)  contraseña de tita.jaramillo
 *   PASS_ROBIN       (secret)  contraseña de robin.gonzalez
 *   SESSION_SECRET   (secret)  cadena aleatoria larga para firmar sesiones
 *   NTFY_TOPIC       (secret)  nombre del canal ntfy, ej: cacusa-pedidos-k4r9mx
 *   ORDER_INGEST_KEY (secret)  clave compartida con OTROS Workers de confianza (hoy:
 *                              cacusa-square y cacusa-lovers-webhook) para probarle a este
 *                              Worker que la llamada viene de un evento ya confirmado del
 *                              lado del servidor, no de una petición directa del navegador —
 *                              deja pasar /order, /coupon/burn, /giftcard/redeem y
 *                              /push/notify sin exigir el Origin del navegador cuando viaja
 *                              este header. Debe tener EL MISMO valor en los 3 Workers.
 *                              Este Worker también la USA para llamar a cacusa-lovers-webhook
 *                              (GET /internal/lovers/active) al emitir un código de
 *                              referido, para confirmar que el teléfono es de una
 *                              suscriptora activa antes de generar el cupón.
 *   ALLOWED_ORIGIN   (text)    https://cacusabytaitus.com  (opcional)
 *   VAPID_PUBLIC_KEY      (text)    llave pública VAPID (mismo valor que VAPID_PUB_KEY
 *                                   en ui_kits/admin/index.html) — Web Push nativo de Safari
 *   VAPID_PRIVATE_KEY_JWK (secret)  JWK privado del mismo par de llaves VAPID, en JSON
 *
 * KV Namespace (Cloudflare → Settings → Bindings):
 *   CACUSA_KV  — almacena pedidos de forma privada (no expuesto en GitHub Pages)
 */

const GH_OWNER  = 'robingonzalez-ux';
const GH_REPO   = 'cacusa';
const PRODUCTS_PATH = 'data/products.json';
const ORDERS_PATH   = 'data/orders.json'; // solo se usa como identificador desde el admin
const SESSION_HOURS = 12;

const ORIGIN_ALLOWLIST = [
  'https://cacusabytaitus.com',
  'https://www.cacusabytaitus.com'
];

// Origen del POS (app aparte, GitHub Pages) — solo puede usar rutas explícitamente marcadas
const POS_ORIGIN = 'https://robingonzalez-ux.github.io';

export default {
  async fetch(request, env, ctx) {
    const origin      = request.headers.get('Origin') || '';
    const allowOrigin = (ORIGIN_ALLOWLIST.includes(origin) || origin === POS_ORIGIN) ? origin : (env.ALLOWED_ORIGIN || ORIGIN_ALLOWLIST[0]);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(allowOrigin) });
    if (request.method !== 'POST') return err('Method not allowed', 405, allowOrigin);

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    let body;
    try { body = await request.json(); } catch { return err('JSON inválido', 400, allowOrigin); }

    try {
      // WebAuthn — antes de /login porque '/webauthn/login'.endsWith('/login') es true
      if (path.endsWith('/webauthn/login-challenge')) return await handleWaLoginChallenge(body, env, allowOrigin);
      if (path.endsWith('/webauthn/login'))           return await handleWaLogin(body, env, allowOrigin);
      if (path.endsWith('/webauthn/reg-challenge'))   return await handleWaRegChallenge(body, env, allowOrigin);
      if (path.endsWith('/webauthn/register'))        return await handleWaRegister(body, env, allowOrigin);

      if (path.endsWith('/login')) return await handleLogin(body, env, allowOrigin, request);

      // /order: guarda pedido desde la tienda (sin token de admin), o desde cacusa-square
      // (con ORDER_INGEST_KEY) una vez que el webhook de Square confirmó el pago.
      if (path.endsWith('/order')) {
        if (!ORIGIN_ALLOWLIST.includes(origin) && !isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleOrder(body, env, allowOrigin, ctx, request);
      }

      // Gift cards — endpoints públicos (origin-restringidos) para la tienda
      if (path.endsWith('/giftcard/validate')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleGcValidate(body, env, allowOrigin, request);
      }
      if (path.endsWith('/giftcard/redeem')) {
        // Solo Workers internos ya autenticados (cacusa-square, tras confirmar el pago con
        // webhook firmado). Ya NO acepta llamadas directas del navegador — redimir una gift
        // card desde Zelle/WhatsApp ahora ocurre server-side dentro de handleOrder(), atado
        // siempre a un pedido real, en vez de como una llamada pública sin ninguna verificación.
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleGcRedeem(body, env, allowOrigin, request);
      }

      // Surcharges y markets — lectura pública (origin-restringida, sin token).
      // /pub/surcharges también la llama cacusa-square servidor-a-servidor (para cobrar en
      // Square el mismo precio con recargo que la tienda le mostró al cliente) — el fetch()
      // de un Worker no puede fijar el header Origin (es un header prohibido por el estándar
      // Fetch), así que esa llamada se autentica con ORDER_INGEST_KEY en su lugar.
      if (path.endsWith('/pub/surcharges')) {
        if (!ORIGIN_ALLOWLIST.includes(origin) && !isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleSurchargesLoad(env, allowOrigin);
      }
      if (path.endsWith('/pub/markets')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleMarketsLoad(env, allowOrigin);
      }

      // Square — proxy para el POS (Square no responde CORS a navegadores)
      if (path.endsWith('/square/locations')) {
        if (origin !== POS_ORIGIN) return err('No permitido', 403, allowOrigin);
        return await handleSquareLocations(body, env, allowOrigin, request);
      }
      if (path.endsWith('/square/payment-link')) {
        if (origin !== POS_ORIGIN) return err('No permitido', 403, allowOrigin);
        return await handleSquarePaymentLink(body, env, allowOrigin, request);
      }

      // Leads del 10% / carrito iniciado — registro público
      if (path.endsWith('/lead/register')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleLeadRegister(body, env, allowOrigin, request, ctx);
      }

      // Referidos — genera (o recupera) el código de descuento de una clienta que quiere
      // invitar a una amiga. Pública, origin-restringida + rate-limit. Reusa el sistema de
      // cupones existente (couponKey/couponGet), pero con reglas fijas (no elegidas por quien
      // llama) para que no se pueda abusar como si fuera /coupon/create.
      if (path.endsWith('/referral/code')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleReferralCode(body, env, allowOrigin, request);
      }

      // Cupones — validación pública (origin-restringida, rate-limited)
      if (path.endsWith('/coupon/validate')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleCouponValidate(body, env, allowOrigin, request);
      }
      // Cupones — quema al completar un pedido (origin-restringida, o desde cacusa-square
      // ya autenticado con ORDER_INGEST_KEY tras confirmar el pago)
      if (path.endsWith('/coupon/burn')) {
        if (!ORIGIN_ALLOWLIST.includes(origin) && !isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleCouponBurnPublic(body, env, allowOrigin, request);
      }

      // Notificación push disparada desde OTRO Worker (hoy: cacusa-lovers-webhook, cuando
      // nace una suscriptora nueva) — autenticada con el mismo ORDER_INGEST_KEY compartido,
      // no con un token de sesión de admin (este Worker no tiene sesión iniciada).
      if (path.endsWith('/push/notify')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        if (!env.VAPID_PRIVATE_KEY_JWK) return ok({ error: 'VAPID_PRIVATE_KEY_JWK no configurado' }, allowOrigin);
        const title = (body.title || 'CACUSA').toString().slice(0, 100);
        const text  = (body.body  || '').toString().slice(0, 200);
        const url   = (body.url   || 'https://cacusabytaitus.com/ui_kits/admin/').toString().slice(0, 300);
        const stats = await sendWebPushAll(env, { title, body: text, url });
        return ok({ ok: true, ...stats }, allowOrigin);
      }

      // Rutas protegidas con token de sesión
      const session = await verifyToken(body.token, env);
      if (!session) return err('Sesión inválida o expirada. Inicia sesión de nuevo.', 401, allowOrigin);

      if (path.endsWith('/test-ntfy')) {
        if (!env.NTFY_TOPIC) return ok({ error: 'NTFY_TOPIC no configurado' }, allowOrigin);
        try {
          const r = await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
            method: 'POST',
            headers: { 'Title': 'Test Worker→ntfy', 'Content-Type': 'text/plain' },
            body: 'Prueba directa desde Worker'
          });
          const txt = await r.text();
          return ok({ status: r.status, ok: r.ok, topic: env.NTFY_TOPIC, response: txt.slice(0, 200) }, allowOrigin);
        } catch (e) {
          return ok({ error: e.message }, allowOrigin);
        }
      }
      if (path.endsWith('/load'))           return await handleLoad(env, allowOrigin);
      if (path.endsWith('/surcharge/save')) return await handleSurchargeSave(body, env, allowOrigin);
      if (path.endsWith('/market/save'))    return await handleMarketSave(body, env, allowOrigin);
      if (path.endsWith('/save'))           return await handleSave(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/order/manual'))   return await handleOrderManual(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/order/update'))   return await handleOrderUpdate(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/upload'))    return await handleUpload(body, env, allowOrigin, session);
      if (path.endsWith('/giftcard/create'))     return await handleGcCreate(body, env, allowOrigin, session);
      if (path.endsWith('/giftcard/list'))       return await handleGcList(env, allowOrigin);
      if (path.endsWith('/giftcard/deactivate')) return await handleGcDeactivate(body, env, allowOrigin);
      if (path.endsWith('/giftcard/adjust'))     return await handleGcAdjust(body, env, allowOrigin);
      if (path.endsWith('/coupon/create'))     return await handleCouponCreate(body, env, allowOrigin, session);
      if (path.endsWith('/coupon/list'))       return await handleCouponList(env, allowOrigin);
      if (path.endsWith('/coupon/deactivate')) return await handleCouponDeactivate(body, env, allowOrigin);
      if (path.endsWith('/coupon/delete'))     return await handleCouponDelete(body, env, allowOrigin);
      if (path.endsWith('/coupon/use'))        return await handleCouponUse(body, env, allowOrigin);
      if (path.endsWith('/lead/list'))         return await handleLeadList(env, allowOrigin);
      if (path.endsWith('/ntfy-info')) {
        if (!env.NTFY_TOPIC) return ok({ configured: false }, allowOrigin);
        return ok({ configured: true, topic: env.NTFY_TOPIC, url: 'https://ntfy.sh/' + env.NTFY_TOPIC }, allowOrigin);
      }
      if (path.endsWith('/push/subscribe'))   return await handlePushSubscribe(body, env, allowOrigin, session);
      if (path.endsWith('/push/unsubscribe')) return await handlePushUnsubscribe(body, env, allowOrigin, session);
      if (path.endsWith('/push/test')) {
        if (!env.VAPID_PRIVATE_KEY_JWK) return ok({ error: 'VAPID_PRIVATE_KEY_JWK no configurado' }, allowOrigin);
        const stats = await sendWebPushAll(env, {
          title: 'CACUSA · Notificación de prueba',
          body:  'Si ves esto, las notificaciones están funcionando ✅',
          url:   'https://cacusabytaitus.com/ui_kits/admin/',
        });
        return ok({ ok: true, ...stats }, allowOrigin);
      }
      return err('Ruta no encontrada', 404, allowOrigin);
    } catch (e) {
      console.error('Worker error:', e);
      return err('Error del servidor. Intenta de nuevo más tarde.', 500, allowOrigin);
    }
  }
};

// ── Auth ──────────────────────────────────────────────────────────────────────
function passwordFor(user, env) {
  return { 'tita.jaramillo': env.PASS_TITA, 'robin.gonzalez': env.PASS_ROBIN }[user];
}

// Llamada servidor-a-servidor confiable (hoy solo cacusa-square, tras confirmar un pago
// por webhook) — reemplaza la verificación de Origin, que no aplica a este tipo de llamada.
function isInternalIngest(request, env) {
  return !!env.ORDER_INGEST_KEY && safeEqual(request.headers.get('x-order-ingest-key') || '', env.ORDER_INGEST_KEY);
}

async function handleLogin(body, env, origin, request) {
  if (env.CACUSA_KV) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `loginrl:${ip}`;
    const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
    if (rlCount >= 5) return err('Demasiados intentos fallidos. Intenta en una hora.', 429, origin);
  }
  const user     = (body.user || '').trim();
  const pass     = body.pass || '';
  const expected = passwordFor(user, env);
  if (!expected || !safeEqual(pass, expected)) {
    if (env.CACUSA_KV) {
      const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
      const rlKey = `loginrl:${ip}`;
      const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
      await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
    }
    return err('Usuario o contraseña incorrectos.', 401, origin);
  }
  const token = await signToken({ user, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }, env);
  return ok({ token, user }, origin);
}

// ── Data ───────────────────────────────────────────────────────────────────────
async function handleLoad(env, origin) {
  const products = await ghGetContent(PRODUCTS_PATH, env);

  // Pedidos: cada uno en su propia llave de KV (order:<id>) — ver refreshOrdersCache().
  // handleLoad solo lee la caché ya armada (orders_cache), nunca escanea todo en cada
  // poll (el panel llama /load cada 30s + en cada focus).
  let ordersText = null;
  if (env.CACUSA_KV) {
    await migrateLegacyOrdersIfNeeded(env);
    ordersText = await env.CACUSA_KV.get('orders_cache');
    if (!ordersText) ordersText = JSON.stringify(await refreshOrdersCache(env));
  }

  return ok({ products: products ? products.text : null, orders: ordersText }, origin);
}

async function notifyNgrokSyncFailure(err, env) {
  if (!env.CACUSA_KV) return;
  const alertKey = 'ngroksync:lastalert';
  if (await env.CACUSA_KV.get(alertKey)) return; // ya avisamos hace poco, no repetir en cada guardado
  await env.CACUSA_KV.put(alertKey, '1', { expirationTtl: 6 * 3600 });
  await sendWebPushAll(env, {
    title: 'CACUSA · Falló la sincronización con Excel/POS',
    body:  `El servidor local (ngrok) no respondió: ${err.message}. Revisa que siga corriendo — no vas a recibir otro aviso por 6h aunque siga fallando.`,
    url:   'https://cacusabytaitus.com/ui_kits/admin/',
  }).catch(() => {});
}

async function handleSave(body, env, origin, session, ctx) {
  const { path, content, message } = body;
  if (path !== PRODUCTS_PATH && path !== ORDERS_PATH) return err('Ruta no permitida', 403, origin);
  if (typeof content !== 'string') return err('Contenido inválido', 400, origin);

  // Pedidos: ya no se guardan acá. Antes esto sobreescribía TODO el blob de pedidos con
  // lo que tuviera cargado el navegador — si un pedido nuevo entraba mientras alguien
  // editaba otro pedido en el panel, el nuevo se perdía en silencio. Ahora cada pedido
  // vive en su propia llave (ver handleOrder/handleOrderUpdate/handleOrderManual) y esta
  // ruta queda como no-op, solo para no romper a un panel viejo que siga cacheado en
  // algún navegador durante la ventana de despliegue.
  if (path === ORDERS_PATH) {
    console.warn('POST /save con path=orders.json ignorado (ruta legada) — usuario:', session.user);
    return ok({ ok: true }, origin);
  }

  const cur = await ghGetContent(path, env);
  const res = await ghPut(path, b64encode(content), cur ? cur.sha : null, message || `[admin] ${session.user}`, env);

  // Notificar al servidor local (ngrok) para sincronizar Excel + POS — fire-and-forget,
  // pero avisa por push si falla. Antes esto se tragaba cualquier error en silencio: si
  // el túnel de ngrok gratis cambiaba de URL (pasa en cada reinicio del túnel, a menos
  // que se use un dominio fijo), la sincronización se detenía sin que nadie se enterara
  // hasta notar el POS desactualizado — justo lo que pasó. Cooldown de 6h entre alertas
  // (vía CACUSA_KV) para no saturar de notificaciones si el túnel queda caído varios días.
  if (ctx) {
    ctx.waitUntil(
      fetch('https://upfront-yearbook-fascism.ngrok-free.dev/sync-admin-productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ trigger: 'admin-publish', user: session.user }),
        signal: AbortSignal.timeout(8000)
      })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); })
        .catch(e => notifyNgrokSyncFailure(e, env))
    );
  }

  return ok({ ok: true, sha: res.content && res.content.sha }, origin);
}

async function handleUpload(body, env, origin, session) {
  const { path, contentBase64, message } = body;
  if (!/^ui_kits\/store\/images\/[\w.\-]+\.(jpg|jpeg|png|webp)$/i.test(path || '')) {
    return err('Ruta de imagen no permitida', 403, origin);
  }
  if (typeof contentBase64 !== 'string' || contentBase64.length > 8_000_000) {
    return err('Imagen inválida o muy grande', 400, origin);
  }
  const cur = await ghGetContent(path, env);
  await ghPut(path, contentBase64, cur ? cur.sha : null, message || `[admin] imagen ${session.user}`, env);
  return ok({ ok: true, url: `https://${GH_OWNER}.github.io/${GH_REPO}/${path}` }, origin);
}

// Sanea un pedido crudo a solo los campos permitidos (nunca spread del body del
// cliente). strictPago=true (checkout público / webhook de Square, ninguno de los
// dos es un origen confiable para elegir texto libre) solo deja pasar
// Zelle/WhatsApp/Tarjeta y colapsa cualquier otra cosa a "Otro". strictPago=false
// (alta manual desde el admin, ya autenticado con sesión) deja el método de pago tal
// cual lo eligió Tita/Robin en el modal (acotado a 40 caracteres) — el modal ofrece
// opciones reales (PayPal, efectivo, etc.) que no tiene sentido colapsar a "Otro".
function buildOrderCore(order, { strictPago }) {
  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const num = (v) => typeof v === 'number' && isFinite(v) ? v : 0;
  const cliente = order.cliente || {};
  return {
    id:        Date.now(),
    fecha:     new Date().toISOString(),
    numero:    str(order.numero, 30) || undefined,
    estado:    'Nuevo',
    pago:      strictPago
      ? (['Zelle', 'WhatsApp', 'Tarjeta'].includes(order.pago) ? order.pago : 'Otro')
      : (str(order.pago, 40) || 'Otro'),
    total:     num(order.total),
    subtotal:  num(order.subtotal),
    envio:     num(order.envio),
    impuesto:  num(order.impuesto),
    notas:     str(order.notas, 500) || undefined,
    cliente: {
      nombre:    str(cliente.nombre,   100),
      apellido:  str(cliente.apellido, 100),
      email:     str(cliente.email,     150),
      telefono:  str(cliente.telefono,  30),
      direccion: str(cliente.direccion, 200),
      apto:      str(cliente.apto,       40),
      ciudad:    str(cliente.ciudad,    100),
      estado:    str(cliente.estado,     50),
      zip:       str(cliente.zip,        20),
      pais:      str(cliente.pais,       10),
      notas:     str(cliente.notas,     500),
    },
    productos: (Array.isArray(order.productos) ? order.productos : []).slice(0, 50).map(p => ({
      id:              str(p.id,   50),
      name:            str(p.name || p.nombre, 150),
      price:           num(p.price || p.precio),
      qty:             typeof p.qty === 'number' ? Math.max(1, Math.floor(p.qty)) : 1,
      personalization: str(p.personalization, 300),
    })),
  };
}

function orderKey(id) { return 'order:' + String(id); }
async function orderGet(env, id) {
  const raw = await env.CACUSA_KV.get(orderKey(id));
  return raw ? JSON.parse(raw) : null;
}
// Reconstruye la lista completa de pedidos a partir de sus llaves individuales
// (mismo patrón que handleGcList/handleCouponList) y la deja lista para que
// handleLoad() la sirva con un solo GET, en vez de escanear todo en cada poll del
// panel (cada 30s + en cada focus). Se llama después de CADA escritura a una llave
// order:<id> — nunca lee esta caché para modificarla, siempre recalcula el estado
// real completo, así que dos escrituras cruzándose en el tiempo nunca la corrompen:
// en el peor caso queda unos milisegundos atrasada, nunca con datos perdidos.
async function listAllOrders(env) {
  const orders = [];
  let cursor;
  do {
    const page = await env.CACUSA_KV.list({ prefix: 'order:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.CACUSA_KV.get(k.name);
      if (raw) { try { orders.push(JSON.parse(raw)); } catch (_) {} }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  orders.sort((a, b) => (b.id || 0) - (a.id || 0));
  return orders;
}
async function refreshOrdersCache(env) {
  const orders = await listAllOrders(env);
  const data = { version: '1.0', lastUpdated: new Date().toISOString(), orders };
  await env.CACUSA_KV.put('orders_cache', JSON.stringify(data));
  return data;
}
// Migración única e idempotente del blob legado `orders` (un solo JSON con todos los
// pedidos) al esquema de una llave por pedido. Se dispara EXCLUSIVAMENTE por la
// ausencia de la llave `orders:migrated` — nunca por "¿ya existen llaves order:*?",
// porque un solo pedido nuevo entrando entre el deploy y el primer /load ya crearía
// una llave order:* y esa condición dejaría el split sin correr nunca, perdiendo de
// vista todo el historial. Es segura ante llamadas concurrentes: ambas leerían el
// mismo blob legado (ya congelado, ver handleSave) y escribirían el mismo resultado.
async function migrateLegacyOrdersIfNeeded(env) {
  if (await env.CACUSA_KV.get('orders:migrated')) return;
  const legacyRaw = await env.CACUSA_KV.get('orders');
  if (legacyRaw) {
    let legacy;
    try { legacy = JSON.parse(legacyRaw); } catch (_) { legacy = null; }
    if (legacy && Array.isArray(legacy.orders)) {
      for (const o of legacy.orders) {
        if (o && o.id != null) await env.CACUSA_KV.put(orderKey(o.id), JSON.stringify(o));
      }
    }
  }
  await env.CACUSA_KV.put('orders:migrated', '1');
  await refreshOrdersCache(env);
}

// ── Pedido desde tienda (o desde cacusa-square, ya confirmado por Square) ────
async function handleOrder(body, env, origin, ctx, request) {
  const { order } = body;
  if (!order || !order.cliente || !Array.isArray(order.productos)) {
    return err('Pedido inválido', 400, origin);
  }

  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);

  const trusted = isInternalIngest(request, env);

  // Rate limiting: máx 5 pedidos por IP por hora — solo aplica a pedidos públicos
  // (WhatsApp/Zelle desde el navegador). Los que llegan ya confirmados por el webhook
  // de Square vienen autenticados con ORDER_INGEST_KEY, no anónimos, y no deben
  // competir por el mismo límite (la IP que ve este Worker en ese caso es la de
  // cacusa-square, compartida entre todos los pagos con tarjeta del día).
  if (!trusted) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `rl:${ip}`;
    const rlRaw = await env.CACUSA_KV.get(rlKey);
    const rlCount = rlRaw ? parseInt(rlRaw) : 0;
    if (rlCount >= 5) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
    await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }

  const num = (v) => typeof v === 'number' && isFinite(v) ? v : 0;
  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const newOrder = buildOrderCore(order, { strictPago: true });

  // Redención de gift card — fusionada acá (en vez de ser una llamada pública separada a
  // /giftcard/redeem, ver hallazgo de seguridad) para que nunca se pueda vaciar una tarjeta
  // sin que exista un pedido real registrado. El monto nunca puede exceder ni el saldo real
  // de la tarjeta (lo garantiza gcRedeem) ni el total de ESTE pedido (lo garantizamos acá).
  const gcCodeReq   = str(order.giftcard && order.giftcard.code, 40);
  const gcAmountReq = num(order.giftcard && order.giftcard.amount);
  if (gcCodeReq && gcAmountReq > 0 && env.CACUSA_KV) {
    const cappedAmount = Math.min(gcAmountReq, newOrder.total);
    if (cappedAmount > 0) {
      const giftcardResult = await gcRedeem(env, gcCodeReq, cappedAmount);
      if (giftcardResult.applied > 0) {
        newOrder.giftcard = { code: gcCodeReq, applied: giftcardResult.applied };
      }
    }
  }

  // Cada pedido en su propia llave — nunca se lee ni se escribe un blob compartido, así
  // que un pedido nuevo jamás puede pisar ni perder a otro pedido concurrente (ver
  // auditoría de concurrencia). La lista que consume el panel se recalcula aparte.
  await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));

  if (env.NTFY_TOPIC) {
    await sendNtfy(newOrder, env);
  }
  if (env.VAPID_PRIVATE_KEY_JWK) {
    const icon = newOrder.pago === 'WhatsApp' ? '📱' : '💳';
    await sendWebPushAll(env, {
      title: 'CACUSA · Nuevo pedido',
      body:  `${icon} ${newOrder.pago} · ${newOrder.cliente?.nombre || 'Cliente'} · $${newOrder.total}`,
      url:   'https://cacusabytaitus.com/ui_kits/admin/',
    });
    if (ctx) ctx.waitUntil(checkAbandonedCarts(env).catch(() => {}));
  }

  return ok({ ok: true, id: newOrder.id }, origin);
}

// ── Alta manual de un pedido desde el admin (Zelle/transferencia/efectivo ya
// confirmados fuera de línea) — autenticada por sesión, no por rate-limit de IP
// pública (Tita/Robin pueden cargar varios seguidos sin toparse con el límite de
// /order). No pasa por redención de gift card: los pedidos manuales no la usan hoy.
async function handleOrderManual(body, env, origin, session, ctx) {
  const { order } = body;
  if (!order || !order.cliente) return err('Pedido inválido', 400, origin);
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);

  const newOrder = buildOrderCore(order, { strictPago: false });
  newOrder.createdBy = session.user;

  await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));

  return ok({ ok: true, order: newOrder }, origin);
}

// ── Editar o borrar UN pedido existente desde el admin (cambiar estado, agregar
// tracking/carrier, actualizar datos del cliente, o eliminarlo). Reemplaza el patrón
// viejo de reenviar el array completo de pedidos (saveOrdersNow) — acá se lee y se
// escribe solo la llave de ESE pedido puntual, así que nunca puede pisar ni perder a
// un pedido distinto. El allowlist de campos evita que un patch toque productos/total/
// giftcard de un pedido ya cerrado.
const ORDER_PATCH_FIELDS = new Set(['estado', 'tracking', 'carrier']);
const ORDER_CLIENTE_PATCH_FIELDS = ['nombre', 'apellido', 'email', 'telefono', 'direccion', 'apto', 'ciudad', 'estado', 'zip', 'pais', 'notas'];
async function handleOrderUpdate(body, env, origin, session, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.id;
  if (id == null) return err('Falta id', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);

  if (body.delete === true) {
    await env.CACUSA_KV.delete(orderKey(id));
    if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
    return ok({ ok: true, deleted: true }, origin);
  }

  const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'cliente' && v && typeof v === 'object') {
      order.cliente = order.cliente || {};
      for (const ck of ORDER_CLIENTE_PATCH_FIELDS) {
        if (ck in v) order.cliente[ck] = String(v[ck] ?? '').slice(0, 500);
      }
      continue;
    }
    if (ORDER_PATCH_FIELDS.has(k)) order[k] = String(v ?? '').slice(0, 200);
  }
  order.updatedAt = new Date().toISOString();
  order.updatedBy = session.user;

  await env.CACUSA_KV.put(orderKey(id), JSON.stringify(order));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  return ok({ ok: true, order }, origin);
}

// ── Square (proxy de solo-lectura para el POS — evita el bloqueo CORS de Square) ──
async function handleSquareLocations(body, env, origin, request) {
  const token = (body.access_token || '').toString().trim();
  if (!token) return err('Falta access_token', 400, origin);

  if (env.CACUSA_KV) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `sqlrl:${ip}`;
    const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
    if (rlCount >= 20) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
    await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }

  try {
    const r = await fetch('https://connect.squareup.com/v2/locations', {
      headers: { 'Authorization': `Bearer ${token}`, 'Square-Version': '2024-01-17' }
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data.errors || [{}])[0]?.detail || 'Token incorrecto';
      return ok({ ok: false, error: msg }, origin);
    }
    const locations = (data.locations || []).map(l => ({ id: l.id, name: l.name || '', status: l.status || '' }));
    return ok({ ok: true, locations }, origin);
  } catch (e) {
    return ok({ ok: false, error: e.message }, origin);
  }
}

async function handleSquarePaymentLink(body, env, origin, request) {
  const token          = (body.access_token || '').toString().trim();
  const locationId     = (body.location_id || '').toString().trim();
  const idempotencyKey = (body.idempotency_key || '').toString().trim().slice(0, 100);
  const name           = (body.name || '').toString().trim().slice(0, 200);
  const amountCents    = Math.round(Number(body.amount_cents));
  if (!token || !locationId || !idempotencyKey || !name || !(amountCents > 0)) {
    return err('Datos incompletos', 400, origin);
  }

  if (env.CACUSA_KV) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `sqprl:${ip}`;
    const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
    if (rlCount >= 20) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
    await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }

  try {
    const r = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Square-Version': '2024-01-17' },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        quick_pay: { name, price_money: { amount: amountCents, currency: 'USD' }, location_id: locationId }
      })
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data.errors || [{}])[0]?.detail || 'Error de Square';
      return ok({ ok: false, error: msg }, origin);
    }
    return ok({ ok: true, url: data.payment_link && data.payment_link.url }, origin);
  } catch (e) {
    return ok({ ok: false, error: e.message }, origin);
  }
}

// ── Gift Cards (almacenadas en KV, nunca accesibles desde el navegador) ──────
const GC_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sin caracteres ambiguos
function gcGenCode() {
  const seg = () => Array.from({ length: 4 }, () => GC_CHARSET[Math.floor(Math.random() * GC_CHARSET.length)]).join('');
  return `CACUSA-${seg()}-${seg()}`;
}
function gcKey(code) { return 'gc:' + String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''); }
async function gcGet(env, code) {
  const raw = await env.CACUSA_KV.get(gcKey(code));
  return raw ? JSON.parse(raw) : null;
}
// Deduce saldo de forma atómica-ish (KV no tiene CAS; volumen bajo lo hace seguro)
async function gcRedeem(env, code, amountWanted) {
  const card = await gcGet(env, code);
  if (!card || card.active === false || !(card.balance > 0)) return { applied: 0 };
  const applied = Math.min(Number(amountWanted) || 0, card.balance);
  if (!(applied > 0)) return { applied: 0 };
  card.balance = +(card.balance - applied).toFixed(2);
  card.active  = card.balance > 0;
  await env.CACUSA_KV.put(gcKey(code), JSON.stringify(card));
  return { applied, balance: card.balance };
}

async function handleGcCreate(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const amount = Number(body.amount);
  if (!(amount > 0) || amount > 100000) return err('Monto inválido', 400, origin);
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : '';
  let code, tries = 0;
  do { code = gcGenCode(); } while ((await env.CACUSA_KV.get(gcKey(code))) && ++tries < 8);
  const card = {
    code, amount: +amount.toFixed(2), balance: +amount.toFixed(2), active: true,
    createdAt: new Date().toISOString(), note, createdBy: session.user
  };
  await env.CACUSA_KV.put(gcKey(code), JSON.stringify(card));
  return ok({ ok: true, card }, origin);
}

async function handleGcList(env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const cards = [];
  let cursor;
  do {
    const res = await env.CACUSA_KV.list({ prefix: 'gc:', cursor });
    for (const k of res.keys) {
      const raw = await env.CACUSA_KV.get(k.name);
      if (raw) { try { cards.push(JSON.parse(raw)); } catch (_) {} }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  cards.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return ok({ cards }, origin);
}

async function handleGcDeactivate(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const card = await gcGet(env, body.code);
  if (!card) return err('Tarjeta no encontrada', 404, origin);
  card.active = false;
  await env.CACUSA_KV.put(gcKey(body.code), JSON.stringify(card));
  return ok({ ok: true, card }, origin);
}

// Registra el uso de una tarjeta tras confirmar el pago (admin manual)
async function handleGcAdjust(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const card = await gcGet(env, body.code);
  if (!card) return err('Tarjeta no encontrada', 404, origin);
  const used = Number(body.usedAmount);
  if (!(used > 0)) return err('Monto inválido', 400, origin);
  card.balance = +Math.max(0, card.balance - used).toFixed(2);
  card.active  = card.balance > 0;
  await env.CACUSA_KV.put(gcKey(body.code), JSON.stringify(card));
  return ok({ ok: true, card }, origin);
}

// Validación pública (solo lectura): la tienda confirma el código sin poder enumerar
async function handleGcValidate(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  // Rate limit por IP (15/hr)
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const ipKey = `gcvrl:ip:${ip}`;
  const ipCount = parseInt((await env.CACUSA_KV.get(ipKey)) || '0', 10);
  if (ipCount >= 15) return ok({ valid: false }, origin);
  await env.CACUSA_KV.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });
  // Rate limit por código: max 8 intentos fallidos/hr — silencioso para no revelar existencia del código
  const rawCode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!rawCode) return ok({ valid: false }, origin);
  const codeKey = `gcvrl:c:${rawCode}`;
  const codeCount = parseInt((await env.CACUSA_KV.get(codeKey)) || '0', 10);
  if (codeCount >= 8) return ok({ valid: false }, origin);
  const card = await gcGet(env, rawCode);
  const valid = !!(card && card.active !== false && card.balance > 0);
  if (!valid) await env.CACUSA_KV.put(codeKey, String(codeCount + 1), { expirationTtl: 3600 });
  if (!valid) return ok({ valid: false }, origin);
  return ok({ valid: true, balance: card.balance }, origin);
}

// Redención — pública para Zelle/WhatsApp (origin-restringida + rate-limit por IP),
// o interna desde cacusa-square (ORDER_INGEST_KEY) tras confirmar el pago con tarjeta.
async function handleGcRedeem(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  if (!isInternalIngest(request, env)) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `gcrl:${ip}`;
    const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
    if (rlCount >= 15) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
    await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }
  const r = await gcRedeem(env, body.code, body.amount);
  return ok(r, origin);
}

// ── Cupones ────────────────────────────────────────────────────────────────────
function couponKey(code) { return 'coupon:' + String(code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, ''); }
async function couponGet(env, code) {
  const raw = await env.CACUSA_KV.get(couponKey(code));
  return raw ? JSON.parse(raw) : null;
}
function couponIsValid(c) {
  if (!c || !c.active) return false;
  if (c.expiresAt && new Date(c.expiresAt + 'T23:59:59') < new Date()) return false;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return false;
  return true;
}

const LOVERS_WORKER_URL = 'https://cacusa-lovers-webhook.facturacioncacusa.workers.dev';

// ── Verifica contra cacusa-lovers-webhook (Worker-a-Worker, ORDER_INGEST_KEY) si un
// teléfono pertenece a una suscriptora activa de Cacusa Lovers. Falla cerrado: cualquier
// error de red o de configuración se trata como "no activa", nunca como "activa".
async function isActiveLoversPhone(phoneDigits, env) {
  if (!env.ORDER_INGEST_KEY) return false;
  try {
    const r = await fetch(`${LOVERS_WORKER_URL}/internal/lovers/active?phone=${encodeURIComponent(phoneDigits)}`, {
      headers: { 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
    });
    if (!r.ok) return false;
    const d = await r.json().catch(() => ({}));
    return !!d.active;
  } catch (e) {
    return false;
  }
}

// ── Límite de "1 regalo de referido por mes" — por código (= por suscriptora que
// refiere, ya que el código es 1:1 con su teléfono), sin importar quién lo use. Se
// consulta en /coupon/validate (para no dejar seguir a alguien que de todos modos no
// va a poder cobrar el descuento) y se marca en /coupon/burn (al confirmarse el pedido).
function referralMonthKey(code) {
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)
  return `refmonth:${code}:${ym}`;
}
async function referralMonthlyCapReached(env, code) {
  return !!(await env.CACUSA_KV.get(referralMonthKey(code)));
}
async function markReferralMonthlyUse(env, code) {
  // 40 días de margen: sobra para cubrir el mes que está marcando y se autolimpia solo.
  await env.CACUSA_KV.put(referralMonthKey(code), '1', { expirationTtl: 40 * 24 * 3600 });
}

// ── Referidos — "invita a una amiga" ────────────────────────────────────────────
// Genera (o recupera, si ya lo pidió antes) un cupón de referido para una clienta, sin
// necesitar sesión de admin. Exclusivo para suscriptoras activas de Cacusa Lovers —
// se verifica el teléfono contra Firebase (vía cacusa-lovers-webhook) antes de emitir
// nada, para que el beneficio no quede abierto a cualquier visitante del sitio.
// Reglas fijas y no elegibles por quien llama (10% para la amiga referida, máximo 1
// regalo de referido por mes por código — ver referralMonthlyCapReached más abajo) —
// a diferencia de /coupon/create (que sí permite elegir tipo/monto), esta ruta es
// pública, así que nunca deja que el llamador defina el descuento.
// El código es determinístico a partir del teléfono, así pedirlo dos veces no crea 2 cupones.
async function handleReferralCode(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `refrl:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= 10) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  const name = String(body.name || '').trim().slice(0, 100);
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  if (!name || phoneDigits.length < 7) {
    return err('Faltan nombre o teléfono válido', 400, origin);
  }
  if (!(await isActiveLoversPhone(phoneDigits, env))) {
    return err('Este beneficio es exclusivo para suscriptoras activas de Cacusa Lovers.', 403, origin);
  }
  const code = 'AMIGA' + phoneDigits.slice(-6);

  let coupon = await couponGet(env, code);
  if (!coupon) {
    coupon = {
      code, type: 'percent', amount: 10, kind: 'referral',
      maxUses: null, usedCount: 0, active: true, expiresAt: null,
      note: `Referido de ${name} (${body.phone ? String(body.phone).slice(0, 30) : ''})`,
      createdAt: new Date().toISOString(), createdBy: 'referral-system',
    };
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  } else if (coupon.createdBy === 'referral-system' && (coupon.amount !== 10 || coupon.kind !== 'referral')) {
    // Migra códigos generados antes de bajar a 10% / agregar el tope mensual.
    coupon.amount = 10;
    coupon.kind = 'referral';
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  }
  return ok({ ok: true, code: coupon.code, type: coupon.type, amount: coupon.amount }, origin);
}

async function handleCouponValidate(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  // Rate limit por IP (20/hr)
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const ipKey = `cprl:${ip}`;
  const ipCount = parseInt((await env.CACUSA_KV.get(ipKey)) || '0', 10);
  if (ipCount >= 20) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
  await env.CACUSA_KV.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });
  // Rate limit por código: max 8 intentos fallidos/hr — silencioso
  const rawCode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!rawCode) return ok({ valid: false }, origin);
  // Bloquear si teléfono o email ya usó este cupón
  const rawPhone = String(body.phone || '').replace(/\D/g, '').slice(0, 20);
  if (rawPhone.length >= 7 && await env.CACUSA_KV.get(`cpused:ph:${rawPhone}:${rawCode}`)) return ok({ valid: false }, origin);
  const rawEmail = String(body.email || '').toLowerCase().trim().slice(0, 100);
  if (rawEmail.includes('@') && await env.CACUSA_KV.get(`cpused:em:${rawEmail}:${rawCode}`)) return ok({ valid: false }, origin);
  const codeKey = `cpvrl:c:${rawCode}`;
  const codeCount = parseInt((await env.CACUSA_KV.get(codeKey)) || '0', 10);
  if (codeCount >= 8) return ok({ valid: false }, origin);
  const coupon = await couponGet(env, rawCode);
  let valid = couponIsValid(coupon);
  // Cupones de referido: máximo 1 regalo por mes por código, sin importar quién lo use.
  if (valid && coupon.kind === 'referral' && await referralMonthlyCapReached(env, rawCode)) valid = false;
  if (!valid) await env.CACUSA_KV.put(codeKey, String(codeCount + 1), { expirationTtl: 3600 });
  if (!valid) return ok({ valid: false }, origin);
  return ok({ valid: true, code: coupon.code, type: coupon.type, amount: coupon.amount }, origin);
}

async function handleSurchargesLoad(env, origin) {
  if (!env.CACUSA_KV) return ok({ surcharges: {} }, origin);
  const raw = await env.CACUSA_KV.get('surcharges');
  let surcharges = {};
  if (raw) try { surcharges = JSON.parse(raw); } catch {}
  return ok({ surcharges }, origin);
}

async function handleMarketsLoad(env, origin) {
  if (!env.CACUSA_KV) return ok({ markets: {} }, origin);
  const raw = await env.CACUSA_KV.get('markets');
  let markets = {};
  if (raw) try { markets = JSON.parse(raw); } catch {}
  return ok({ markets }, origin);
}

async function handleSurchargeSave(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const src = body.surcharges;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return err('Datos inválidos', 400, origin);
  const clean = {};
  for (const [k, v] of Object.entries(src)) clean[String(k).slice(0, 50)] = v === true;
  await env.CACUSA_KV.put('surcharges', JSON.stringify(clean));
  return ok({ ok: true }, origin);
}

async function handleMarketSave(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const src = body.markets;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return err('Datos inválidos', 400, origin);
  const valid = ['both', 'ec', 'us'];
  const clean = {};
  for (const [k, v] of Object.entries(src)) clean[String(k).slice(0, 50)] = valid.includes(v) ? v : 'both';
  await env.CACUSA_KV.put('markets', JSON.stringify(clean));
  return ok({ ok: true }, origin);
}

async function handleLeadRegister(body, env, origin, request, ctx) {
  if (!env.CACUSA_KV) return ok({ ok: true }, origin);
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `leadrl:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= 3) return ok({ ok: true }, origin);
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  const email = String(body.email || '').toLowerCase().trim().slice(0, 100);
  if (!email.includes('@')) return ok({ ok: true }, origin);
  const lang = body.lang === 'en' ? 'en' : 'es';
  const source = ['vignette', 'cart_checkout_start'].includes(body.source) ? body.source : undefined;
  const cart = Array.isArray(body.cart)
    ? body.cart.slice(0, 20).map(i => ({ name: String(i.name || '').slice(0, 150), price: (typeof i.price === 'number' && isFinite(i.price)) ? i.price : 0 }))
    : undefined;
  const total = (typeof body.total === 'number' && isFinite(body.total)) ? body.total : undefined;
  let data = { leads: [] };
  const existing = await env.CACUSA_KV.get('leads');
  if (existing) try { data = JSON.parse(existing); } catch {}
  if (!Array.isArray(data.leads)) data.leads = [];
  const already = data.leads.find(l => l.email === email);
  if (!already) {
    data.leads.unshift({ email, lang, date: new Date().toISOString(), source, cart, total, notified: false });
    data.lastUpdated = new Date().toISOString();
    await env.CACUSA_KV.put('leads', JSON.stringify(data));
  } else if (source === 'cart_checkout_start' && already.source !== 'cart_checkout_start') {
    // Ya era lead del 10% — si ahora llega al checkout con carrito, upgradeamos el registro
    // para que sí entre en la revisión de abandono (sin duplicar la entrada).
    already.source = source; already.cart = cart; already.total = total;
    already.date = new Date().toISOString(); already.notified = false;
    data.lastUpdated = new Date().toISOString();
    await env.CACUSA_KV.put('leads', JSON.stringify(data));
  }
  if (ctx && env.VAPID_PRIVATE_KEY_JWK) ctx.waitUntil(checkAbandonedCarts(env).catch(() => {}));
  return ok({ ok: true }, origin);
}

// ── Recuperación real de carrito abandonado ──────────────────────────
// No hay Cron Trigger configurado para este Worker (requeriría wrangler.toml /
// panel de Cloudflare), así que este chequeo se dispara "de aprovechado" en
// cada /lead/register y /order — funciona igual de bien en un sitio con
// tráfico regular, pero no es un temporizador exacto: si no llega ningún
// request nuevo, el aviso espera al próximo. Para timing exacto haría falta
// agregar un Cron Trigger en Cloudflare → Workers → cacusa-admin → Triggers.
const ABANDON_MINUTES = 45;
async function checkAbandonedCarts(env) {
  if (!env.CACUSA_KV) return;
  const raw = await env.CACUSA_KV.get('leads');
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(data.leads)) return;

  const pending = data.leads.filter(l => l.source === 'cart_checkout_start' && !l.notified);
  if (!pending.length) return;

  const cutoff = Date.now() - ABANDON_MINUTES * 60 * 1000;
  const stale = pending.filter(l => new Date(l.date).getTime() <= cutoff);
  if (!stale.length) return;

  // Si ya hay un pedido de ese email posterior al lead, no fue abandono — se completó.
  let orderEmails = new Set();
  const ordersRaw = await env.CACUSA_KV.get('orders_cache');
  if (ordersRaw) {
    try {
      const od = JSON.parse(ordersRaw);
      if (Array.isArray(od.orders)) {
        orderEmails = new Set(od.orders.map(o => (o.cliente?.email || '').toLowerCase()).filter(Boolean));
      }
    } catch {}
  }

  let changed = false;
  for (const lead of stale) {
    lead.notified = true; // se marca sí o sí para no re-evaluarlo cada vez
    changed = true;
    if (orderEmails.has(lead.email)) continue; // compró — no es abandono real
    const itemNames = (lead.cart || []).map(i => i.name).filter(Boolean).slice(0, 3).join(', ');
    const totalTxt = typeof lead.total === 'number' ? ` · $${lead.total.toFixed(2)}` : '';
    await sendWebPushAll(env, {
      title: 'CACUSA · Carrito abandonado',
      body: `🛒 ${lead.email}${totalTxt}${itemNames ? ' — ' + itemNames : ''}`,
      url: 'https://cacusabytaitus.com/ui_kits/admin/',
    });
  }
  if (changed) {
    data.lastUpdated = new Date().toISOString();
    await env.CACUSA_KV.put('leads', JSON.stringify(data));
  }
}

async function handleLeadList(env, origin) {
  if (!env.CACUSA_KV) return ok({ leads: [] }, origin);
  const raw = await env.CACUSA_KV.get('leads');
  let data = { leads: [] };
  if (raw) try { data = JSON.parse(raw); } catch {}
  return ok({ leads: Array.isArray(data.leads) ? data.leads : [] }, origin);
}

// Se llama al confirmar un pedido — pública para WhatsApp/Zelle (origin-restringida),
// o interna desde cacusa-square (ORDER_INGEST_KEY) tras confirmar el pago con tarjeta.
async function handleCouponBurnPublic(body, env, origin, request) {
  if (!env.CACUSA_KV) return ok({ ok: true }, origin);
  // Rate limit por IP (15/hr) — igual que /giftcard/redeem, para que no se pueda agotar el
  // maxUses de un cupón ni bloquear el teléfono/email de una clienta real sin límite.
  if (!isInternalIngest(request, env)) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `cpburnrl:${ip}`;
    const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
    if (rlCount >= 15) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
    await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }
  const rawCode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!rawCode) return ok({ ok: true }, origin);
  // Registrar uso por teléfono y email (1 año)
  const rawPhone = String(body.phone || '').replace(/\D/g, '').slice(0, 20);
  if (rawPhone.length >= 7) await env.CACUSA_KV.put(`cpused:ph:${rawPhone}:${rawCode}`, '1', { expirationTtl: 31536000 });
  const rawEmail = String(body.email || '').toLowerCase().trim().slice(0, 100);
  if (rawEmail.includes('@')) await env.CACUSA_KV.put(`cpused:em:${rawEmail}:${rawCode}`, '1', { expirationTtl: 31536000 });
  // Incrementar usedCount del cupón
  const coupon = await couponGet(env, rawCode);
  if (coupon) {
    coupon.usedCount = (coupon.usedCount || 0) + 1;
    await env.CACUSA_KV.put(couponKey(rawCode), JSON.stringify(coupon));
    if (coupon.kind === 'referral') await markReferralMonthlyUse(env, rawCode);
  }
  return ok({ ok: true }, origin);
}

async function handleCouponCreate(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const code = (body.code || '').toString().trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length < 3 || code.length > 30) return err('Código inválido (3-30 chars, A-Z 0-9 - _)', 400, origin);
  const type = body.type === 'fixed' ? 'fixed' : 'percent';
  const amount = Number(body.amount);
  if (!(amount > 0)) return err('Monto inválido', 400, origin);
  if (type === 'percent' && amount > 100) return err('Porcentaje máximo: 100', 400, origin);
  const maxUses = (body.maxUses != null && body.maxUses !== '') ? Math.floor(Number(body.maxUses)) : null;
  const expiresAt = body.expiresAt ? String(body.expiresAt).slice(0, 10) : null;
  if (await env.CACUSA_KV.get(couponKey(code))) return err('Ya existe un cupón con ese código', 409, origin);
  const coupon = {
    code, type, amount: +amount.toFixed(2),
    maxUses: maxUses && maxUses > 0 ? maxUses : null,
    usedCount: 0, active: true,
    expiresAt: expiresAt || null,
    note: typeof body.note === 'string' ? body.note.slice(0, 200) : '',
    createdAt: new Date().toISOString(), createdBy: session.user
  };
  await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  return ok({ ok: true, coupon }, origin);
}

async function handleCouponList(env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const coupons = [];
  let cursor;
  do {
    const page = await env.CACUSA_KV.list({ prefix: 'coupon:', cursor, limit: 100 });
    for (const k of page.keys) {
      const raw = await env.CACUSA_KV.get(k.name);
      if (raw) try { coupons.push(JSON.parse(raw)); } catch {}
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  coupons.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return ok({ coupons }, origin);
}

async function handleCouponDeactivate(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const coupon = await couponGet(env, body.code);
  if (!coupon) return err('Cupón no encontrado', 404, origin);
  coupon.active = false;
  await env.CACUSA_KV.put(couponKey(body.code), JSON.stringify(coupon));
  return ok({ ok: true, coupon }, origin);
}

async function handleCouponDelete(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const coupon = await couponGet(env, body.code);
  if (!coupon) return err('Cupón no encontrado', 404, origin);
  await env.CACUSA_KV.delete(couponKey(body.code));
  return ok({ ok: true }, origin);
}

async function handleCouponUse(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const coupon = await couponGet(env, body.code);
  if (!coupon) return err('Cupón no encontrado', 404, origin);
  coupon.usedCount = (coupon.usedCount || 0) + 1;
  await env.CACUSA_KV.put(couponKey(body.code), JSON.stringify(coupon));
  return ok({ ok: true, coupon }, origin);
}

// ── Notificación ntfy ────────────────────────────────────────────────────────
async function sendNtfy(order, env) {
  const icon  = order.pago === 'WhatsApp' ? '📱' : '💳';
  const body  = `${icon} ${order.pago} · ${order.cliente?.nombre || 'Cliente'} · $${order.total}`;
  try {
    const r = await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
      method:  'POST',
      headers: {
        'Title':        'CACUSA · Nuevo pedido',
        'Priority':     'high',
        'Tags':         'bell,shopping',
        'Click':        'https://cacusabytaitus.com/ui_kits/admin/',
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body
    });
    if (!r.ok) console.error('ntfy status:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('ntfy error:', e.message);
  }
}

// ── Web Push nativo (Safari/iOS) ───────────────────────────────────────────────
// Firma un JWT VAPID (ES256) a mano con Web Crypto — sin librerías, igual de
// "pegar y listo" que el resto de este Worker.
async function vapidAuthHeader(endpoint, env) {
  const priv = JSON.parse(env.VAPID_PRIVATE_KEY_JWK);
  const key  = await crypto.subtle.importKey('jwk', { ...priv, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const aud    = new URL(endpoint).origin;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:facturacioncacusa@gmail.com'
  })));
  const unsigned = `${header}.${claims}`;
  // crypto.subtle ya devuelve la firma ECDSA en formato raw (r‖s), que es justo lo que pide JWS ES256.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(new Uint8Array(sig))}, k=${env.VAPID_PUBLIC_KEY}`;
}
// ── Cifrado del contenido (RFC 8291 aes128gcm) ─────────────────────────────────
// Sin esto, el navegador recibe el push "vacío" y el service worker solo puede
// mostrar el texto genérico por defecto. Con esto viaja el título/cuerpo reales
// (nombre del cliente, monto, etc.), cifrados de punta a punta con la llave
// pública que el propio navegador entregó al suscribirse — ni Apple ni nadie en
// el camino puede leer el contenido, solo el dispositivo dueño de la suscripción.
function concatBytes(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}
async function hkdfExpand(prk, info, length) {
  // length <= 32 (un solo bloque de HMAC-SHA256) — suficiente para todo lo que se deriva acá.
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = concatBytes(info, new Uint8Array([1]));
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig).slice(0, length);
}
async function encryptPushPayload(payloadBytes, p256dhB64, authB64) {
  const uaPublic    = b64urlDecode(p256dhB64); // 65 bytes, punto EC sin comprimir del navegador
  const authSecret  = b64urlDecode(authB64);   // 16 bytes

  const asKeyPair   = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret  = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256));

  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk  = await hkdfExtract(salt, ikm);

  const cek = await hkdfExpand(prk, concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concatBytes(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 = delimitador de "último registro" (RFC 8188) — el mensaje entero cabe en un solo registro.
  const plaintextWithDelim = concatBytes(payloadBytes, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintextWithDelim));

  // Header aes128gcm: salt(16) + record-size(4, big-endian) + keyid-len(1) + keyid(=asPublicRaw)
  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublicRaw.length;
  header.set(asPublicRaw, 21);

  return concatBytes(header, ciphertext);
}

async function sendWebPushOne(sub, env, payload) {
  const headers = { TTL: '86400', Authorization: await vapidAuthHeader(sub.endpoint, env) };
  let body;
  if (payload) {
    body = await encryptPushPayload(new TextEncoder().encode(JSON.stringify(payload)), sub.keys.p256dh, sub.keys.auth);
    headers['Content-Type']     = 'application/octet-stream';
    headers['Content-Encoding'] = 'aes128gcm';
    headers['Content-Length']   = String(body.length);
  } else {
    headers['Content-Length'] = '0';
  }
  return fetch(sub.endpoint, { method: 'POST', headers, body });
}
// Devuelve estadísticas del envío — sirve para que /push/test le diga al usuario si
// realmente hay suscripciones guardadas en vez de reportar éxito a ciegas.
async function sendWebPushAll(env, payload) {
  const list = await env.CACUSA_KV.list({ prefix: 'push:' });
  const stats = { total: list.keys.length, sent: 0, failed: 0, cleaned: 0 };
  for (const k of list.keys) {
    const raw = await env.CACUSA_KV.get(k.name);
    if (!raw) continue;
    try {
      const resp = await sendWebPushOne(JSON.parse(raw), env, payload);
      // 404/410 = la suscripción fue revocada o expiró del lado del navegador/Apple — limpiar.
      if (resp.status === 404 || resp.status === 410) { await env.CACUSA_KV.delete(k.name); stats.cleaned++; }
      else if (!resp.ok) { stats.failed++; console.error('webpush fail', k.name, resp.status, await resp.text().catch(() => '')); }
      else stats.sent++;
    } catch (e) {
      stats.failed++;
      console.error('webpush error', k.name, e.message);
    }
  }
  return stats;
}
async function pushKeyFor(username, endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  const hex  = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  return `push:${username}:${hex}`;
}
async function handlePushSubscribe(body, env, origin, session) {
  const sub = body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return err('Suscripción inválida', 400, origin);
  const key = await pushKeyFor(session.user, sub.endpoint);
  await env.CACUSA_KV.put(key, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }));
  return ok({ ok: true }, origin);
}
async function handlePushUnsubscribe(body, env, origin, session) {
  if (!body.endpoint) return err('Falta endpoint', 400, origin);
  const key = await pushKeyFor(session.user, body.endpoint);
  await env.CACUSA_KV.delete(key);
  return ok({ ok: true }, origin);
}

// ── GitHub ─────────────────────────────────────────────────────────────────────
function ghHeaders(env) {
  return {
    Authorization:  `token ${env.GH_TOKEN}`,
    Accept:         'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent':   'cacusa-admin-worker'
  };
}
async function ghGetContent(path, env) {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, { headers: ghHeaders(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub GET ' + r.status);
  const j = await r.json();
  return { sha: j.sha, text: b64decode(j.content) };
}
async function ghPut(path, base64content, sha, message, env) {
  const b = { message, content: base64content };
  if (sha) b.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(env), body: JSON.stringify(b)
  });
  if (!r.ok) throw new Error('GitHub PUT ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

// ── Token (HMAC-SHA256) ────────────────────────────────────────────────────────
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function signToken(payload, env) {
  const p   = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(p, env.SESSION_SECRET);
  return p + '.' + sig;
}
async function verifyToken(token, env) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const expected = await hmac(p, env.SESSION_SECRET);
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ── WebAuthn helpers ─────────────────────────────────────────────────────────────────────────
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function decodeCBOR(data) {
  if (!data.buffer) data = new Uint8Array(data);
  let pos = 0;
  function readUint(info) {
    if (info < 24) return info;
    if (info === 24) return data[pos++];
    if (info === 25) { const v = (data[pos] << 8) | data[pos+1]; pos += 2; return v; }
    if (info === 26) { const v = (data[pos]<<24|data[pos+1]<<16|data[pos+2]<<8|data[pos+3])>>>0; pos += 4; return v; }
    throw new Error('CBOR: unsupported len ' + info);
  }
  function next() {
    const b = data[pos++], t = b >> 5, i = b & 0x1f, n = readUint(i);
    if (t === 0) return n;
    if (t === 1) return -1 - n;
    if (t === 2) { const s = data.slice(pos, pos+n); pos += n; return s; }
    if (t === 3) { const s = new TextDecoder().decode(data.slice(pos, pos+n)); pos += n; return s; }
    if (t === 4) { const a = []; for (let k = 0; k < n; k++) a.push(next()); return a; }
    if (t === 5) { const m = {}; for (let k = 0; k < n; k++) { const key = next(); m[key] = next(); } return m; }
    if (t === 7) { if (i === 20) return false; if (i === 21) return true; if (i === 22) return null; }
    throw new Error('CBOR: type ' + t);
  }
  return next();
}

async function importCOSEKey(coseBytes) {
  const k = decodeCBOR(coseBytes);
  if (k[3] === -7) { // ES256 / P-256
    const raw = new Uint8Array(65);
    raw[0] = 0x04; raw.set(k[-2], 1); raw.set(k[-3], 33);
    return crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
  if (k[3] === -257) { // RS256
    return crypto.subtle.importKey('jwk',
      { kty: 'RSA', alg: 'RS256', ext: true, n: b64url(k[-1]), e: b64url(k[-2]) },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }
  throw new Error('COSE alg ' + k[3] + ' no soportado');
}

function derToP1363(der) {
  // iOS/Android devuelven firmas ECDSA en DER; Web Crypto necesita P1363 (r‖s, 64 bytes)
  let p = 2;
  if (der[1] & 0x80) p += der[1] & 0x7f; // longitud en forma larga
  if (der[p] !== 0x02) throw new Error('DER: esperaba INTEGER r');
  p++;
  const rLen = der[p++]; let r = der.slice(p, p + rLen); p += rLen;
  if (der[p] !== 0x02) throw new Error('DER: esperaba INTEGER s');
  p++;
  const sLen = der[p++]; let s = der.slice(p, p + sLen);
  while (r.length > 32 && r[0] === 0) r = r.slice(1);
  while (s.length > 32 && s[0] === 0) s = s.slice(1);
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length); out.set(s, 64 - s.length);
  return out;
}

async function verifyWebAuthnSig(authData, cdBytes, sigBytes, pubKey) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', cdBytes));
  const buf = new Uint8Array(authData.length + 32);
  buf.set(authData); buf.set(hash, authData.length);
  // Convertir DER → P1363 si es ECDSA (iOS/Android envían DER, Web Crypto espera P1363)
  const sig = (pubKey.algorithm.name === 'ECDSA' && sigBytes[0] === 0x30)
    ? derToP1363(sigBytes) : sigBytes;
  const alg = pubKey.algorithm.name === 'ECDSA'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' };
  return crypto.subtle.verify(alg, pubKey, sig, buf);
}

// ── WebAuthn routes ─────────────────────────────────────────────────────────────────────────
const WA_RP_ID   = 'cacusabytaitus.com';
const WA_RP_NAME = 'CACUSA Admin';
const WA_USERS   = ['robin.gonzalez', 'tita.jaramillo'];

async function handleWaRegChallenge(body, env, origin) {
  const session = await verifyToken(body.token, env);
  if (!session) return err('Sesión inválida', 401, origin);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.CACUSA_KV.put(`wac:${challenge}`, session.user, { expirationTtl: 300 });
  const existing = await env.CACUSA_KV.get(`wacred:${session.user}`);
  const excludeIds = existing ? [JSON.parse(existing).credentialId] : [];
  return ok({ challenge, rpId: WA_RP_ID, rpName: WA_RP_NAME, userId: session.user, excludeIds }, origin);
}

async function handleWaRegister(body, env, origin) {
  const session = await verifyToken(body.token, env);
  if (!session) return err('Sesión inválida', 401, origin);
  const { challenge, credentialId, attestationObject, clientDataJSON } = body;
  if (!challenge || !credentialId || !attestationObject || !clientDataJSON) return err('Datos incompletos', 400, origin);
  const user = await env.CACUSA_KV.get(`wac:${challenge}`);
  if (!user || user !== session.user) return err('Challenge inválido', 400, origin);
  await env.CACUSA_KV.delete(`wac:${challenge}`);
  const cdBytes = b64urlDecode(clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(cdBytes));
  if (cd.type !== 'webauthn.create' || cd.challenge !== challenge) return err('clientData inválido', 400, origin);
  const attObj = decodeCBOR(b64urlDecode(attestationObject));
  const authData = attObj.authData;
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(WA_RP_ID)));
  if (!arraysEqual(authData.slice(0, 32), rpHash)) return err('rpId no coincide', 400, origin);
  if (!(authData[32] & 0x40)) return err('Sin datos de credencial atestiguada', 400, origin);
  const credIdLen = (authData[53] << 8) | authData[54];
  const coseKey   = authData.slice(55 + credIdLen);
  const signCount = (authData[33]<<24 | authData[34]<<16 | authData[35]<<8 | authData[36]) >>> 0;
  await env.CACUSA_KV.put(`wacred:${session.user}`, JSON.stringify({
    credentialId, publicKey: Array.from(coseKey), signCount, created: new Date().toISOString()
  }));
  return ok({ ok: true }, origin);
}

async function handleWaLoginChallenge(body, env, origin) {
  const { user } = body;
  if (!WA_USERS.includes(user)) return err('Usuario no encontrado', 404, origin);
  const credRaw = await env.CACUSA_KV.get(`wacred:${user}`);
  if (!credRaw) return err('Face ID no configurado para este usuario', 404, origin);
  const { credentialId } = JSON.parse(credRaw);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.CACUSA_KV.put(`walc:${challenge}`, user, { expirationTtl: 300 });
  return ok({ challenge, credentialId, rpId: WA_RP_ID }, origin);
}

async function handleWaLogin(body, env, origin) {
  const { challenge, credentialId, authenticatorData, clientDataJSON, signature } = body;
  if (!challenge || !credentialId || !authenticatorData || !clientDataJSON || !signature) return err('Datos incompletos', 400, origin);
  const user = await env.CACUSA_KV.get(`walc:${challenge}`);
  if (!user) return err('Challenge inválido o expirado', 400, origin);
  await env.CACUSA_KV.delete(`walc:${challenge}`);
  const credRaw = await env.CACUSA_KV.get(`wacred:${user}`);
  if (!credRaw) return err('Credencial no encontrada', 404, origin);
  const credData = JSON.parse(credRaw);
  if (credentialId !== credData.credentialId) return err('Credencial no coincide', 400, origin);
  const cdBytes = b64urlDecode(clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(cdBytes));
  if (cd.type !== 'webauthn.get' || cd.challenge !== challenge) return err('clientData inválido', 400, origin);
  const authBytes = b64urlDecode(authenticatorData);
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(WA_RP_ID)));
  if (!arraysEqual(authBytes.slice(0, 32), rpHash)) return err('rpId no coincide', 400, origin);
  if (!(authBytes[32] & 0x01)) return err('User presence requerida', 400, origin);
  const pubKey = await importCOSEKey(new Uint8Array(credData.publicKey));
  const valid = await verifyWebAuthnSig(authBytes, cdBytes, b64urlDecode(signature), pubKey);
  if (!valid) return err('Firma inválida', 401, origin);
  const newCount = (authBytes[33]<<24 | authBytes[34]<<16 | authBytes[35]<<8 | authBytes[36]) >>> 0;
  if (newCount > 0 && newCount <= credData.signCount) return err('Replay detectado', 401, origin);
  credData.signCount = newCount;
  await env.CACUSA_KV.put(`wacred:${user}`, JSON.stringify(credData));
  const token = await signToken({ user, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }, env);
  return ok({ token, user }, origin);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
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
function cors(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Order-Ingest-Key',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };
}
function ok(obj, origin) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}
function err(msg, status, origin) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}
