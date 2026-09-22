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
 *   GMAIL_CLIENT_ID       (secret)  Correo de bienvenida (código 10%) — ver runbook abajo
 *   GMAIL_CLIENT_SECRET   (secret)  ídem
 *   GMAIL_REFRESH_TOKEN   (secret)  ídem — autoriza a este Worker a mandar correos como
 *                                   facturacioncacusa@gmail.com sin guardar su contraseña
 *   USPS_CONSUMER_KEY     (secret)  Guías de envío USPS — Developer Portal (developers.usps.com)
 *                                   → tu app → Credentials. Requiere cuenta Business Customer
 *                                   Gateway (gateway.usps.com), no la cuenta de consumidor normal
 *                                   de usps.com.
 *   USPS_CONSUMER_SECRET  (secret)  ídem
 *   USPS_FROM_ADDRESS     (secret)  JSON con la dirección de remitente real, ej:
 *                                   {"firstName":"...","lastName":"...","streetAddress":"...",
 *                                   "secondaryAddress":"...","city":"...","state":"...",
 *                                   "ZIPCode":"...","phone":"..."} — NUNCA hardcodear una
 *                                   dirección real en este archivo (público, ver CLAUDE.md).
 *   USPS_ENV              (text)    'tem' (pruebas, default) o 'prod' (real, cobra franqueo
 *                                   real de la cuenta EPS) — cambiar a 'prod' solo después de
 *                                   probar el flujo completo contra 'tem'.
 *   USPS_CRID             (secret)  Customer Registration Identifier — dato real de la cuenta,
 *                                   visible en gateway.usps.com (Business Customer Gateway).
 *                                   Lo pide la Payments API para autorizar el franqueo.
 *   USPS_MID              (secret)  Mailer Identifier — se asigna al inscribirse a un servicio
 *                                   de manifiesto electrónico (ej. Mailer ID) en la cuenta de
 *                                   Business Customer Gateway.
 *   USPS_MANIFEST_MID     (secret)  MID de manifiesto — en el caso simple, igual a USPS_MID.
 *   USPS_EPS_ACCOUNT      (secret)  Número de cuenta Enterprise Payment System (EPS) — dato
 *                                   real de cuenta, nunca hardcodeado en este archivo público.
 *
 * Generar una guía real además exige que la cuenta de USPS tenga: (a) aprobación
 * para la Labels API específicamente (Developer Portal, aparte del registro básico
 * de la app) y (b) una Enterprise Payment Account (EPS) activa — pedir el código de
 * invitación a EPS desde gateway.usps.com o a Postalone@usps.gov. Ninguno de los 2
 * pasos se puede hacer desde este código, son trámites reales con USPS.
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * RUNBOOK — cómo obtener los 3 secrets de Gmail (una sola vez, ~15 min):
 * 1. https://console.cloud.google.com → crear proyecto (ej. "cacusa-mailer").
 * 2. APIs & Services → Library → buscar "Gmail API" → Enable.
 * 3. APIs & Services → OAuth consent screen → External → nombre de la app, tu email
 *    de contacto → en "Test users" agregar facturacioncacusa@gmail.com (mientras la
 *    app esté en modo "Testing" no hace falta verificación de Google).
 * 4. APIs & Services → Credentials → Create Credentials → OAuth client ID → tipo
 *    "Web application" → en "Authorized redirect URIs" agregar
 *    https://developers.google.com/oauthplayground → Create. Copiar el Client ID y
 *    el Client Secret (= GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET).
 * 5. Ir a https://developers.google.com/oauthplayground → ícono de engranaje (arriba
 *    a la derecha) → marcar "Use your own OAuth credentials" → pegar el Client ID y
 *    Client Secret del paso 4.
 * 6. En el panel izquierdo, en el campo de scopes, escribir
 *    https://www.googleapis.com/auth/gmail.send → Authorize APIs → iniciar sesión
 *    con facturacioncacusa@gmail.com (Google va a avisar que la app no está
 *    verificada — "Advanced" → "Go to [app] (unsafe)", es tu propia app, es seguro).
 * 7. "Exchange authorization code for tokens" → copiar el "Refresh token" (=
 *    GMAIL_REFRESH_TOKEN). Este token no expira solo (a diferencia del access token,
 *    que dura 1h y este Worker renueva automáticamente en cada envío).
 * 8. Pegar los 3 valores en Cloudflare → cacusa-admin → Settings → Variables and
 *    secrets, tipo "Secret".
 * ──────────────────────────────────────────────────────────────────────────────────
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
    // Auditoría (20 sep, F20): ninguna ruta pública tenía límite de tamaño de body —
    // cualquiera podía mandar un POST arbitrariamente grande. 2MB deja margen de sobra
    // sobre el payload real más grande de este Worker (guardar el catálogo completo
    // desde el admin — data/products.json pesa ~140KB hoy y crece con cada producto
    // nuevo), sin dejar de acotar un abuso real.
    if (Number(request.headers.get('content-length') || 0) > 2_000_000) {
      return err('Cuerpo demasiado grande', 413, allowOrigin);
    }
    let body;
    try { body = await request.json(); } catch { return err('JSON inválido', 400, allowOrigin); }

    try {
      // WebAuthn — antes de /login porque '/webauthn/login'.endsWith('/login') es true
      if (path.endsWith('/webauthn/login-challenge')) return await handleWaLoginChallenge(body, env, allowOrigin, request);
      if (path.endsWith('/webauthn/login-challenge-any')) return await handleWaLoginChallengeAny(body, env, allowOrigin, request);
      if (path.endsWith('/webauthn/login'))           return await handleWaLogin(body, env, allowOrigin, request);
      if (path.endsWith('/webauthn/reg-challenge'))   return await handleWaRegChallenge(body, env, allowOrigin, request);
      if (path.endsWith('/webauthn/register'))        return await handleWaRegister(body, env, allowOrigin, request);

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
      // La llave pública VAPID no es secreta (por diseño del estándar Web Push, viaja
      // al navegador en cada suscripción) — antes vivía hardcodeada por duplicado en
      // ui_kits/admin/index.html, y quedó desincronizada del secret real la última vez
      // que se rotó el par de llaves (bug real, 20 sep: ningún "Activar" podía funcionar
      // hasta que se corrigieran los 2 lugares a mano). Ahora hay un solo lugar real (el
      // secret VAPID_PUBLIC_KEY) y el frontend la pide acá en vez de tener su propia copia.
      if (path.endsWith('/pub/vapid-key')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        if (!env.VAPID_PUBLIC_KEY) return err('VAPID_PUBLIC_KEY no configurado', 500, allowOrigin);
        return ok({ publicKey: env.VAPID_PUBLIC_KEY }, allowOrigin);
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

      // Cancela un lead de carrito abandonado cuando el cliente lo vacía sin comprar (no
      // el de compra — ese se limpia solo en handleOrder). Pública igual que /lead/register
      // (mismo modelo: cualquiera puede registrar o cancelar un lead con su propio email,
      // no hay nada sensible en juego — en el peor caso, alguien se cancela a sí mismo del
      // seguimiento de abandono).
      if (path.endsWith('/lead/cancel')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleLeadCancel(body, env, allowOrigin, request);
      }

      // Referidos — genera (o recupera) el código de descuento de una clienta que quiere
      // invitar a una amiga. Pública, origin-restringida + rate-limit. Reusa el sistema de
      // cupones existente (couponKey/couponGet), pero con reglas fijas (no elegidas por quien
      // llama) para que no se pueda abusar como si fuera /coupon/create.
      if (path.endsWith('/referral/code')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleReferralCode(body, env, allowOrigin, request);
      }

      // Envío gratis de Cacusa Lovers — mismas reglas fijas que /referral/code:
      // pública, origin-restringida, rate-limited, y solo para suscriptoras activas
      // verificadas contra Firebase. Nunca deja que el llamador elija el beneficio.
      if (path.endsWith('/lovers/shipping-code')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleLoversShippingCode(body, env, allowOrigin, request);
      }

      // Aviso de "nueva suscripción pendiente" — lo llama el formulario de la página de
      // Lovers justo antes de irse a Square. Es el único momento en que se puede avisar:
      // si la clienta abandona el pago, Square nunca manda un webhook y nadie se entera.
      // Mismas reglas que las de arriba: origin-restringida, rate-limited, y el texto del
      // push lo arma este Worker con datos de Firebase — nunca lo elige quien llama.
      if (path.endsWith('/lovers/notify-pending')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleLoversNotifyPending(body, env, allowOrigin, request);
      }

      // Auditoría externa (22 sep, S07): antes, el formulario público escribía DIRECTO
      // a Firebase desde el navegador — cualquiera podía crear el PRIMER registro de un
      // email ajeno (sin probar que lo controla) con una dirección inventada, y esa
      // dirección quedaba lista para usarse en un envío real el día que la dueña
      // verdadera del email pagara. Ahora el formulario manda los datos acá (no a
      // Firebase directo) y no se escribe NADA hasta que la persona confirma el enlace
      // que le llega a su correo — ver handleLoversRegister()/handleLoversConfirm().
      if (path.endsWith('/lovers/register')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleLoversRegister(body, env, allowOrigin, request);
      }
      if (path.endsWith('/lovers/confirm')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleLoversConfirm(body, env, allowOrigin, request);
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

      // Activar/desactivar el cupón exclusivo de Lovers (5% permanente) — llamada desde
      // lovers-webhook-worker.js en el mismo momento en que marca a alguien 'activo' o
      // 'cancelado' (pago confirmado, cancelación, o alta manual). Igual que /push/notify,
      // autenticada con ORDER_INGEST_KEY compartido, no con sesión de admin.
      if (path.endsWith('/internal/lovers/exclusive-coupon')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        await handleLoversExclusiveCoupon(body, env).catch(e => console.error('exclusive-coupon interno falló:', e.message));
        return ok({ ok: true }, allowOrigin);
      }

      // Correo de bienvenida/confirmación de Cacusa Lovers — llamada desde
      // lovers-webhook-worker.js SOLO en la transición hacia estado_pago:'activo'
      // (primer pago real o resuscripción, nunca una renovación normal — ver
      // wasActive en invoice.payment_made). Mismo guard Worker-a-Worker que el resto
      // de rutas internas (ORDER_INGEST_KEY compartido).
      if (path.endsWith('/internal/lovers/subscription-email')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        await sendSubscriptionConfirmationEmail(body, env).catch(e => console.error('subscription-email interno falló:', e.message));
        return ok({ ok: true }, allowOrigin);
      }

      // Cacusa Lovers — crea el "pedido de envío" del ciclo (mensual/anual) cuando
      // lovers-webhook-worker.js confirma un cobro real. Mismo guard Worker-a-Worker
      // que el resto de rutas internas (ORDER_INGEST_KEY compartido).
      if (path.endsWith('/order/lovers-shipment')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleLoversShipmentIngest(body, env, allowOrigin, ctx);
      }

      // Notificación push disparada desde OTRO Worker (hoy: cacusa-lovers-webhook, cuando
      // nace una suscriptora nueva) — autenticada con el mismo ORDER_INGEST_KEY compartido,
      // no con un token de sesión de admin (este Worker no tiene sesión iniciada).
      if (path.endsWith('/push/notify')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        if (!env.VAPID_PRIVATE_KEY_JWK) return ok({ error: 'VAPID_PRIVATE_KEY_JWK no configurado' }, allowOrigin);
        const title   = (body.title || 'CACUSA').toString().slice(0, 100);
        const text    = (body.body  || '').toString().slice(0, 200);
        const url     = (body.url   || 'https://cacusabytaitus.com/ui_kits/admin/').toString().slice(0, 300);
        // tag: agrupa notificaciones del mismo tipo de evento — así una nueva
        // suscriptora Lovers no tapa un pedido que todavía no se ha leído (antes
        // todo compartía un único tag y la más reciente reemplazaba a la anterior
        // en el centro de notificaciones sin dejar rastro).
        const tag     = (body.tag  || 'cacusa').toString().slice(0, 40);
        const urgency = ['very-low', 'low', 'normal', 'high'].includes(body.urgency) ? body.urgency : 'normal';
        const stats = await sendWebPushAll(env, { title, body: text, url, tag, urgency });
        return ok({ ok: true, ...stats }, allowOrigin);
      }

      // Rutas protegidas con token de sesión
      const session = await verifyToken(body.token, env);
      if (!session) return err('Sesión inválida o expirada. Inicia sesión de nuevo.', 401, allowOrigin);

      // Auditoría (20 sep, F21-c): "cerrar sesión en todos los dispositivos" — borra TODAS
      // las llaves sess:<user>:* de esta cuenta (incluida la de este mismo request), así
      // que cualquier token de esa persona (robado o no) deja de servir de inmediato,
      // aunque su firma/expiración sigan siendo válidas.
      if (path.endsWith('/logout-all')) {
        let revoked = 0;
        if (env.CACUSA_KV) {
          let cursor;
          do {
            const page = await env.CACUSA_KV.list({ prefix: `sess:${session.user}:`, cursor, limit: 1000 });
            for (const k of page.keys) { await env.CACUSA_KV.delete(k.name); revoked++; }
            cursor = page.list_complete ? null : page.cursor;
          } while (cursor);
        }
        return ok({ ok: true, revoked }, allowOrigin);
      }

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
      if (path.endsWith('/surcharge/save')) return await handleSurchargeSave(body, env, allowOrigin, ctx);
      if (path.endsWith('/market/save'))    return await handleMarketSave(body, env, allowOrigin);
      if (path.endsWith('/save'))           return await handleSave(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/order/manual'))   return await handleOrderManual(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/order/update'))   return await handleOrderUpdate(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/order/usps-label')) return await handleUspsLabel(body, env, allowOrigin, session, ctx);
      if (path.endsWith('/usps/schedule-pickup')) return await handleUspsSchedulePickup(body, env, allowOrigin, ctx);
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
      if (path.endsWith('/lead/delete'))       return await handleLeadDelete(body, env, allowOrigin);
      if (path.endsWith('/lead/send-welcome')) return await handleLeadSendWelcome(body, env, allowOrigin);
      if (path.endsWith('/lovers/exclusive-coupon/bulk')) return await handleLoversExclusiveBulk(body, env, allowOrigin);
      if (path.endsWith('/tiktok/export-status'))  return await handleTiktokExportStatus(env, allowOrigin);
      if (path.endsWith('/tiktok/trigger-export')) return await handleTiktokTriggerExport(env, allowOrigin);
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
          tag:   'cacusa-test',
          urgency: 'normal',
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
// Barrido de seguridad (19 sep): passwordFor(user) hacía un lookup directo sobre un
// objeto literal — que hereda de Object.prototype. Con user:"constructor" (o
// "toString", "__proto__", etc.) el lookup devolvía una función heredada en vez de
// undefined, y safeEqual() la convertía a un string determinista y adivinable
// ("function Object() { [native code] }"), dejando entrar con cualquier "contraseña"
// que fuera exactamente ese string. VALID_USERS.has() no consulta el prototype —
// cierra el vector por completo, sin tocar signToken/verifyToken (que nunca revisan
// qué usuario firmó el token, pero ahora nunca se firma uno para un usuario inválido).
const VALID_USERS = new Set(['tita.jaramillo', 'robin.gonzalez']);
function passwordFor(user, env) {
  if (!VALID_USERS.has(user)) return undefined;
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
  const token = await createSession(user, env);
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
    tag: 'cacusa-system',
    urgency: 'normal',
  }).catch(() => {});
}

async function handleSave(body, env, origin, session, ctx) {
  const { path, content, message } = body;
  if (path !== PRODUCTS_PATH && path !== ORDERS_PATH) return err('Ruta no permitida', 403, origin);
  if (typeof content !== 'string') return err('Contenido inválido', 400, origin);
  // Auditoría (20 sep, F15): nada validaba que `content` fuera JSON válido antes de
  // subirlo a GitHub — un catálogo corrupto rompía la tienda entera hasta que alguien
  // lo notara y lo arreglara a mano. Solo aplica a PRODUCTS_PATH (el editor de
  // pedidos legado ya es no-op, ver abajo).
  if (path === PRODUCTS_PATH) {
    try { JSON.parse(content); } catch (e) { return err('JSON inválido: ' + e.message, 400, origin); }
  }

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
  // Antes devolvía `https://${GH_OWNER}.github.io/${GH_REPO}/${path}` — el dominio
  // genérico de GitHub Pages, que redirige (301) al dominio propio configurado en
  // CNAME. Cada imagen de producto (visible en la tienda, en og:image y en el JSON-LD)
  // quedaba apuntando a una URL que siempre redirige — hallazgo del 19 sep tras un
  // aviso de Search Console de "página con redirección".
  return ok({ ok: true, url: `https://cacusabytaitus.com/${path}` }, origin);
}

// Sanea un pedido crudo a solo los campos permitidos (nunca spread del body del
// cliente). strictPago=true (checkout público / webhook de Square, ninguno de los
// dos es un origen confiable para elegir texto libre) solo deja pasar
// Zelle/WhatsApp/Tarjeta y colapsa cualquier otra cosa a "Otro". strictPago=false
// (alta manual desde el admin, ya autenticado con sesión) deja el método de pago tal
// cual lo eligió Tita/Robin en el modal (acotado a 40 caracteres) — el modal ofrece
// opciones reales (PayPal, efectivo, etc.) que no tiene sentido colapsar a "Otro".
function buildOrderCore(order, { strictPago, allowTarjeta }) {
  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const num = (v) => typeof v === 'number' && isFinite(v) ? v : 0;
  const cliente = order.cliente || {};
  // Auditoría de integridad (19 sep, F02): "pago" es el método SOLICITADO por quien
  // manda el pedido, no una confirmación real de cobro — un pedido público (no
  // `trusted`) nunca llegó acá con un pago de tarjeta ya verificado, así que jamás
  // debe poder autodeclararse "Tarjeta" (eso induciría a Tita/Robin a pensar que
  // Square ya cobró y despachar sin haber cobrado de verdad). Solo el camino
  // `trusted` (webhook de Square, ya autenticado con ORDER_INGEST_KEY, llega DESPUÉS
  // de que el pago se confirmó de verdad) puede declarar "Tarjeta".
  const allowedPago = allowTarjeta ? ['Zelle', 'WhatsApp', 'Tarjeta'] : ['Zelle', 'WhatsApp'];
  return {
    id:        Date.now(),
    fecha:     new Date().toISOString(),
    numero:    str(order.numero, 30) || undefined,
    estado:    'Nuevo',
    pago:      strictPago
      ? (allowedPago.includes(order.pago) ? order.pago : 'Otro')
      : (str(order.pago, 40) || 'Otro'),
    total:     num(order.total),
    subtotal:  num(order.subtotal),
    envio:     num(order.envio),
    impuesto:  num(order.impuesto),
    notas:     str(order.notas, 500) || undefined,
    // Auditoría externa (19 sep, ronda nueva): qué código de cupón se aplicó a ESTE
    // pedido — antes no se guardaba nada, así que /coupon/burn no tenía forma de saber
    // si el consumo que le pedían correspondía a un pedido real. Ver
    // handleCouponBurnPublic() más abajo.
    cuponAplicado: str(order.cuponAplicado, 40) || undefined,
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
      // 40, no 10: "ESTADOS UNIDOS"/"UNITED STATES" (14/13 caracteres) son valores
      // reales que isUsOrder()/handleUspsLabel() ya aceptan — truncar a 10 los corta
      // a mitad de palabra y rompe el match (bug real encontrado 20 sep: un pedido
      // de Cacusa Lovers con país truncado nunca mostraba el botón de USPS).
      pais:      str(cliente.pais,       40),
      notas:     str(cliente.notas,     500),
      // Nuevo (22 sep) — en qué idioma compró (tienda ES o EN), para mandar los 3
      // correos transaccionales nuevos en el idioma correcto. Default 'es' si no viene
      // (pedidos manuales del admin, o pedidos viejos de antes de este campo).
      idioma:    str(cliente.idioma, 5) === 'en' ? 'en' : 'es',
    },
    productos: (Array.isArray(order.productos) ? order.productos : []).slice(0, 50).map(p => ({
      // Auditoría (20 sep, F10): los ids reales del catálogo son numéricos
      // (timestamps) — str() solo dejaba pasar strings, así que cualquier
      // pedido con p.id numérico (el camino "trusted" desde Square no pasa
      // por validatePublicOrderProducts, que sí normaliza a string) quedaba
      // guardado con id:'' para siempre.
      id:              p.id != null ? String(p.id).slice(0, 50) : '',
      name:            str(p.name || p.nombre, 150),
      price:           num(p.price || p.precio),
      // Auditoría externa (22 sep, S03): defensa en profundidad — este coerción corre
      // también para los caminos trusted/manual (Square ya validado, admin a mano) que
      // no pasan por validatePublicOrderProducts(); Number.isFinite() rechaza
      // Infinity/NaN (ej. un número JSON que desborda el rango) que `typeof === 'number'`
      // por sí solo no filtra.
      qty:             Number.isFinite(p.qty) ? Math.max(1, Math.floor(p.qty)) : 1,
      personalization: str(p.personalization, 300),
    })),
  };
}

function orderKey(id) { return 'order:' + String(id); }
async function orderGet(env, id) {
  const raw = await env.CACUSA_KV.get(orderKey(id));
  return raw ? JSON.parse(raw) : null;
}
// buildOrderCore() arma el id con Date.now() — sin sufijo ni chequeo de colisión.
// Dos checkouts cayendo en el mismo milisegundo (doble clic en "pagar", o 2 clientas
// pagando casi a la vez) pisaban en silencio el pedido de la otra al escribir a la
// misma llave order:<id>. El primer arreglo (A07-A19, 19 sep) verificaba con un GET
// antes de escribir y corría el id 1ms hacia adelante en caso de choque — pero eso
// dejaba una ventana de carrera real: el GET-que-dice-"libre" y el PUT posterior no
// son atómicos, así que 2 requests concurrentes podían ambos pasar el chequeo y
// pisarse igual (hallazgo F03-b de la auditoría del 19 sep, ronda de integridad).
// Ahora se agrega SIEMPRE un sufijo aleatorio de 3 dígitos (no solo al detectar un
// choque) — la probabilidad de que 2 pedidos generen el mismo id sin ningún GET
// previo es prácticamente cero, así que no queda ninguna ventana que cerrar. Sigue
// siendo un número (ordena igual que antes en listAllOrders) y sigue siendo
// aproximadamente cronológico (Date.now() * 1000 + random), solo que ya no es
// exactamente "milisegundos desde epoch".
function assignOrderId(newOrder) {
  newOrder.id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
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

// ── Leads (10% del popup + carritos abandonados): una llave por email ──────────────
// Antes vivían todos en un solo blob JSON bajo la llave 'leads' — cualquier escritura
// (registrar uno nuevo, marcar notified, borrar uno) leía TODO el array, lo modificaba
// en memoria y volvía a escribir TODO el array. Dos requests concurrentes que tocaran
// leads DISTINTOS (ej. checkAbandonedCarts marcando notified en el lead A mientras
// removeCartLead borraba el lead B, disparados por dos visitantes distintos al mismo
// tiempo) podían pisarse: el que escribe último gana, y el cambio del otro se pierde en
// silencio — mismo problema de fondo que ya se había resuelto para pedidos (ver
// refreshOrdersCache arriba). Mismo arreglo acá: cada lead en su propia llave
// (lead:<email>), así que dos leads distintos nunca compiten por la misma escritura.
function leadKey(email) { return 'lead:' + String(email || '').toLowerCase().trim(); }
// Mismo patrón de paginación por prefijo que listAllOrders().
async function listAllLeads(env) {
  const leads = [];
  let cursor;
  do {
    const page = await env.CACUSA_KV.list({ prefix: 'lead:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.CACUSA_KV.get(k.name);
      if (raw) { try { leads.push(JSON.parse(raw)); } catch (_) {} }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  leads.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return leads;
}
async function refreshLeadsCache(env) {
  return writeLeadsCache(env, await listAllLeads(env));
}
// Variante que NO vuelve a escanear KV — para cuando quien llama ya tiene el array
// completo en memoria (ver handleLeadRegister, que antes disparaba hasta 3 escaneos
// completos de lead:* en un solo request: uno al refrescar la caché tras el alta, otro
// dentro de markLeadWelcomeSent si mandaba el correo, y un tercero dentro de
// checkAbandonedCarts). Ahora ese flujo hace un solo listAllLeads() y reusa el mismo
// array para todo, terminando con un solo PUT a leads_cache.
async function writeLeadsCache(env, leads) {
  const data = { version: '1.0', lastUpdated: new Date().toISOString(), leads };
  await env.CACUSA_KV.put('leads_cache', JSON.stringify(data));
  return data;
}
// Migración única e idempotente del blob legado 'leads' al esquema de una llave por
// lead — mismo patrón que migrateLegacyOrdersIfNeeded(). Diferencia importante: acá SÍ
// puede pasar que un lead nuevo entre (o uno existente reciba el correo de bienvenida)
// en la ventana entre el deploy y esta migración, usando el email como llave — a
// diferencia de un pedido nuevo (que siempre tiene un id fresco y nunca choca con uno
// legado), un email SÍ puede coincidir con un registro legado. Por eso, a diferencia de
// la versión de pedidos, acá NUNCA se pisa una llave que ya exista: si ya hay algo en
// lead:<email> (porque ya se migró, o porque un request en vivo se adelantó), se salta
// ese lead y se deja tal cual — nunca se sobreescribe con la versión vieja del blob.
async function migrateLegacyLeadsIfNeeded(env) {
  if (await env.CACUSA_KV.get('leads:migrated')) return;
  const legacyRaw = await env.CACUSA_KV.get('leads');
  if (legacyRaw) {
    let legacy;
    try { legacy = JSON.parse(legacyRaw); } catch (_) { legacy = null; }
    if (legacy && Array.isArray(legacy.leads)) {
      for (const l of legacy.leads) {
        if (!l || !l.email) continue;
        const key = leadKey(l.email);
        if (await env.CACUSA_KV.get(key)) continue; // ya existe — no lo pisamos
        await env.CACUSA_KV.put(key, JSON.stringify(l));
      }
    }
  }
  await env.CACUSA_KV.put('leads:migrated', '1');
  await refreshLeadsCache(env);
}

// ── Validación de catálogo real para pedidos públicos (Zelle/WhatsApp) ──────
// Auditoría externa (19 sep, ronda nueva): a diferencia de los pagos con tarjeta
// (square-payment-worker.js ya valida contra data/products.json antes de llegar acá,
// ver su función validateItems), estos 2 caminos aceptaban precio/cantidad tal cual
// los mandaba el navegador — cualquiera con las devtools abiertas podía editar el
// precio antes de enviar el pedido. Mismo patrón que square-payment-worker.js
// (CATALOG_URL, +4% de recargo si aplica), adaptado a la forma real de
// `order.productos` acá (con `qty`, no un item por unidad como en Square).
const CATALOG_URL = 'https://cacusabytaitus.com/data/products.json';
function js_round2(n) { return Math.round(n * 100) / 100; }
// Auditoría (20 sep, F11): el checkout nunca leía prod.promo — siempre cobraba el
// precio base aunque la tienda le mostrara a la clienta el precio con descuento de
// una promoción activa (mismo criterio que ui_kits/store/index.html usa para decidir
// si mostrar el precio de promo: promo.price presente y promo.endsAt, si existe, en
// el futuro). Duplicada en square-payment-worker.js (sin módulos compartidos entre
// Workers) — cualquier cambio acá hay que replicarlo allá también.
function resolveBasePrice(prod) {
  if (prod.promo && prod.promo.price) {
    const ended = prod.promo.endsAt && new Date(prod.promo.endsAt) < new Date();
    if (!ended) return +prod.promo.price;
  }
  return prod.price;
}

async function fetchCatalogForOrderValidation() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(CATALOG_URL, { cf: { cacheTtl: 60 } });
      if (r.ok) {
        const data = await r.json();
        const products = Array.isArray(data) ? data : (data.products || []);
        const combos = Array.isArray(data.combos) ? data.combos : [];
        const shipping = (data.config && data.config.shipping) || { freeThreshold: 90, cost: 10 };
        return { products, combos, shipping };
      }
    } catch (e) { /* reintenta una vez, ver abajo */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// Auditoría de integridad (19 sep, F02) — antes esto fallaba ABIERTO (si el catálogo
// no respondía, dejaba pasar precio/cantidad tal cual los mandó el navegador). Se
// reprodujo el ataque real: catálogo caído (503) → producto inexistente aceptado a
// $0.01. Ahora falla CERRADO: 2 intentos con backoff corto (arriba) y, si el catálogo
// sigue sin responder, se rechaza el pedido — un blip de red real bloquea un checkout
// legítimo por unos segundos (el cliente reintenta), lo cual es preferible a aceptar
// montos arbitrarios. Devuelve { productos, subtotal, shipping } con los precios YA
// verificados contra el catálogo real — nunca lo que mandó el cliente.
// Auditoría externa (22 sep, S08 — recargo sobre precio de promo): promo.price ya ES
// el precio final que la tienda le muestra a la clienta (mismo criterio documentado en
// el comentario de resolveBasePrice) — aplicarle el 4% de recargo encima cobraba de más
// sin que la clienta lo viera venir (un producto de $80 en promo terminaba en $83.20).
function isPromoActive(prod) {
  if (!(prod.promo && prod.promo.price)) return false;
  const ended = prod.promo.endsAt && new Date(prod.promo.endsAt) < new Date();
  return !ended;
}

// Auditoría externa (22 sep, S03): límite de líneas y de cantidad por línea — antes
// aceptaba cualquier cantidad de líneas (calculaba el total sobre TODAS antes de que
// buildOrderCore recortara a 50 en silencio) y cualquier valor de `qty` que pasara
// `typeof === 'number'`, incluido Infinity/NaN (un número JSON que desborda el rango
// parsea como Infinity — sigue siendo `typeof 'number'`). Un carrito así guardaba un
// pedido con total/subtotal en 0 pese a tener un producto real de precio > 0.
const ORDER_MAX_LINES = 50;
const ORDER_MAX_QTY_PER_LINE = 20;

async function validatePublicOrderProducts(productos, env, idioma) {
  if (!Array.isArray(productos) || productos.length > ORDER_MAX_LINES) {
    throw new Error(`El carrito no puede tener más de ${ORDER_MAX_LINES} líneas`);
  }
  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) throw new Error('catálogo no disponible, intentá de nuevo en un momento');

  let surcharges = {};
  if (env.CACUSA_KV) {
    const raw = await env.CACUSA_KV.get('surcharges');
    if (raw) try { surcharges = JSON.parse(raw); } catch {}
  }
  const productMap = new Map(catalog.products.map(p => [String(p.id), p]));
  const comboMap = new Map(catalog.combos.map(c => [String(c.id), c]));

  const validated = productos.map((item, idx) => {
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty < 1 || qty > ORDER_MAX_QTY_PER_LINE) {
      throw new Error(`Cantidad inválida en la línea ${idx + 1}`);
    }
    const safeQty = Math.floor(qty);
    if (item.isCombo) {
      const combo = comboMap.get(String(item.id));
      if (!combo) throw new Error(`Combo no encontrado en el catálogo (id: ${item.id})`);
      // Auditoría (20 sep, F11): antes no se chequeaba disponibilidad de combos (solo
      // de productos sueltos) — inofensivo hoy porque el catálogo real no tiene ningún
      // combo, pero cierra el hueco para cuando se agregue el primero.
      if (combo.available === false) throw new Error(`Combo no disponible: ${combo.name || item.id}`);
      return { ...item, qty: safeQty, name: combo.name, price: combo.price };
    }
    const prod = productMap.get(String(item.id));
    if (!prod) throw new Error(`Producto no encontrado en el catálogo (id: ${item.id}, pos: ${idx})`);
    if (prod.available === false) throw new Error(`Producto no disponible: ${prod.name || item.id}`);
    const basePrice = resolveBasePrice(prod);
    // Auditoría (22 sep, S08): nunca recargar un precio que ya viene de una promo activa.
    const price = (!isPromoActive(prod) && surcharges[String(prod.id)] === true)
      ? js_round2(basePrice * 1.04) : basePrice;
    // Auditoría (22 sep, S03): el nombre siempre sale del catálogo real, nunca del que
    // manda el cliente — antes se conservaba `item.name` tal cual, sin comparar contra
    // el producto real que ese id identifica.
    const name = (idioma === 'en' && prod.name_en) ? prod.name_en : prod.name;
    return { ...item, qty: safeQty, name, price };
  });
  const subtotal = validated.reduce((s, p) => s + p.price * p.qty, 0);
  return { productos: validated, subtotal, shipping: catalog.shipping };
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Huella canónica de un pedido — detecta si un reintento con la misma idempotencyKey
// es de verdad el MISMO pedido (mismo contenido) o si alguien está reusando/adivinando
// la key de otro pedido con contenido distinto (F01, auditoría del 19 sep). Se calcula
// SIEMPRE sobre datos YA recalculados server-side, nunca lo que mandó el cliente.
async function orderFingerprint(newOrder) {
  const items = newOrder.productos.map((p) => `${p.id}:${p.qty}:${p.price}:${p.personalization || ''}`).sort().join(',');
  const c = newOrder.cliente || {};
  // Auditoría externa (22 sep, S04): antes la huella no incluía dirección/depto/
  // personalización — un reintento con la misma idempotencyKey pero esos campos
  // editados coincidía igual y devolvía el pedido VIEJO (con la dirección vieja) en
  // vez de rechazar por huella distinta o crear uno nuevo.
  const raw = `${(c.email || '').toLowerCase()}|${c.telefono || ''}|${c.direccion || ''}|${c.apto || ''}|${c.ciudad || ''}|${c.estado || ''}|${c.zip || ''}|${newOrder.total}|${items}`;
  return sha256Hex(raw);
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

  // Auditoría de integridad (19 sep, F02): un carrito vacío nunca es un pedido real —
  // permitirlo dejaba fabricar un pedido "de mentira" para atar cualquier cosa a él
  // (ej. un cuponAplicado inventado, ver handleCouponBurnPublic/F04) sin comprar nada.
  if (!trusted && order.productos.length === 0) {
    return err('El carrito está vacío', 400, origin);
  }

  // Auditoría de integridad (19 sep, F02): solo pedidos públicos (Zelle/WhatsApp) — los
  // que ya llegan `trusted` vienen de cacusa-square, que ya valida contra este mismo
  // catálogo antes de generar el link de pago. ANTES esto fallaba abierto si el catálogo
  // no respondía (dejaba pasar precio/cantidad del cliente tal cual); ahora
  // validatePublicOrderProducts() lanza si el catálogo no se pudo traer, y acá se
  // traduce en rechazar el pedido — nunca se acepta un precio no verificado.
  let recalcSubtotal = null, recalcShipping = null;
  if (!trusted) {
    try {
      const validated = await validatePublicOrderProducts(order.productos, env, order.cliente && order.cliente.idioma);
      order.productos = validated.productos;
      recalcSubtotal = validated.subtotal;
      recalcShipping = validated.shipping;
    } catch (e) {
      return err('No se pudo validar el carrito: ' + e.message, 400, origin);
    }

    // Auditoría de integridad (19 sep, F02): total/subtotal/envío ya no se toman tal
    // cual los manda el cliente — se recalculan desde los productos YA validados, el
    // cupón (si hay uno, con la misma couponIsValid() que ya usa /coupon/validate) y
    // el umbral de envío gratis real. El impuesto SÍ sigue viniendo del cliente
    // (replicar acá la tabla completa de impuesto por estado/ZIP de
    // square-payment-worker.js duplicaría ~150 líneas de tasas) pero se acota a un
    // tope sano (12%, por encima de cualquier tasa combinada real de EE.UU.) en vez
    // de aceptarlo sin límite — cierra el caso concreto reproducido por la auditoría
    // (total −9 con un producto de $100 en el catálogo) sin replicar todo ese motor.
    const cliente = order.cliente || {};
    let coupon = null;
    if (order.cuponAplicado) {
      coupon = await couponGet(env, order.cuponAplicado);
      if (!coupon || !(await couponIsValid(coupon, cliente.email, cliente.telefono, env))) coupon = null;
    }
    let discount = 0;
    if (coupon) {
      if (coupon.type === 'percent') discount = js_round2(recalcSubtotal * (Number(coupon.amount) || 0) / 100);
      else if (coupon.type === 'fixed') discount = Math.min(Number(coupon.amount) || 0, recalcSubtotal);
    }
    const shipCost = recalcSubtotal >= (recalcShipping.freeThreshold || 90) ? 0 : (recalcShipping.cost || 10);
    const envio = (coupon && coupon.type === 'freeship') ? 0 : shipCost;
    const impuestoBound = recalcSubtotal * 0.12;
    const impuesto = js_round2(Math.min(Math.max(num(order.impuesto), 0), impuestoBound));

    order.subtotal = recalcSubtotal;
    order.envio = envio;
    order.impuesto = impuesto;
    order.total = js_round2(Math.max(0, recalcSubtotal - discount + envio + impuesto));
  }

  const newOrder = buildOrderCore(order, { strictPago: true, allowTarjeta: trusted });

  // Idempotencia real (A07-A19, 19 sep) endurecida el 19 sep (auditoría de integridad,
  // F01): antes esto devolvía el PEDIDO COMPLETO (email, dirección, teléfono) a quien
  // mandara la idempotencyKey correcta — y esa key la generaba la tienda con un hash
  // de 32 bits de datos conocidos (email, teléfono, total), adivinable/reconstruible
  // por cualquiera sin necesitar acertar nada. Ahora la tienda manda una key aleatoria
  // de verdad (ver ui_kits/store, _orderIdemKey) y la respuesta ante un reintento NUNCA
  // repite PII — es el mismo recibo mínimo de siempre. Se compara además una huella
  // canónica del CONTENIDO (calculada acá, sobre datos ya recalculados server-side)
  // contra la guardada: si no coincide, alguien reusa una key ajena o el contenido
  // cambió — se rechaza con 409 sin revelar nada del pedido existente.
  const idemKey = str(order.idempotencyKey, 100);
  const fingerprint = idemKey ? await orderFingerprint(newOrder) : null;
  // Auditoría externa (22 sep, S04): el chequeo de KV de abajo (get→...→put, no
  // atómico) puede dejar pasar 2 pedidos si 2 requests con la misma idemKey llegan
  // genuinamente al mismo tiempo — reclamar la key en OrderIdempotency PRIMERO cierra
  // esa carrera (ver la clase más arriba). Sin binding todavía, orderIdemClaim()
  // devuelve {claimed:true} siempre y el comportamiento es idéntico al de antes.
  let idemClaimed = false;
  if (idemKey) {
    const claim = await orderIdemClaim(env, idemKey);
    if (!claim.claimed) {
      if (claim.timedOut) {
        return err('Esta operación ya se está procesando, intentá de nuevo en un momento', 409, origin);
      }
      if (claim.fingerprint === fingerprint) {
        const existingOrder = await orderGet(env, claim.orderId);
        if (existingOrder) {
          return ok({ ok: true, id: existingOrder.id, total: existingOrder.total, estado: existingOrder.estado }, origin);
        }
        // La DO dice 'done' pero el pedido ya no existe (rarísimo) — sigue de largo
        // como si fuera nuevo, sin volver a reclamar (ya está 'done' en la DO).
      } else {
        return err('Esta operación ya fue registrada con otros datos', 409, origin);
      }
    } else {
      idemClaimed = true;
    }
  }
  if (idemKey) {
    const raw = await env.CACUSA_KV.get(`idem:${idemKey}`);
    if (raw) {
      let stored; try { stored = JSON.parse(raw); } catch (_) { stored = null; }
      if (stored && stored.fingerprint === fingerprint) {
        const existingOrder = await orderGet(env, stored.orderId);
        if (existingOrder) {
          if (idemClaimed) await orderIdemFinalize(env, idemKey, existingOrder.id, fingerprint).catch(() => {});
          return ok({ ok: true, id: existingOrder.id, total: existingOrder.total, estado: existingOrder.estado }, origin);
        }
      } else if (stored) {
        if (idemClaimed) await orderIdemRelease(env, idemKey).catch(() => {});
        return err('Esta operación ya fue registrada con otros datos', 409, origin);
      }
    }
  }

  // El id ya no depende de ningún chequeo previo contra KV — ver assignOrderId() más
  // arriba (F03-b, cierra la ventana de carrera del viejo ensureUniqueOrderId()).
  assignOrderId(newOrder);
  const orderRef = orderKey(newOrder.id);

  // Redención de gift card — reserva ATÓMICA (Durable Object GiftCardLedger, ver más
  // arriba) atada al id de ESTE pedido: si el pedido no llega a persistirse, se
  // libera; si se persiste, se confirma. Antes se descontaba el saldo ANTES de saber
  // si el pedido se iba a poder guardar, y sin ninguna serialización real entre 2
  // redenciones concurrentes contra el mismo código (F03-a/F06, auditoría del 19 sep:
  // 2 llamadas por $80 sobre saldo $100 dejaban saldo $20 en vez de rechazar la 2da).
  const gcCodeReq   = str(order.giftcard && order.giftcard.code, 40);
  const gcAmountReq = num(order.giftcard && order.giftcard.amount);
  let gcReserved = false;
  if (gcCodeReq && gcAmountReq > 0) {
    const oweBeforeGiftCard = Math.max(0, newOrder.total);
    const cappedAmountCents = Math.round(Math.min(gcAmountReq, oweBeforeGiftCard) * 100);
    if (cappedAmountCents > 0) {
      const giftcardResult = await gcReserve(env, gcCodeReq, cappedAmountCents, orderRef);
      if (giftcardResult.applied > 0) {
        newOrder.giftcard = { code: gcCodeReq, applied: giftcardResult.applied };
        newOrder.total = js_round2(Math.max(0, newOrder.total - giftcardResult.applied));
        gcReserved = true;
      }
    }
  }

  // Cada pedido en su propia llave — nunca se lee ni se escribe un blob compartido, así
  // que dos pedidos concurrentes en llaves DISTINTAS nunca se pisan. Si la escritura
  // falla, se libera la reserva de gift card en vez de dejarla huérfana (F03-a/F06).
  try {
    await env.CACUSA_KV.put(orderRef, JSON.stringify(newOrder));
  } catch (e) {
    // Auditoría externa (22 sep, S02): antes se ignoraba silenciosamente cualquier
    // fallo de gcRelease() — ahora que gcCommit()/gcRelease() SÍ lanzan si la DO
    // devuelve un error real, loguearlo da visibilidad real en vez de tragárselo del
    // todo (la reserva igual se auto-libera sola vía alarm() a las 2h si esto falla).
    if (gcReserved) await gcRelease(env, gcCodeReq, orderRef).catch(e2 => console.error('gcRelease falló tras error de guardado:', e2.message));
    if (idemClaimed) await orderIdemRelease(env, idemKey).catch(() => {});
    return err('No se pudo guardar el pedido, intentá de nuevo', 500, origin);
  }
  if (gcReserved) await gcCommit(env, gcCodeReq, orderRef).catch(e => console.error('gcCommit falló (el pedido ya se guardó igual):', e.message));
  if (idemKey) await env.CACUSA_KV.put(`idem:${idemKey}`, JSON.stringify({ orderId: newOrder.id, fingerprint }), { expirationTtl: 86400 });
  if (idemClaimed) await orderIdemFinalize(env, idemKey, newOrder.id, fingerprint).catch(() => {});
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  // Si esta clienta tenía un carrito marcado como abandonado, ya no lo está — compró.
  // Best-effort: nunca debe afectar la respuesta del pedido si falla.
  const orderEmailLc = (newOrder.cliente?.email || '').toLowerCase();
  if (ctx && orderEmailLc) ctx.waitUntil(removeCartLead(orderEmailLc, env).catch(() => {}));
  // Correo de confirmación de pedido — nunca antes de este punto (el pedido ya está
  // guardado de verdad), nunca en un reintento (idem: ya devolvió antes de llegar acá).
  if (ctx) ctx.waitUntil(sendOrderConfirmationEmail(newOrder, env).catch(e => console.error('email confirmación pedido falló:', e.message)));

  if (env.NTFY_TOPIC) {
    await sendNtfy(newOrder, env);
  }
  if (env.VAPID_PRIVATE_KEY_JWK) {
    const icon = newOrder.pago === 'WhatsApp' ? '📱' : '💳';
    // El pedido YA se guardó arriba — un fallo del push nunca debe convertirse en un
    // 500 para quien llamó (la tienda, o cacusa-square reenviando tras cobrar), o se
    // ve como que el pedido no se creó y se reintenta duplicado.
    try {
      await sendWebPushAll(env, {
        title: 'CACUSA · Nuevo pedido',
        body:  `${icon} ${newOrder.pago} · ${newOrder.cliente?.nombre || 'Cliente'} · $${newOrder.total}`,
        url:   'https://cacusabytaitus.com/ui_kits/admin/',
        tag: 'cacusa-order',
        urgency: 'high',
      });
    } catch (e) {
      console.error('push nuevo pedido falló:', e.message);
    }
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

  assignOrderId(newOrder);
  await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  const orderEmailLc = (newOrder.cliente?.email || '').toLowerCase();
  if (ctx && orderEmailLc) ctx.waitUntil(removeCartLead(orderEmailLc, env).catch(() => {}));
  if (ctx) ctx.waitUntil(sendOrderConfirmationEmail(newOrder, env).catch(e => console.error('email confirmación pedido manual falló:', e.message)));

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
// Auditoría (20 sep, F21): Math.random() no es un CSPRNG — cambio gratuito a
// crypto.getRandomValues(), sin downside (Workers siempre tiene Web Crypto).
// Rejection sampling porque 256 no es múltiplo de 31 (GC_CHARSET.length) — un simple
// `byte % 31` sesgaría levemente los primeros caracteres del charset.
function randomCharsetIndex(len) {
  const limit = 256 - (256 % len);
  let byte;
  do { byte = crypto.getRandomValues(new Uint8Array(1))[0]; } while (byte >= limit);
  return byte % len;
}
function gcGenCode() {
  const seg = () => Array.from({ length: 4 }, () => GC_CHARSET[randomCharsetIndex(GC_CHARSET.length)]).join('');
  return `CACUSA-${seg()}-${seg()}`;
}
function gcKey(code) { return 'gc:' + String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''); }
async function gcGet(env, code) {
  const raw = await env.CACUSA_KV.get(gcKey(code));
  return raw ? JSON.parse(raw) : null;
}
// Deduce saldo de forma atómica-ish (KV no tiene CAS). Documentado y aceptado desde
// antes de esta auditoría como riesgo de bajo volumen — la auditoría del 19 sep
// (F03-a) reprodujo el escenario real: 2 llamadas concurrentes por $80 sobre saldo
// $100 dejaban saldo $20 en vez de rechazar la segunda. Sigue existiendo como
// FALLBACK para cuando el binding de Durable Object (GiftCardLedger, más abajo)
// todavía no está configurado — usarlo directo ya no es el camino recomendado, ver
// gcReserve()/gcCommit()/gcRelease().
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

// ── Durable Object: GiftCardLedger ───────────────────────────────────────────
// Cierra F03-a de la auditoría del 19 sep: serializa las redenciones de UNA
// tarjeta de regalo — una instancia por código (env.GIFT_CARD_LEDGER.idFromName
// (gcKey(code))). Cloudflare procesa las requests a una misma instancia de a una
// por vez, así que 2 redenciones concurrentes contra el mismo código ya no pueden
// leer el mismo saldo y pisarse, sin necesitar CAS de KV.
//
// CACUSA_KV sigue siendo lo que lee el panel admin para listar/crear/desactivar/
// ajustar tarjetas (handleGcList/handleGcCreate/handleGcDeactivate/handleGcAdjust,
// sin cambios) — esta DO es la única autoridad para el MOMENTO de redimir, y cada
// mutación suya también escribe el balance actualizado de vuelta a KV, para que el
// panel nunca muestre un saldo desactualizado. Queda un residual aceptado: si
// alguien ajusta el saldo a mano desde el panel en el MISMO instante en que una
// reserva está en vuelo, hay una ventana angosta de inconsistencia entre el ajuste
// manual (escribe KV directo) y el commit/release de la DO (también escribe KV) —
// muchísimo más improbable que el escenario real que cierra este cambio (2
// clientas pagando con el mismo código a la vez), y se documenta como tal.
//
// Patrón reserva → confirmar/liberar (no "redimir" directo): al crear el link de
// pago (Square) o al armar el pedido público (Zelle/WhatsApp) se RESERVA el monto
// de inmediato (así 2 sesiones no pueden prometer el mismo saldo, F06) — si el
// pedido nunca se termina de guardar o el pago nunca se confirma, se LIBERA
// (o expira sola via alarm() a las 2h, mismo TTL que pending_order en
// square-payment-worker.js). Si el pedido se guarda / el pago se confirma, se
// CONFIRMA (no vuelve a tocar el balance, ya se descontó al reservar).
//
// Requiere un binding de Durable Object namespace nuevo en Cloudflare — a
// diferencia del resto de este Worker (pegar código + Deploy en el dashboard
// alcanza), la PRIMERA vez que se declara esta clase hace falta una migración
// (`wrangler deploy` con `new_classes` en wrangler.toml) — ver wrangler.toml y
// CLAUDE.md para el detalle. Mientras el binding no exista, gcReserve()/
// gcCommit()/gcRelease() caen solas al camino viejo (gcRedeem directo, sin
// reserva) — el sitio sigue funcionando, solo sin la garantía de atomicidad hasta
// que se complete ese paso manual.
export class GiftCardLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async _loadCard(code) {
    let card = await this.state.storage.get('card');
    if (card === undefined) {
      // Primera vez que se toca este código desde que existe la DO — migración
      // perezosa desde la key legada en KV, para no tener que migrar todo de una.
      const raw = this.env.CACUSA_KV ? await this.env.CACUSA_KV.get(gcKey(code)) : null;
      card = raw ? JSON.parse(raw) : null;
      await this.state.storage.put('card', card);
    }
    return card;
  }

  async _saveCard(code, card) {
    await this.state.storage.put('card', card);
    if (this.env.CACUSA_KV) await this.env.CACUSA_KV.put(gcKey(code), JSON.stringify(card));
  }

  async fetch(request) {
    const url = new URL(request.url);
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const code = String(body.code || '');
    const orderRef = String(body.orderRef || '');

    if (url.pathname === '/reserve') {
      const amountCents = Number(body.amountCents) || 0;
      if (!orderRef || !(amountCents > 0)) return Response.json({ applied: 0 });
      const reservations = (await this.state.storage.get('reservations')) || {};
      if (reservations[orderRef]) {
        // Ya se reservó para este mismo pedido — idempotente, no descuenta 2 veces.
        return Response.json({ applied: reservations[orderRef].appliedCents / 100 });
      }
      const card = await this._loadCard(code);
      if (!card || card.active === false || !(card.balance > 0)) return Response.json({ applied: 0 });
      const applied = Math.min(amountCents / 100, card.balance);
      if (!(applied > 0)) return Response.json({ applied: 0 });
      card.balance = +(card.balance - applied).toFixed(2);
      card.active  = card.balance > 0;
      reservations[orderRef] = { appliedCents: Math.round(applied * 100), committed: false, createdAt: Date.now() };
      await this.state.storage.put('reservations', reservations);
      await this._saveCard(code, card);
      await this.state.storage.setAlarm(Date.now() + 2 * 60 * 60 * 1000);
      return Response.json({ applied, balance: card.balance });
    }

    if (url.pathname === '/commit') {
      // Auditoría externa (22 sep, S02): antes esto devolvía {ok:true} SIEMPRE, incluso
      // si la reserva ya no existía (liberada por /release, expirada por la alarm(), o un
      // orderRef que nunca se reservó) — un caller que confiara en el status/body nunca
      // podía distinguir "confirmado de verdad" de "no había nada que confirmar". Ahora
      // una reserva inexistente es un 409 real — el único caso que sigue devolviendo
      // {ok:true} sin cambiar nada es un commit YA hecho antes (reintento idempotente).
      const reservations = (await this.state.storage.get('reservations')) || {};
      const r = reservations[orderRef];
      if (!r) {
        return Response.json({ ok: false, error: 'reserva no encontrada (ya liberada, vencida, o inexistente)' }, { status: 409 });
      }
      if (r.committed) return Response.json({ ok: true, alreadyCommitted: true });
      r.committed = true;
      await this.state.storage.put('reservations', reservations);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/release') {
      // Auditoría externa (22 sep, S02): antes esto acreditaba el saldo (this._saveCard,
      // que escribe storage Y el espejo en KV) ANTES de borrar la reserva — 2 escrituras
      // independientes con un `await` real en el medio (la del KV mirror puede fallar).
      // Si esa segunda escritura fallaba, la reserva quedaba viva con `committed:false` y
      // el saldo YA acreditado — un reintento de /release volvía a acreditarlo (doble
      // crédito real). `state.storage.transaction()` corre las 2 escrituras (nuevo
      // balance + borrado de la reserva) como una sola unidad atómica dentro del storage
      // de la DO: si algo falla a mitad de camino, ninguna de las 2 queda aplicada.
      let releasedCard = null;
      await this.state.storage.transaction(async (txn) => {
        const reservations = (await txn.get('reservations')) || {};
        const r = reservations[orderRef];
        if (!r || r.committed) return; // idempotente: nada que liberar, no es un error
        const card = await txn.get('card');
        if (card) {
          card.balance = +(card.balance + r.appliedCents / 100).toFixed(2);
          card.active = true;
          await txn.put('card', card);
          releasedCard = card;
        }
        delete reservations[orderRef];
        await txn.put('reservations', reservations);
      });
      // El espejo en CACUSA_KV se escribe DESPUÉS de que la transacción ya confirmó el
      // cambio real en el storage de la DO — si este `put` puntual fallara, el panel
      // mostraría un saldo desactualizado por un momento, pero la DO (la autoridad real)
      // ya quedó consistente; no hay ventana de doble crédito posible.
      if (releasedCard && this.env.CACUSA_KV) {
        await this.env.CACUSA_KV.put(gcKey(code), JSON.stringify(releasedCard));
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === '/admin-set') {
      // Auditoría externa (22 sep, S01): antes, desactivar/ajustar una tarjeta desde el
      // panel (handleGcDeactivate/handleGcAdjust) solo escribía CACUSA_KV — invisible
      // para esta DO una vez que ya había tocado el código alguna vez (su storage queda
      // cacheado desde el primer touch, nunca vuelve a leer KV). Una reserva posterior a
      // esa desactivación seguía viendo el card VIEJO (activo, con el saldo de antes) y
      // la aceptaba, pisando de vuelta el KV con ese estado. Esta ruta deja que el panel
      // toque el estado REAL que la DO usa para decidir, no un espejo aparte.
      const card = await this._loadCard(code);
      if (!card) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
      if (body.active !== undefined) card.active = !!body.active;
      if (body.balance !== undefined) card.balance = +(Number(body.balance) || 0).toFixed(2);
      await this._saveCard(code, card);
      return Response.json({ ok: true, card });
    }

    if (url.pathname === '/get') {
      // Lectura del estado REAL que usa la DO — para que ajustes del panel (que restan
      // un monto del saldo actual) calculen el nuevo saldo contra la autoridad real, no
      // contra un espejo en KV que podría estar desactualizado por una reserva en vuelo.
      const card = await this._loadCard(code);
      return Response.json({ card });
    }

    return new Response('not found', { status: 404 });
  }

  // Barre reservas vencidas sin confirmar (checkout abandonado) y devuelve el
  // saldo — no depende de que nadie vuelva a llamar a esta instancia.
  async alarm() {
    const reservations = (await this.state.storage.get('reservations')) || {};
    const now = Date.now();
    let changed = false;
    for (const [ref, r] of Object.entries(reservations)) {
      if (!r.committed && now - r.createdAt > 2 * 60 * 60 * 1000) {
        const card = await this.state.storage.get('card');
        if (card) {
          card.balance = +(card.balance + r.appliedCents / 100).toFixed(2);
          card.active = true;
          // _saveCard() (no un put directo a this.state.storage) — sin esto, la
          // liberación automática por alarm() actualizaba el balance solo DENTRO de
          // la DO, pero nunca escribía el espejo en CACUSA_KV que lee el panel admin
          // para listar tarjetas: el panel hubiera seguido mostrando el saldo viejo
          // (reservado) aunque la DO ya lo hubiera devuelto de verdad. Encontrado con
          // una simulación local antes de desplegar (ver test-gift-card-ledger.mjs).
          await this._saveCard(card.code, card);
        }
        delete reservations[ref];
        changed = true;
      }
    }
    if (changed) await this.state.storage.put('reservations', reservations);
  }
}

function giftCardLedgerStub(env, code) {
  if (!env.GIFT_CARD_LEDGER) return null;
  const id = env.GIFT_CARD_LEDGER.idFromName(gcKey(code));
  return env.GIFT_CARD_LEDGER.get(id);
}
// orderRef debe ser único por INTENTO de pedido/checkout (ej. `order:<id>` una vez
// asignado, o el referenceId de Square) — llamarlo 2 veces con el mismo orderRef
// es idempotente (no descuenta 2 veces), a propósito, para que un reintento nunca
// duplique el descuento.
async function gcReserve(env, code, amountCents, orderRef) {
  const stub = giftCardLedgerStub(env, code);
  if (!stub) {
    // Sin el binding de Durable Object todavía (falta el paso manual de wrangler,
    // ver CLAUDE.md) — cae al camino viejo no-atómico en vez de romper el sitio.
    return await gcRedeem(env, code, amountCents / 100);
  }
  const r = await stub.fetch('https://gift-card-ledger.internal/reserve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, orderRef, amountCents }),
  });
  return await r.json();
}
// Auditoría externa (22 sep, S02): antes esto nunca miraba `r.ok`/el body de la
// respuesta — un commit que la DO rechazara (409, reserva ya no existe) se trataba
// igual que un éxito silencioso. Ahora lanza si la DO devuelve un error real (no si
// ya estaba comprometido — eso es un reintento idempotente, no un fallo).
async function gcCommit(env, code, orderRef) {
  const stub = giftCardLedgerStub(env, code);
  if (!stub) return; // camino viejo: gcRedeem() ya descontó de una, no hay nada que confirmar
  const r = await stub.fetch('https://gift-card-ledger.internal/commit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, orderRef }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`gcCommit falló (${r.status}): ${d.error || 'sin detalle'}`);
  }
}
async function gcRelease(env, code, orderRef) {
  const stub = giftCardLedgerStub(env, code);
  if (!stub) return; // camino viejo: no hay reserva que liberar (riesgo ya aceptado)
  const r = await stub.fetch('https://gift-card-ledger.internal/release', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, orderRef }),
  });
  if (!r.ok) throw new Error(`gcRelease falló (${r.status})`);
}
// Auditoría externa (22 sep, S01): deja que el panel (handleGcDeactivate/
// handleGcAdjust) actualice el estado REAL que usa la DO, no solo el espejo en KV —
// devuelve null si no hay binding todavía (el llamador cae al camino viejo, KV-only).
async function gcAdminSet(env, code, patch) {
  const stub = giftCardLedgerStub(env, code);
  if (!stub) return null;
  const r = await stub.fetch('https://gift-card-ledger.internal/admin-set', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, ...patch }),
  });
  if (!r.ok) return null;
  return await r.json();
}
// Lee el saldo/estado REAL que usa la DO (no el espejo en KV) — null si no hay binding.
async function gcLedgerGet(env, code) {
  const stub = giftCardLedgerStub(env, code);
  if (!stub) return null;
  const r = await stub.fetch('https://gift-card-ledger.internal/get', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.card || null;
}

// ── Durable Object: OrderIdempotency ─────────────────────────────────────────
// Auditoría externa (22 sep, S04): el patrón "leer marcador → crear pedido →
// escribir marcador" en KV (handleOrder() y handleLoversShipmentIngest(), ver más
// abajo) no es una exclusión mutua real — 2 requests genuinamente concurrentes con
// la misma idempotencyKey/invoiceId pueden ambas leer "sin marcador" ANTES de que
// ninguna escriba, y las 2 terminan creando un pedido separado (o, si el reintento
// llega después de que la primera guardó el pedido pero antes de escribir el
// marcador, lo mismo). Mismo patrón ya cerrado para gift cards (GiftCardLedger,
// ver arriba) — una instancia por key serializa las requests a ESA key sin
// necesitar CAS de KV (que Cloudflare KV no tiene).
//
// Esta DO NO reemplaza el chequeo de huella (fingerprint) que handleOrder() ya
// hace contra `idem:<key>` en KV — solo resuelve la CARRERA (2 requests
// verdaderamente simultáneas viendo "nadie la reclamó todavía" a la vez). El
// contrato:
//   POST /claim {key}    → si nadie reclamó esta key, la marca 'pending' y
//     devuelve {status:'claimed'}. Si otra request la tiene reclamada AHORA MISMO
//     (todavía no llamó /finalize ni /release), devuelve {status:'in_progress'} —
//     el caller reintenta con backoff corto (ver orderIdemClaim). Si ya está
//     'done', devuelve {status:'done', orderId, fingerprint} — el pedido ya existe.
//   POST /finalize {key, orderId, fingerprint} → marca 'done'. Cualquier /claim
//     futuro con esta key ya ve 'done' para siempre (no hay TTL — mismo criterio
//     que `idem:<key>` en KV, que vive 24h; acá no hace falta expirar nada porque
//     el volumen es bajo y cada key es del tamaño de un id + huella).
//   POST /release {key}  → si el pedido nunca se llegó a guardar de verdad (ej. el
//     catálogo rechazó el carrito después de reclamar, o la escritura a KV falló),
//     vuelve a 'none' para que un reintento genuino no quede bloqueado para
//     siempre.
// Una alarma de 5 minutos (order creation es casi instantáneo — es un margen
// generoso) libera sola un 'pending' que nunca llegó a /finalize ni /release (ej.
// el Worker se cayó a mitad de camino) — mismo criterio que la alarm() de 2h de
// GiftCardLedger para reservas abandonadas, solo que acá el timeout es mucho más
// corto porque no hay ningún "checkout que la clienta puede dejar a medias":
// crear un pedido ya-validado es una operación de servidor de punta a punta.
//
// Requiere el mismo tipo de binding de Durable Object que GiftCardLedger — ver
// wrangler.admin.toml (una migración nueva, `new_sqlite_classes = ["OrderIdempotency"]`,
// además de la que ya existe para GiftCardLedger) y CLAUDE.md. Sin el binding
// todavía, orderIdemClaim() devuelve `{claimed:true}` siempre — el sitio sigue
// funcionando exactamente como antes de este fix (protegido solo por el chequeo de
// KV ya existente, con la misma ventana de carrera que se documentó como riesgo
// aceptado hasta completar este paso manual).
export class OrderIdempotency {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    let body = {};
    try { body = await request.json(); } catch (_) {}

    if (url.pathname === '/claim') {
      let record = await this.state.storage.get('record');
      if (!record) {
        await this.state.storage.put('record', { status: 'pending' });
        await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
        return Response.json({ status: 'claimed' });
      }
      if (record.status === 'done') {
        return Response.json({ status: 'done', orderId: record.orderId, fingerprint: record.fingerprint });
      }
      return Response.json({ status: 'in_progress' });
    }

    if (url.pathname === '/finalize') {
      await this.state.storage.put('record', { status: 'done', orderId: body.orderId, fingerprint: body.fingerprint || null });
      return Response.json({ ok: true });
    }

    if (url.pathname === '/release') {
      await this.state.storage.delete('record');
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  // Libera sola un 'pending' que nunca llegó a /finalize ni /release — ver
  // comentario largo junto a la clase.
  async alarm() {
    const record = await this.state.storage.get('record');
    if (record && record.status === 'pending') {
      await this.state.storage.delete('record');
    }
  }
}

function orderIdemStub(env, key) {
  if (!env.ORDER_IDEMPOTENCY) return null;
  const id = env.ORDER_IDEMPOTENCY.idFromName(key);
  return env.ORDER_IDEMPOTENCY.get(id);
}
// Reclama una key — hasta 5 reintentos cortos (150ms) si otra request la tiene
// reclamada AHORA MISMO (carrera verdadera, rarísima en la práctica: el caso real
// que esto cierra son 2 reintentos casi simultáneos del mismo webhook/checkout, no
// 2 clics genuinos del mismo humano en el mismo instante). Devuelve:
//   {claimed:true}                              → nadie más la tiene, proceder
//   {claimed:false, orderId, fingerprint}        → ya existe (status 'done')
//   {claimed:false, timedOut:true}               → sigue en curso tras esperar
async function orderIdemClaim(env, key) {
  const stub = orderIdemStub(env, key);
  if (!stub) return { claimed: true }; // sin binding todavía: cae al chequeo KV-only existente
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await stub.fetch('https://order-idempotency.internal/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const d = await r.json();
    if (d.status === 'claimed') return { claimed: true };
    if (d.status === 'done') return { claimed: false, orderId: d.orderId, fingerprint: d.fingerprint };
    await new Promise((res) => setTimeout(res, 150)); // 'in_progress' — esperar y reintentar
  }
  return { claimed: false, timedOut: true };
}
async function orderIdemFinalize(env, key, orderId, fingerprint) {
  const stub = orderIdemStub(env, key);
  if (!stub) return;
  await stub.fetch('https://order-idempotency.internal/finalize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, orderId, fingerprint: fingerprint || null }),
  });
}
async function orderIdemRelease(env, key) {
  const stub = orderIdemStub(env, key);
  if (!stub) return;
  await stub.fetch('https://order-idempotency.internal/release', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
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
  // Auditoría externa (22 sep, S01): enrutar por la DO primero — ver gcAdminSet() y el
  // comentario largo junto a la clase GiftCardLedger. Si no hay binding todavía, cae al
  // camino viejo (solo KV) de siempre.
  const viaLedger = await gcAdminSet(env, body.code, { active: false });
  if (viaLedger) return ok({ ok: true, card: viaLedger.card }, origin);
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
  // Auditoría externa (22 sep, S01): calcular el nuevo saldo contra el estado REAL de
  // la DO (gcLedgerGet), no contra el espejo en KV que ya leyó gcGet() arriba (solo se
  // usa para el chequeo de "tarjeta no encontrada") — una reserva en vuelo puede haber
  // dejado el saldo de la DO más bajo que el de KV en el instante exacto de este ajuste.
  const ledgerCard = await gcLedgerGet(env, body.code);
  const currentBalance = ledgerCard ? ledgerCard.balance : card.balance;
  const newBalance = +Math.max(0, currentBalance - used).toFixed(2);
  const newActive  = newBalance > 0;
  const viaLedger = await gcAdminSet(env, body.code, { balance: newBalance, active: newActive });
  if (viaLedger) return ok({ ok: true, card: viaLedger.card }, origin);
  card.balance = newBalance;
  card.active  = newActive;
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
// email: opcional — solo lo exige un cupón con restrictToEmail (ver welcome10 más abajo).
// Los cupones normales (sin ese campo) ignoran el parámetro, así que esto es
// retrocompatible con todos los cupones creados antes de que existiera.
// Compara 2 teléfonos por sus últimos 7 dígitos — misma normalización laxa que usa
// isActiveLoversPhone() contra Firebase. A propósito no es comparación exacta: la
// misma clienta escribe su número con o sin código de país según el formulario, y
// exigir coincidencia byte a byte la dejaría fuera de su propio beneficio.
function samePhone(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  return da.length >= 7 && db.length >= 7 && da.slice(-7) === db.slice(-7);
}
// Auditoría externa (22 sep, S08a): antes el chequeo de "cupón ya usado" (cpused:ph/em)
// solo vivía en /coupon/validate (aviso en pantalla) y en /coupon/burn (al confirmar el
// pago) — el CÁLCULO real del descuento en handleOrder() nunca lo consultaba, así que
// un cupón ya marcado como usado igual se restaba del total de un pedido nuevo (recién
// se rechazaba después, al intentar "quemarlo" de nuevo — demasiado tarde, el pedido ya
// se había guardado con el descuento aplicado). Ahora couponIsValid() es la única
// función de validación, y hacerla async + pasarle `env` le permite chequear cpused acá
// también, en el único lugar que de verdad calcula cuánto se descuenta.
async function couponIsValid(c, email, phone, env) {
  if (!c || !c.active) return false;
  if (c.expiresAt && new Date(c.expiresAt + 'T23:59:59') < new Date()) return false;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return false;
  if (c.restrictToEmail && (!email || email.toLowerCase() !== c.restrictToEmail.toLowerCase())) return false;
  // restrictToPhone ata el cupón de envío gratis a la suscriptora que lo pidió. Sin
  // esto el código ENVIO… servía para cualquiera que lo tuviera, sin vencimiento —
  // y como no tiene tope de usos (el beneficio es "envío gratis en TODA compra"),
  // compartirlo una vez lo regalaba para siempre.
  if (c.restrictToPhone && !samePhone(phone, c.restrictToPhone)) return false;
  // repeatableByDesign: cupones pensados para que la MISMA persona los reuse en cada
  // compra (restrictToEmail, o el envío gratis de Lovers) nunca se marcan "usado" contra
  // ella — mismo criterio ya usado en handleCouponValidate/couponLoadValid (Square).
  const repeatableByDesign = !!(c.restrictToEmail || c.kind === 'lovers-shipping');
  if (!repeatableByDesign && env && env.CACUSA_KV) {
    const rawPhone = String(phone || '').replace(/\D/g, '');
    const rawEmail = String(email || '').toLowerCase().trim();
    if (rawPhone.length >= 7 && await env.CACUSA_KV.get(`cpused:ph:${rawPhone}:${c.code}`)) return false;
    if (rawEmail.includes('@') && await env.CACUSA_KV.get(`cpused:em:${rawEmail}:${c.code}`)) return false;
  }
  return true;
}

// ── Cupón de bienvenida (10% al registrarse con el email en la tienda) ─────────────
// Antes de esto, el popup del 10% solo abría WhatsApp — el descuento real lo daba
// alguien del equipo a mano, coordinando por chat. Este código es real, automático,
// y (a diferencia de AMIGA+teléfono en el referido) no es adivinable: se deriva por
// HMAC del email igual que loversShippingCode(), así que pedirlo dos veces da el
// mismo código sin duplicar cupones, pero nadie más que esa clienta puede reconstruirlo
// a partir de su propio email — y aunque lo adivinara, restrictToEmail igual lo bloquea
// para cualquier otro comprador en /coupon/validate.
async function welcomeCouponCode(email, env) {
  const sig = await hmac('welcome10:' + email, env.SESSION_SECRET);
  const clean = sig.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return 'BIENVENIDA' + clean.slice(0, 6);
}
async function ensureWelcomeCoupon(email, env) {
  const code = await welcomeCouponCode(email, env);
  let coupon = await couponGet(env, code);
  if (!coupon) {
    const expires = new Date();
    expires.setMonth(expires.getMonth() + 3);
    coupon = {
      code, type: 'percent', amount: 10, kind: 'welcome10',
      maxUses: 1, usedCount: 0, active: true,
      expiresAt: expires.toISOString().slice(0, 10),
      restrictToEmail: email,
      note: `Bienvenida 10% — ${email}`,
      createdAt: new Date().toISOString(), createdBy: 'welcome-system',
    };
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  }
  return code;
}

// ── Plantilla de correo con la identidad visual del sitio ───────────────────────
// HTML "old-school" (tablas, estilos inline, sin flexbox/grid/gradientes CSS externos)
// a propósito — es lo único que se renderiza igual de bien en Gmail, Outlook, Apple
// Mail, etc. La paleta es la misma de index.html/cacusa-lovers.html (--pink-deep,
// --ink, --grad-warm...); "declarar background-color antes que background-image" es
// el patrón estándar para que el degradado se vea en los clientes que sí lo soportan
// y quede en un rosado sólido razonable en los que no.
function emailShell({ lang, preheader, eyebrow, title, code, bullets, ctaText, ctaUrl }) {
  const bulletsHtml = bullets.map(b => `<tr><td style="padding:3px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#96486F">${b}</td></tr>`).join('');
  const waMsg = lang === 'en' ? encodeURIComponent('Hi! I have a question about my CACUSA by Taitus coupon.') : encodeURIComponent('Hola, tengo una consulta sobre mi cupón de CACUSA by Taitus.');
  const footerText = lang === 'en'
    ? `Questions? <a href="https://wa.me/17867375336?text=${waMsg}" style="color:#C0336E;font-weight:600;text-decoration:none">Chat with us on WhatsApp</a>`
    : `¿Dudas? <a href="https://wa.me/17867375336?text=${waMsg}" style="color:#C0336E;font-weight:600;text-decoration:none">Escríbenos por WhatsApp</a>`;
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#FEF8FF;">
<span style="display:none;visibility:hidden;opacity:0;overflow:hidden;height:0;width:0;max-height:0;max-width:0;mso-hide:all;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF8FF;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #F3E4EE;">
<tr><td style="background-color:#EE6FA8;background-image:linear-gradient(135deg,#F5C8A8,#EE6FA8,#C4A0EC);padding:34px 24px;text-align:center;">
<div style="font-family:Georgia,'Bodoni Moda',serif;font-size:26px;font-weight:700;letter-spacing:.12em;color:#FFFFFF;">CACUSA</div>
<div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#FFFFFF;opacity:.92;margin-top:2px;">by Taitus</div>
</td></tr>
<tr><td style="padding:32px 30px 28px;text-align:center;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#C0336E;margin-bottom:10px;">${eyebrow}</div>
<div style="font-family:Georgia,'Bodoni Moda',serif;font-size:22px;font-weight:700;color:#8B2A5A;margin-bottom:18px;">${title}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 18px;">
<tr><td style="background:#FCE8F3;border:1.5px dashed #C0336E;border-radius:10px;padding:14px 30px;">
<span style="font-family:Georgia,'Bodoni Moda',serif;font-size:24px;font-weight:700;letter-spacing:3px;color:#C0336E;">${code}</span>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">${bulletsHtml}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
<tr><td style="background-color:#EE6FA8;background-image:linear-gradient(135deg,#EE6FA8,#C4A0EC);border-radius:999px;">
<a href="${ctaUrl}" style="display:inline-block;padding:14px 34px;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:14px;color:#FFFFFF;text-decoration:none;">${ctaText}</a>
</td></tr>
</table>
</td></tr>
<tr><td style="background:#FEF0E4;padding:16px 24px;text-align:center;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;">${footerText}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Escape mínimo para texto libre (nombre de producto, personalización, nombre de
// clienta) que se interpola en los correos nuevos de abajo — a diferencia de
// welcomeEmailContent()/loversExclusiveEmailContent(), que solo interpolan un código
// de cupón generado por el sistema, estos 3 sí meten texto que viene de la clienta o
// del catálogo (editable desde el admin) — sin esto, un nombre con "&"/"<"/">" rompería
// el HTML del correo.
function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Plantilla de correo genérica (21-22 sep) — mismo look que emailShell() (banner,
// tarjeta, tipografías, pie con WhatsApp) pero sin el slot fijo de código+bullets, para
// los 3 correos transaccionales nuevos (confirmación de pedido, envío/tracking,
// suscripción) que necesitan contenido de forma libre (tabla de productos, caja de
// tracking, lista de beneficios) en vez de un cupón.
function emailShellGeneric({ lang, preheader, eyebrow, title, bodyHtml, ctaText, ctaUrl }) {
  const waMsg = lang === 'en' ? encodeURIComponent('Hi! I have a question about my CACUSA by Taitus order.') : encodeURIComponent('Hola, tengo una consulta sobre mi pedido de CACUSA by Taitus.');
  const footerText = lang === 'en'
    ? `Questions? <a href="https://wa.me/17867375336?text=${waMsg}" style="color:#C0336E;font-weight:600;text-decoration:none">Chat with us on WhatsApp</a>`
    : `¿Dudas? <a href="https://wa.me/17867375336?text=${waMsg}" style="color:#C0336E;font-weight:600;text-decoration:none">Escríbenos por WhatsApp</a>`;
  const ctaHtml = ctaUrl ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px auto 0;">
<tr><td style="background-color:#EE6FA8;background-image:linear-gradient(135deg,#EE6FA8,#C4A0EC);border-radius:999px;">
<a href="${ctaUrl}" style="display:inline-block;padding:14px 34px;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:14px;color:#FFFFFF;text-decoration:none;">${ctaText}</a>
</td></tr>
</table>` : '';
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#FEF8FF;">
<span style="display:none;visibility:hidden;opacity:0;overflow:hidden;height:0;width:0;max-height:0;max-width:0;mso-hide:all;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF8FF;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:18px;overflow:hidden;border:1px solid #F3E4EE;">
<tr><td style="background-color:#EE6FA8;background-image:linear-gradient(135deg,#F5C8A8,#EE6FA8,#C4A0EC);padding:34px 24px;text-align:center;">
<div style="font-family:Georgia,'Bodoni Moda',serif;font-size:26px;font-weight:700;letter-spacing:.12em;color:#FFFFFF;">CACUSA</div>
<div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#FFFFFF;opacity:.92;margin-top:2px;">by Taitus</div>
</td></tr>
<tr><td style="padding:32px 30px 28px;text-align:center;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#C0336E;margin-bottom:10px;">${eyebrow}</div>
<div style="font-family:Georgia,'Bodoni Moda',serif;font-size:22px;font-weight:700;color:#8B2A5A;margin-bottom:18px;">${title}</div>
${bodyHtml}
${ctaHtml}
</td></tr>
<tr><td style="background:#FEF0E4;padding:16px 24px;text-align:center;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;">${footerText}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Correo de confirmación de pedido — se dispara desde handleOrder()/handleOrderManual()
// justo después de persistir el pedido de verdad (nunca antes, nunca en un reintento).
function orderConfirmationEmailContent(order, lang) {
  const nombre = (order.cliente && order.cliente.nombre || '').trim();
  const numero = order.numero || ('#' + order.id);
  const money = n => '$' + (Number(n) || 0).toFixed(2);
  const rows = (order.productos || []).map(p => `
<tr>
<td style="padding:8px 0;border-bottom:1px solid #F3E4EE;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8B2A5A;">
${esc(p.name)}${p.qty > 1 ? ` × ${p.qty}` : ''}${p.personalization ? `<div style="font-size:11px;color:#96486F;font-style:italic;">${esc(p.personalization)}</div>` : ''}
</td>
<td style="padding:8px 0;border-bottom:1px solid #F3E4EE;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8B2A5A;white-space:nowrap;">
${money(p.price * (p.qty || 1))}
</td>
</tr>`).join('');
  const totalsRow = (label, val) => `
<tr><td style="padding:4px 0;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;">${label}</td>
<td style="padding:4px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;">${money(val)}</td></tr>`;
  const bodyHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
${totalsRow(lang === 'en' ? 'Subtotal' : 'Subtotal', order.subtotal)}
${totalsRow(lang === 'en' ? 'Shipping' : 'Envío', order.envio)}
${order.impuesto ? totalsRow(lang === 'en' ? 'Tax' : 'Impuesto', order.impuesto) : ''}
<tr><td style="padding:8px 0 0;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#8B2A5A;border-top:1.5px solid #C0336E;">Total</td>
<td style="padding:8px 0 0;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#C0336E;border-top:1.5px solid #C0336E;">${money(order.total)}</td></tr>
</table>`;
  const storeUrl = lang === 'en' ? 'https://cacusabytaitus.com/en/ui_kits/store/' : 'https://cacusabytaitus.com/ui_kits/store/';
  if (lang === 'en') {
    return {
      subject: `Order confirmed — ${numero} — CACUSA by Taitus`,
      html: emailShellGeneric({
        lang, preheader: `We've got your order ${numero} — here's what you ordered.`,
        eyebrow: 'Order confirmed', title: `Thank you${nombre ? ', ' + esc(nombre) : ''}! ✦`,
        bodyHtml, ctaText: 'Keep shopping →', ctaUrl: storeUrl,
      }),
    };
  }
  return {
    subject: `Pedido confirmado — ${numero} — CACUSA by Taitus`,
    html: emailShellGeneric({
      lang, preheader: `Ya tenemos tu pedido ${numero} — esto es lo que compraste.`,
      eyebrow: 'Pedido confirmado', title: `¡Gracias${nombre ? ', ' + esc(nombre) : ''}! ✦`,
      bodyHtml, ctaText: 'Seguir comprando →', ctaUrl: storeUrl,
    }),
  };
}

// Correo de confirmación de envío — se dispara desde handleUspsLabel() justo después
// de persistir el tracking real de la guía ya generada.
function shippingConfirmationEmailContent(order, trackingUrl, lang) {
  const nombre = (order.cliente && order.cliente.nombre || '').trim();
  const bodyHtml = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 18px;">
<tr><td style="background:#FCE8F3;border:1.5px dashed #C0336E;border-radius:10px;padding:14px 30px;text-align:center;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#96486F;margin-bottom:4px;">${lang === 'en' ? 'Tracking number' : 'Número de guía'}</div>
<span style="font-family:Georgia,'Bodoni Moda',serif;font-size:20px;font-weight:700;letter-spacing:1px;color:#C0336E;">${esc(order.tracking || '')}</span>
</td></tr>
</table>`;
  if (lang === 'en') {
    return {
      subject: 'Your order is on its way — CACUSA by Taitus',
      html: emailShellGeneric({
        lang, preheader: 'Your USPS tracking number is ready.',
        eyebrow: 'Shipped', title: `On its way${nombre ? ', ' + esc(nombre) : ''}! ✦`,
        bodyHtml, ctaText: 'Track on USPS.com →', ctaUrl: trackingUrl,
      }),
    };
  }
  return {
    subject: 'Tu pedido va en camino — CACUSA by Taitus',
    html: emailShellGeneric({
      lang, preheader: 'Tu número de guía USPS ya está listo.',
      eyebrow: 'Enviado', title: `Va en camino${nombre ? ', ' + esc(nombre) : ''}! ✦`,
      bodyHtml, ctaText: 'Rastrear en USPS.com →', ctaUrl: trackingUrl,
    }),
  };
}

// Correo de bienvenida/confirmación de suscripción — se dispara SOLO en la transición
// hacia estado_pago:'activo' (ver wasActive en lovers-webhook-worker.js), nunca en
// cada renovación mensual/anual.
function subscriptionConfirmationEmailContent(subscriberData, lang) {
  const nombre = (subscriberData.nombre || '').trim();
  const plan = subscriberData.plan || 'Cacusa Lovers';
  const monto = subscriberData.monto || '';
  const bullets = lang === 'en' ? [
    '5% off, always — on every purchase in the store.',
    'Free shipping on every shipment while your subscription is active.',
    'A curated Cacusa piece delivered every cycle.',
  ] : [
    '5% de descuento siempre — en cada compra de la tienda.',
    'Envío gratis en cada ciclo mientras tu suscripción siga activa.',
    'Una pieza Cacusa elegida especialmente para ti cada ciclo.',
  ];
  const bodyHtml = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 18px;">
<tr><td style="background:#FCE8F3;border:1.5px dashed #C0336E;border-radius:10px;padding:12px 26px;text-align:center;">
<span style="font-family:Georgia,'Bodoni Moda',serif;font-size:17px;font-weight:700;color:#C0336E;">${esc(plan)}</span>
${monto ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;margin-top:2px;">${esc(monto)}</div>` : ''}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${bullets.map(b => `<tr><td style="padding:3px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#96486F;text-align:left;">${b}</td></tr>`).join('')}
</table>`;
  const storeUrl = lang === 'en' ? 'https://cacusabytaitus.com/en/ui_kits/store/' : 'https://cacusabytaitus.com/ui_kits/store/';
  if (lang === 'en') {
    return {
      subject: 'Welcome to Cacusa Lovers ✦',
      html: emailShellGeneric({
        lang, preheader: 'Your Cacusa Lovers membership is active.',
        eyebrow: 'Cacusa Lovers', title: `Welcome${nombre ? ', ' + esc(nombre) : ''}! ✦`,
        bodyHtml, ctaText: 'Shop now →', ctaUrl: storeUrl,
      }),
    };
  }
  return {
    subject: 'Bienvenida a Cacusa Lovers ✦',
    html: emailShellGeneric({
      lang, preheader: 'Tu membresía Cacusa Lovers ya está activa.',
      eyebrow: 'Cacusa Lovers', title: `Bienvenida${nombre ? ', ' + esc(nombre) : ''}! ✦`,
      bodyHtml, ctaText: 'Ir a la tienda →', ctaUrl: storeUrl,
    }),
  };
}

function welcomeEmailContent(code, lang) {
  const storeUrl = lang === 'en' ? 'https://cacusabytaitus.com/en/ui_kits/store/' : 'https://cacusabytaitus.com/ui_kits/store/';
  if (lang === 'en') {
    return {
      subject: 'Your 10% off code — CACUSA by Taitus',
      html: emailShell({
        lang, preheader: 'Your 10% off code is ready — use it on your first purchase.',
        eyebrow: 'Exclusive offer', title: 'Here’s your 10% off code ✦', code,
        bullets: [
          'Valid for 3 months from today.',
          'One-time use, only for this email address.',
          'Does not apply to Cacusa Gold products.',
        ],
        ctaText: 'Shop now →', ctaUrl: storeUrl,
      }),
    };
  }
  return {
    subject: 'Tu código de 10% de descuento — CACUSA by Taitus',
    html: emailShell({
      lang, preheader: 'Tu código de 10% ya está listo — úsalo en tu primera compra.',
      eyebrow: 'Oferta exclusiva', title: 'Aquí tienes tu código de 10% ✦', code,
      bullets: [
        'Válido por 3 meses desde hoy.',
        'Un solo uso, solo para este correo.',
        'No aplica en productos de Cacusa Gold.',
      ],
      ctaText: 'Ir a la tienda →', ctaUrl: storeUrl,
    }),
  };
}

// refreshCache=false para cuando quien llama (handleLeadRegister) va a hacer un solo
// refresh consolidado al final, con un array que ya incluye este cambio — evita que
// esto dispare su propio escaneo completo de lead:* además del de quien llama.
async function markLeadWelcomeSent(email, env, code, { refreshCache = true } = {}) {
  const key = leadKey(email);
  const raw = await env.CACUSA_KV.get(key);
  if (!raw) return;
  let lead; try { lead = JSON.parse(raw); } catch { return; }
  lead.welcomeSent = true;
  lead.welcomeCode = code;
  lead.welcomeSentAt = new Date().toISOString();
  await env.CACUSA_KV.put(key, JSON.stringify(lead));
  if (refreshCache) await refreshLeadsCache(env).catch(() => {});
}

// Punto único que usan tanto el disparo automático (handleLeadRegister) como el botón
// manual del panel (handleLeadSendWelcome) — nunca revienta el flujo que lo llama.
async function sendWelcomeCode(email, lang, env, opts) {
  const code = await ensureWelcomeCoupon(email, env);
  const content = welcomeEmailContent(code, lang);
  await sendGmail(env, { to: email, ...content });
  await markLeadWelcomeSent(email, env, code, opts);
  return code;
}

// ── Cupón exclusivo de Cacusa Lovers (5% permanente, en toda compra) ───────────────
// A diferencia de welcome10 (un solo uso, 3 meses): este NO tiene maxUses ni
// expiresAt — vive mientras la suscripción siga activa. lovers-webhook-worker.js
// avisa cuándo activar/desactivar (vía Service Binding, ORDER_INGEST_KEY) desde el
// mismo lugar donde ya marca a alguien 'activo'/'cancelado' — nadie del equipo tiene
// que acordarse de hacerlo a mano. Idempotente: activar de nuevo a alguien que ya
// tenía el cupón activo no hace nada (y sobre todo, no le reenvía el correo) — así
// es seguro llamarlo en cada cobro mensual/anual, no solo la primera vez.
async function loversExclusiveCode(email, env) {
  const sig = await hmac('lovers-exclusive:' + email, env.SESSION_SECRET);
  const clean = sig.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return 'LOVERS5' + clean.slice(0, 6);
}
function loversExclusiveEmailContent(code, lang) {
  const storeUrl = lang === 'en' ? 'https://cacusabytaitus.com/en/ui_kits/store/' : 'https://cacusabytaitus.com/ui_kits/store/';
  if (lang === 'en') {
    return {
      subject: 'Your exclusive Cacusa Lovers coupon — 5% off, always',
      html: emailShell({
        lang, preheader: 'Your exclusive Lovers coupon: 5% off every purchase, no limit.',
        eyebrow: 'Cacusa Lovers member benefit', title: 'Your exclusive Lovers coupon ✦', code,
        bullets: [
          'Use it on every purchase in the store.',
          'No expiration, no limit on how many times you use it.',
          'Stays active for as long as your subscription does.',
          'Does not apply to Cacusa Gold products.',
        ],
        ctaText: 'Shop now →', ctaUrl: storeUrl,
      }),
    };
  }
  return {
    subject: 'Tu cupón exclusivo de Cacusa Lovers — 5% siempre',
    html: emailShell({
      lang, preheader: 'Tu cupón exclusivo de Lovers: 5% en cada compra, sin límite.',
      eyebrow: 'Beneficio de Cacusa Lovers', title: 'Tu cupón exclusivo de Lovers ✦', code,
      bullets: [
        'Úsalo en cada compra que hagas en la tienda.',
        'Sin vencimiento, sin límite de veces que lo uses.',
        'Se mantiene activo mientras siga tu suscripción.',
        'No aplica en productos de Cacusa Gold.',
      ],
      ctaText: 'Ir a la tienda →', ctaUrl: storeUrl,
    }),
  };
}
// action: 'activate' (default) | 'deactivate'. Nunca lanza — quien la llama (la ruta
// interna, o el envío masivo) decide si loguea el error.
async function handleLoversExclusiveCoupon(body, env) {
  if (!env.CACUSA_KV) return;
  const email = String(body.email || '').toLowerCase().trim();
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');

  if (body.action === 'deactivate') {
    // Cancelar apaga los DOS beneficios de la suscripción, no solo el 5%: el cupón
    // exclusivo (atado al email) y el de envío gratis (atado al teléfono). El de
    // envío se busca por índice porque su código es un HMAC de una sola vía — con
    // el teléfono que guarda Firebase no siempre se puede recalcular igual.
    if (isValidEmail(email)) await setCouponActive(env, await loversExclusiveCode(email, env), false);
    if (phoneDigits.length >= 7) {
      const shipCode = await env.CACUSA_KV.get(loversShipIndexKey(phoneDigits));
      if (shipCode) await setCouponActive(env, shipCode, false);
    }
    return;
  }

  if (!isValidEmail(email)) return;
  const code = await loversExclusiveCode(email, env);
  const coupon = await couponGet(env, code);
  if (!coupon) {
    const fresh = {
      code, type: 'percent', amount: 5, kind: 'lovers-exclusive',
      maxUses: null, usedCount: 0, active: true, expiresAt: null,
      restrictToEmail: email,
      note: `Cupón exclusivo Lovers — ${email}`,
      createdAt: new Date().toISOString(), createdBy: 'lovers-system',
    };
    // Auditoría de integridad (19 sep, F09): el comentario original acá decía que este
    // orden (correo antes que KV) ya seguía el mismo patrón "correcto" que welcome10 —
    // falso: welcome10 hace KV primero, correo después (ver sendWelcomeCode). Pero
    // igualar el orden acá NO es la mejora que parece: welcome10 es de un solo uso con
    // vencimiento a 3 meses, mientras que este cupón es permanente y sin tope de usos —
    // si se guardara en KV primero y el correo fallara después (Gmail: rate limit, token
    // vencido — el modo de fallo real y documentado de este Worker), el cupón quedaría
    // `active:true` para siempre sin que la clienta lo supiera NUNCA, porque tanto este
    // mismo bloque (`if (!coupon)`) como el botón masivo del panel
    // (`handleLoversExclusiveBulk`, ver más abajo) saltan cualquier cupón ya activo —
    // no hay ningún camino que reintente solo el envío del correo. Manteniendo el
    // correo ANTES del KV.put, el único modo de fallo real es la ventana angosta e
    // infrecuente de "el correo salió pero el KV.put local falló justo después" — se
    // autocorrige solo en el próximo evento real (el código es determinístico por HMAC,
    // así que reenviar el mismo correo no duplica nada, y en cuanto el KV.put logre
    // escribir, el código ya funciona). Documentado a propósito, no un bug pendiente.
    const lang = body.lang === 'en' ? 'en' : 'es';
    await sendGmail(env, { to: email, ...loversExclusiveEmailContent(code, lang) });
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(fresh));
  } else if (!coupon.active) {
    coupon.active = true;
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  }
}

// Envío masivo manual — para las suscriptoras que ya estaban activas antes de que
// este beneficio existiera (las nuevas lo reciben solas, ver /internal/lovers/exclusive-coupon).
// La lista de quiénes están activas la decide el panel (ya la tiene cargada desde
// Firebase vía lovers-webhook-worker.js); este Worker no habla con Firebase.
async function handleLoversExclusiveBulk(body, env, origin) {
  if (!Array.isArray(body.subscribers)) return err('Falta la lista de suscriptoras', 400, origin);
  const results = { sent: 0, alreadyActive: 0, failed: 0 };
  for (const s of body.subscribers.slice(0, 500)) {
    const email = String((s && s.email) || '').toLowerCase().trim();
    if (!isValidEmail(email)) { results.failed++; continue; }
    try {
      const code = await loversExclusiveCode(email, env);
      const existing = await couponGet(env, code);
      if (existing && existing.active) { results.alreadyActive++; continue; }
      await handleLoversExclusiveCoupon({ action: 'activate', email, lang: s && s.lang }, env);
      results.sent++;
    } catch (e) {
      console.error('exclusive bulk falló para', email, ':', e.message);
      results.failed++;
    }
  }
  return ok({ ok: true, ...results }, origin);
}

const LOVERS_WORKER_URL = 'https://cacusa-lovers-webhook.facturacioncacusa.workers.dev';

// Cloudflare bloquea que un Worker le haga fetch() a otro Worker de la misma cuenta usando
// su URL *.workers.dev (error 1042, "This request could not be routed"). El Service Binding
// LOVERS_WEBHOOK (Cloudflare → cacusa-admin → Settings → Bindings → Add → Service binding →
// apunta a cacusa-lovers-webhook) enruta la llamada directo entre Workers sin pasar por ese
// límite. Si el binding todavía no está configurado, cae de vuelta al fetch() normal — que
// es justamente el que dispara el 1042, así que hasta configurarlo estas llamadas siguen
// fallando. Mismo patrón que adminFetch() en square-payment-worker.js.
function loversFetch(env, path, options) {
  const url = `${LOVERS_WORKER_URL}${path}`;
  return env.LOVERS_WEBHOOK ? env.LOVERS_WEBHOOK.fetch(url, options) : fetch(url, options);
}

// ── Verifica contra cacusa-lovers-webhook (Worker-a-Worker, ORDER_INGEST_KEY) si un
// teléfono pertenece a una suscriptora activa de Cacusa Lovers. Falla cerrado: cualquier
// error de red o de configuración se trata como "no activa", nunca como "activa".
async function isActiveLoversPhone(phoneDigits, env) {
  if (!env.ORDER_INGEST_KEY) return false;
  try {
    const r = await loversFetch(env, `/internal/lovers/active?phone=${encodeURIComponent(phoneDigits)}`, {
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
// Auditoría de seguridad (2ª ronda, 13 sep) — hallazgo medio, cerrado parcialmente el
// 19 sep: la respuesta distinguía "no sos suscriptora activa" (403, texto explícito) de
// "acá está tu código" (200) — eso convierte al endpoint en una forma de preguntar,
// número por número, quién está suscrita a Cacusa Lovers. Cerrarlo del todo requeriría
// no revelar nada en la respuesta y mandar el código por WhatsApp Business API en vez de
// mostrarlo en pantalla — infraestructura que este sitio no tiene hoy (decisión explícita
// de no construirla en esta tanda). Mitigación aplicada mientras tanto, sin tocar la UX
// de la suscriptora real: el mismo mensaje y el mismo código HTTP (429) para los 3 casos
// de fallo (rate-limit por IP, rate-limit por teléfono, no-es-suscriptora), para que ni
// el texto ni el status code confirmen cuál de los 3 pasó — más un tope de intentos POR
// TELÉFONO además del tope por IP, para que alguien con varias IPs no pueda barrer la
// misma lista de números más rápido que una suscriptora real reintentando el suyo por
// error de tipeo. La señal de fondo (¿vino un código real o no?) sigue existiendo — eso
// solo se cierra del todo con el canal de WhatsApp, ver más arriba.
const REFERRAL_GENERIC_MSG = 'No se pudo generar el código en este momento. Si sos suscriptora activa de Cacusa Lovers y el problema persiste, escríbenos por WhatsApp.';
async function handleReferralCode(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `refrl:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= 10) return err(REFERRAL_GENERIC_MSG, 429, origin);
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  const name = String(body.name || '').trim().slice(0, 100);
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  if (!name || phoneDigits.length < 7) {
    return err('Faltan nombre o teléfono válido', 400, origin);
  }
  const phoneRlKey = `refrlph:${phoneDigits.slice(-7)}`;
  const phoneRlCount = parseInt((await env.CACUSA_KV.get(phoneRlKey)) || '0', 10);
  if (phoneRlCount >= 5) return err(REFERRAL_GENERIC_MSG, 429, origin);
  await env.CACUSA_KV.put(phoneRlKey, String(phoneRlCount + 1), { expirationTtl: 3600 });
  if (!(await isActiveLoversPhone(phoneDigits, env))) {
    return err(REFERRAL_GENERIC_MSG, 429, origin);
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

// ── Envío gratis para suscriptoras de Cacusa Lovers ────────────────────────────────────
// La página de Lovers promete "envíos gratis en todas tus compras en tienda". Hasta la
// auditoría del 13 sep eso no existía en ninguna parte del código: la tienda aplicaba el
// umbral de envío gratis ($90) a todo el mundo por igual, así que una suscriptora pagaba
// envío igual que cualquiera. Esto lo implementa.
//
// Un código único compartido entre todas se filtraría el primer día (basta que una lo
// reenvíe), así que se emite uno POR SUSCRIPTORA, con el mismo patrón que ya usa
// handleReferralCode: se verifica el teléfono contra Firebase antes de emitir nada.
//
// A diferencia del código de referido — que es 'AMIGA' + los últimos 6 dígitos del
// teléfono, y por lo tanto lo puede deducir cualquiera que conozca ese número — este se
// deriva por HMAC con SESSION_SECRET. Sigue siendo determinístico (mismo teléfono →
// mismo código, así pedirlo dos veces no crea dos cupones) pero no es adivinable.
// Índice teléfono → código del cupón de envío. Los últimos 7 dígitos, por la misma
// razón que samePhone(): el número guardado en Firebase y el que la clienta teclea
// en el formulario no siempre traen el código de país.
function loversShipIndexKey(phoneDigits) {
  return 'loversship:' + String(phoneDigits || '').replace(/\D/g, '').slice(-7);
}
async function setCouponActive(env, code, active) {
  const coupon = await couponGet(env, code);
  if (!coupon || coupon.active === active) return;
  coupon.active = active;
  await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
}
// Barrido de seguridad (19 sep): antes se firmaba con el teléfono completo tal cual
// llegaba, pero loversShipIndexKey() (arriba) siempre indexa por los últimos 7 dígitos.
// Si la misma clienta pedía el código escribiendo su número CON código de país una vez
// y SIN código de país otra, salían 2 HMACs distintos (2 cupones ENVIO... diferentes),
// y el índice solo guardaba el último — al cancelar solo se desactivaba ese, el otro
// quedaba funcionando para siempre. Ahora se normaliza a los mismos últimos 7 dígitos
// que usa el índice, así el mismo teléfono da SIEMPRE el mismo código sin importar el
// formato. Nota: un código emitido antes de este cambio con un formato de teléfono
// distinto al que se use de ahora en más queda huérfano (no indexado) — mismo tipo de
// limitación ya aceptada para el rollout de restrictToPhone del 16 sep.
async function loversShippingCode(phoneDigits, env) {
  const normalized = String(phoneDigits || '').replace(/\D/g, '').slice(-7);
  const sig = await hmac('lovers-shipping:' + normalized, env.SESSION_SECRET);
  // b64url → solo A-Z 0-9 para que entre en el formato de código de cupón.
  const clean = sig.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return 'ENVIO' + clean.slice(0, 8);
}

async function handleLoversShippingCode(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  if (!env.SESSION_SECRET) return err('No disponible', 500, origin);

  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `shiprl:${ip}`;
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

  const code = await loversShippingCode(phoneDigits, env);
  let coupon = await couponGet(env, code);
  if (!coupon) {
    coupon = {
      code, type: 'freeship', amount: 0, kind: 'lovers-shipping',
      // Sin tope de usos ni vencimiento: el beneficio dura mientras dure la suscripción.
      // Lo que lo acota no es un contador sino restrictToPhone (solo lo usa quien lo
      // pidió) + la desactivación automática al cancelar (ver loversShipIndexKey abajo).
      maxUses: null, usedCount: 0, active: true, expiresAt: null,
      restrictToPhone: phoneDigits,
      note: `Envío gratis Lovers — ${name}${body.phone ? ' (' + String(body.phone).slice(0, 30) + ')' : ''}`,
      createdAt: new Date().toISOString(), createdBy: 'lovers-system',
    };
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  } else if (!coupon.active || !coupon.restrictToPhone) {
    // Para llegar acá ya pasó isActiveLoversPhone(), o sea que hoy está activa: si su
    // cupón estaba apagado (canceló y se volvió a suscribir) se reenciende. De paso se
    // le agrega restrictToPhone a los cupones emitidos antes de que el campo existiera.
    coupon.active = true;
    coupon.restrictToPhone = coupon.restrictToPhone || phoneDigits;
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify(coupon));
  }
  // Índice teléfono → código, reescrito siempre (es idempotente). Hace falta porque el
  // código es un HMAC de una sola vía: al cancelar, el webhook solo tiene el teléfono
  // guardado en Firebase, que puede no coincidir dígito a dígito con el que la clienta
  // tecleó al pedirlo, así que no se puede recalcular. Escribirlo en cada pedido, y no
  // solo al crear, deja indexados también los cupones anteriores a este cambio.
  await env.CACUSA_KV.put(loversShipIndexKey(phoneDigits), code);
  return ok({ ok: true, code: coupon.code, type: coupon.type }, origin);
}

// ── Aviso de "nueva suscripción pendiente" de Cacusa Lovers ───────────────────
// Quien llama solo manda un email; todo lo demás (si corresponde avisar, con qué
// nombre, una sola vez) lo decide cacusa-lovers-webhook leyendo Firebase con su
// propio secreto. Así nadie puede escribir el texto de un push al celular de
// Tita/Robin ni hacer sonar avisos de suscriptoras que no existen.
async function handleLoversNotifyPending(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  if (!env.ORDER_INGEST_KEY) return ok({ ok: true, notified: false }, origin);

  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `pendrl:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= 5) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
  if (!isValidEmail(email)) return ok({ ok: true, notified: false }, origin);

  // Falla cerrado: si el hop interno no responde o dice que no, no suena nada.
  let claim = { notify: false };
  try {
    const r = await loversFetch(env, '/internal/lovers/claim-pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ email }),
    });
    if (r.ok) {
      claim = await r.json().catch(() => ({ notify: false }));
    } else {
      // Antes esto quedaba mudo — un 401/500 del hop interno se veía IDÉNTICO en los
      // logs a un simple "no correspondía avisar", sin ninguna pista de qué falló.
      console.error('claim-pending respondió', r.status, await r.text().catch(() => ''));
    }
  } catch (e) {
    console.error('claim-pending error:', e.message);
  }
  console.log('lovers/notify-pending:', email, '→', JSON.stringify(claim));
  if (!claim.notify) return ok({ ok: true, notified: false }, origin);

  if (env.VAPID_PRIVATE_KEY_JWK) {
    try {
      const esAnual = String(claim.plan || '').toLowerCase().includes('anual');
      await sendWebPushAll(env, {
        title: 'CACUSA · Nueva suscripción pendiente',
        body:  `🕐 ${claim.nombre} llenó el formulario (${esAnual ? 'anual' : 'mensual'}) — falta que complete el pago`,
        url:   'https://cacusabytaitus.com/ui_kits/admin/',
        tag: 'cacusa-lovers',
        urgency: 'normal',
      });
    } catch (e) {
      console.error('push suscripción pendiente falló:', e.message);
    }
  }
  return ok({ ok: true, notified: true }, origin);
}

// ── Doble opt-in por email — altas de Cacusa Lovers (nuevo, 22 sep — S07) ──────────
// Auditoría externa: la regla de Firebase permite crear el PRIMER registro de
// cualquier email sin probar que quien escribe lo controla, y el webhook de pago
// (invoice.payment_made, lovers-webhook-worker.js) preserva la dirección YA guardada
// en ese registro en vez de exigir una fresca — así que alguien podía pre-crear el
// registro de un email ajeno con una dirección inventada, y esa dirección terminaba
// usándose el día que la dueña real del email pagara de verdad. Cerrar esto del todo
// necesitaría autenticación real (fuera de alcance de esta tanda) — pero el ÚNICO
// camino que hoy escribe el primer registro de un email es este formulario público,
// así que exigir un click de confirmación desde ESE email antes de escribir nada a
// Firebase cierra el ataque real: un atacante no controla el inbox de la víctima, así
// que no puede completar la confirmación en su nombre.
//
// El pago sigue disparándose de inmediato al enviar el formulario (misma UX que
// antes, sin esperar a que confirme el correo) — lo único que cambia es que la
// escritura a Firebase ya no ocurre desde el navegador ni al instante: queda en un
// KV pendiente (TTL 48h) hasta que la persona hace click en el link de su correo.
const LOVERS_PENDING_TTL_SECONDS = 48 * 3600;

function loversRegisterEmailContent(nombre, confirmUrl, idioma) {
  const bodyHtml = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 18px;">
<tr><td style="text-align:center;">
<a href="${esc(confirmUrl)}" style="display:inline-block;background:#C0336E;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">${idioma === 'en' ? 'Confirm my email' : 'Confirmar mi correo'}</a>
</td></tr>
</table>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;text-align:center;margin:0;">${idioma === 'en' ? 'This link expires in 48 hours.' : 'Este enlace vence en 48 horas.'}</p>`;
  if (idioma === 'en') {
    return {
      subject: 'Confirm your email — Cacusa Lovers',
      html: emailShellGeneric({
        lang: 'en', preheader: 'One click to confirm your Cacusa Lovers signup.',
        eyebrow: 'Cacusa Lovers', title: `Almost there${nombre ? ', ' + esc(nombre) : ''}! ✦`,
        bodyHtml, ctaText: '', ctaUrl: '',
      }),
    };
  }
  return {
    subject: 'Confirmá tu correo — Cacusa Lovers',
    html: emailShellGeneric({
      lang: 'es', preheader: 'Un click para confirmar tu alta a Cacusa Lovers.',
      eyebrow: 'Cacusa Lovers', title: `Ya casi${nombre ? ', ' + esc(nombre) : ''}! ✦`,
      bodyHtml, ctaText: '', ctaUrl: '',
    }),
  };
}

async function handleLoversRegister(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `loversregrl:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= 10) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const email = String(body.email || '').toLowerCase().trim().slice(0, 150);
  if (!isValidEmail(email)) return err('Email inválido', 400, origin);
  const nombre = str(body.nombre, 100);
  if (!nombre) return err('Falta el nombre', 400, origin);
  const idioma = body.idioma === 'en' ? 'en' : 'es';

  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const pendingData = {
    nombre, apellido: str(body.apellido, 100), email, telefono: str(body.telefono, 30),
    direccion: str(body.direccion, 200), apto: str(body.apto, 40), ciudad: str(body.ciudad, 100),
    estado: str(body.estado, 50), zip: str(body.zip, 20), pais: str(body.pais, 40),
    plan: str(body.plan, 60), monto: str(body.monto, 40), idioma,
    fecha: str(body.fecha, 10) || new Date().toISOString().slice(0, 10),
    metodo_pago: str(body.metodo_pago, 20) || 'square',
    createdAt: new Date().toISOString(),
  };
  await env.CACUSA_KV.put(`loverspending:${token}`, JSON.stringify(pendingData), { expirationTtl: LOVERS_PENDING_TTL_SECONDS });

  // Aviso de "nueva suscripción pendiente" — antes esto dependía de que el formulario
  // ya hubiera escrito el registro en Firebase (para que /internal/lovers/claim-pending
  // lo pudiera leer). Como este registro ya NO se crea hasta que se confirma el email
  // (ver más arriba), esa cadena dejaría de avisar para siempre — se dispara acá mismo,
  // directo, con los datos que ya tenemos a mano, sin depender de Firebase para nada.
  if (env.VAPID_PRIVATE_KEY_JWK) {
    try {
      const esAnual = String(pendingData.plan || '').toLowerCase().includes('anual');
      await sendWebPushAll(env, {
        title: 'CACUSA · Nueva suscripción pendiente',
        body: `🕐 ${nombre} llenó el formulario (${esAnual ? 'anual' : 'mensual'}) — falta que confirme el correo y complete el pago`,
        url: 'https://cacusabytaitus.com/ui_kits/admin/',
        tag: 'cacusa-lovers',
        urgency: 'normal',
      });
    } catch (e) {
      console.error('push suscripción pendiente falló:', e.message);
    }
  }

  const confirmUrl = (idioma === 'en'
    ? 'https://cacusabytaitus.com/en/cacusa-lovers.html?confirm='
    : 'https://cacusabytaitus.com/cacusa-lovers.html?confirm=') + encodeURIComponent(token);
  try {
    await sendGmail(env, { to: email, ...loversRegisterEmailContent(nombre, confirmUrl, idioma) });
  } catch (e) {
    // Best-effort — el pago sigue su curso igual aunque el correo falle (la clienta
    // puede confirmar más tarde si el formulario le ofrece un botón de reenviar, o
    // Tita/Robin pueden confirmarla a mano desde el panel como ya hacían antes).
    console.error('email de confirmación de Lovers falló:', e.message);
  }
  return ok({ ok: true }, origin);
}

async function handleLoversConfirm(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const token = typeof body.token === 'string' ? body.token.slice(0, 64) : '';
  if (!token) return err('Falta el token', 400, origin);
  const raw = await env.CACUSA_KV.get(`loverspending:${token}`);
  if (!raw) return err('Este enlace ya no es válido o ya fue usado', 404, origin);
  let pending; try { pending = JSON.parse(raw); } catch (_) { pending = null; }
  if (!pending) return err('Este enlace ya no es válido o ya fue usado', 404, origin);

  if (!env.ORDER_INGEST_KEY) return err('Worker no configurado', 500, origin);
  const r = await loversFetch(env, '/internal/lovers/confirm-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
    body: JSON.stringify(pending),
  });
  if (!r.ok) {
    console.error('confirm-register respondió', r.status, await r.text().catch(() => ''));
    return err('No se pudo confirmar la suscripción, intentá de nuevo', 500, origin);
  }
  // Recién ahora, con el registro real ya escrito en Firebase, se invalida el token —
  // un fallo ANTES de este punto deja el token intacto para poder reintentar.
  await env.CACUSA_KV.delete(`loverspending:${token}`);
  return ok({ ok: true }, origin);
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
  const rawPhone = String(body.phone || '').replace(/\D/g, '').slice(0, 20);
  const rawEmail = String(body.email || '').toLowerCase().trim().slice(0, 100);
  const coupon = await couponGet(env, rawCode);
  const codeKey = `cpvrl:c:${rawCode}`;
  const codeCount = parseInt((await env.CACUSA_KV.get(codeKey)) || '0', 10);
  if (codeCount >= 8) return ok({ valid: false }, origin);
  // El chequeo de "cupón ya usado" (cpused:ph/em, saltado para cupones pensados para
  // reusarse — restrictToEmail o envío gratis de Lovers) vive DENTRO de couponIsValid()
  // desde el 22 sep (S08a) — un solo lugar, en vez de duplicarlo acá y en handleOrder().
  let valid = await couponIsValid(coupon, rawEmail, rawPhone, env);
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

async function handleSurchargeSave(body, env, origin, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const src = body.surcharges;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return err('Datos inválidos', 400, origin);
  const clean = {};
  for (const [k, v] of Object.entries(src)) clean[String(k).slice(0, 50)] = v === true;
  await env.CACUSA_KV.put('surcharges', JSON.stringify(clean));
  // Auditoría SEO externa (20 sep): el precio "horneado" en el JSON-LD estático
  // (STATIC_PRODUCT_SCHEMA, generate_product_schema.py) solo se recalcula cuando
  // corre el pipeline — y ese pipeline solo se dispara con un push a
  // data/products.json, nunca con un cambio de este flag en KV. Sin este aviso,
  // prender/apagar el recargo del 4% podía dejar el precio publicado
  // desactualizado indefinidamente. Mismo patrón que handleTiktokTriggerExport()
  // — best-effort: ctx.waitUntil() para que el fetch se complete de verdad
  // aunque ya se haya devuelto la respuesta, pero nunca debe romper el guardado
  // real en KV si GitHub no responde.
  if (env.GH_TOKEN && ctx) {
    ctx.waitUntil(
      fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
        method: 'POST', headers: ghHeaders(env),
        body: JSON.stringify({ event_type: 'surcharge-updated' }),
      }).catch((e) => console.error('repository_dispatch surcharge-updated falló:', e.message))
    );
  }
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
  if (!isValidEmail(email)) return ok({ ok: true }, origin);
  const lang = body.lang === 'en' ? 'en' : 'es';
  const source = ['vignette', 'cart_checkout_start'].includes(body.source) ? body.source : undefined;
  const cart = Array.isArray(body.cart)
    ? body.cart.slice(0, 20).map(i => ({ name: String(i.name || '').slice(0, 150), price: (typeof i.price === 'number' && isFinite(i.price)) ? i.price : 0 }))
    : undefined;
  const total = (typeof body.total === 'number' && isFinite(body.total)) ? body.total : undefined;
  const key = leadKey(email);
  const existingRaw = await env.CACUSA_KV.get(key);
  let already = null;
  if (existingRaw) { try { already = JSON.parse(existingRaw); } catch { already = null; } }
  let sendWelcome = false;
  if (!already) {
    const lead = { email, lang, date: new Date().toISOString(), source, cart, total, notified: false };
    await env.CACUSA_KV.put(key, JSON.stringify(lead));
    // Solo el 10% de bienvenida (popup) dispara el correo automático — un carrito
    // abandonado no es un registro de "quiero mi descuento", y el envío manual
    // desde el panel (handleLeadSendWelcome) cubre los leads que ya existían antes
    // de que esto existiera.
    if (source === 'vignette') sendWelcome = true;
  } else if (source === 'cart_checkout_start' && already.source !== 'cart_checkout_start') {
    // Ya era lead del 10% — si ahora llega al checkout con carrito, upgradeamos el registro
    // para que sí entre en la revisión de abandono (sin duplicar la entrada).
    already.source = source; already.cart = cart; already.total = total;
    already.date = new Date().toISOString(); already.notified = false;
    await env.CACUSA_KV.put(key, JSON.stringify(already));
  } else if (source === 'vignette' && !already.welcomeSent) {
    // El email ya existía por otra razón (ej. un carrito abandonado de antes) y ahora pide
    // el 10% — el correo se manda igual, sin tocar el resto del registro (no le pisamos el
    // source ni el carrito: ambas cosas pueden ser ciertas al mismo tiempo para un email).
    sendWelcome = true;
  }
  // Un solo trabajo de fondo para todo lo que sigue, con un único escaneo completo de
  // lead:* — antes esto eran hasta 3 escaneos por request (uno al refrescar la caché
  // recién escrito el lead, otro dentro del envío del correo, otro dentro de
  // checkAbandonedCarts), cada uno con su propio PUT a leads_cache. El orden importa:
  // el correo se manda primero para que su escritura (welcomeSent) ya esté en KV cuando
  // se haga el único listAllLeads() de abajo.
  if (ctx) {
    ctx.waitUntil((async () => {
      if (sendWelcome) {
        try { await sendWelcomeCode(email, lang, env, { refreshCache: false }); }
        catch (e) { console.error('welcome10 automático falló:', e.message); }
      }
      const leads = env.VAPID_PRIVATE_KEY_JWK
        ? await checkAbandonedCarts(env, { refreshCache: false }).catch(() => null)
        : null;
      await writeLeadsCache(env, leads || await listAllLeads(env)).catch(() => {});
    })());
  }
  return ok({ ok: true }, origin);
}

// ── Quita el lead de carrito abandonado de una clienta — best-effort, nunca revienta
// el flujo que lo llama. Lo usan tanto handleOrder (cuando compra de verdad) como
// handleLeadCancel (cuando vacía el carrito sin comprar). Nunca toca leads 'vignette'
// (el 10% de bienvenida no se cancela por vaciar un carrito).
async function removeCartLead(email, env) {
  if (!env.CACUSA_KV || !email) return;
  const key = leadKey(email);
  const raw = await env.CACUSA_KV.get(key);
  if (!raw) return;
  let lead; try { lead = JSON.parse(raw); } catch { return; }
  if (lead.source !== 'cart_checkout_start') return;
  await env.CACUSA_KV.delete(key);
  await refreshLeadsCache(env).catch(() => {});
}

// Ruta pública (mismo molde que /lead/register): la tienda la llama cuando el cliente
// vacía el carrito sin llegar a comprar, para que ese lead deje de aparecer en el
// panel como "carrito abandonado" — ya no hay carrito que recuperar.
async function handleLeadCancel(body, env, origin, request) {
  if (!env.CACUSA_KV) return ok({ ok: true }, origin);
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `leadcancelrl:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= 10) return ok({ ok: true }, origin);
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  const email = String(body.email || '').toLowerCase().trim().slice(0, 100);
  if (email) await removeCartLead(email, env);
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
// opts.leads: si quien llama ya escaneó lead:* (ver handleLeadRegister), lo reusa en vez
// de volver a escanear — antes esta función SIEMPRE hacía su propio listAllLeads(),
// aunque el llamador acabara de hacer el mismo escaneo momentos antes.
// opts.refreshCache: en false cuando el llamador va a escribir leads_cache él mismo con
// el array que le devolvemos (ya con los notified al día), para no duplicar el PUT.
// Devuelve el array completo de leads (mutado in-place si hubo cambios), o null si
// env.CACUSA_KV no está configurado.
async function checkAbandonedCarts(env, { leads: preloaded, refreshCache = true } = {}) {
  if (!env.CACUSA_KV) return null;
  // Sin caché involucrada: necesita ver el estado real más reciente para decidir a quién
  // marcar notified, igual que las mutaciones de pedidos siempre leen su propia llave
  // order:<id> en vez de confiar en orders_cache.
  const leads = preloaded || await listAllLeads(env);
  const pending = leads.filter(l => l.source === 'cart_checkout_start' && !l.notified);
  if (!pending.length) return leads;

  const cutoff = Date.now() - ABANDON_MINUTES * 60 * 1000;
  const stale = pending.filter(l => new Date(l.date).getTime() <= cutoff);
  if (!stale.length) return leads;

  // Si ya hay un pedido de ese email POSTERIOR al lead, no fue abandono — se completó.
  // Auditoría (20 sep, F17): antes esto era un Set de "compró alguna vez en el
  // historial" — una clienta recurrente nunca volvía a generar aviso de carrito
  // abandonado, aunque el carrito de HOY fuera un abandono genuino nuevo. Ahora se
  // guarda la fecha del pedido MÁS RECIENTE por email y se compara contra la fecha
  // del lead — el comentario de arriba ya decía "posterior al lead", pero el código
  // no lo comprobaba.
  let latestOrderByEmail = new Map();
  const ordersRaw = await env.CACUSA_KV.get('orders_cache');
  if (ordersRaw) {
    try {
      const od = JSON.parse(ordersRaw);
      if (Array.isArray(od.orders)) {
        for (const o of od.orders) {
          const em = (o.cliente?.email || '').toLowerCase();
          if (!em) continue;
          const t = o.fecha ? new Date(o.fecha).getTime() : 0;
          if (!latestOrderByEmail.has(em) || t > latestOrderByEmail.get(em)) latestOrderByEmail.set(em, t);
        }
      }
    } catch {}
  }

  let changed = false;
  for (const lead of stale) {
    lead.notified = true; // se marca sí o sí para no re-evaluarlo cada vez — muta el
    changed = true;        // objeto dentro de `leads` también, son la misma referencia.
    await env.CACUSA_KV.put(leadKey(lead.email), JSON.stringify(lead));
    const latestOrderTime = latestOrderByEmail.get(lead.email);
    if (latestOrderTime != null && latestOrderTime >= new Date(lead.date).getTime()) continue; // compró después — no es abandono real
    const itemNames = (lead.cart || []).map(i => i.name).filter(Boolean).slice(0, 3).join(', ');
    const totalTxt = typeof lead.total === 'number' ? ` · $${lead.total.toFixed(2)}` : '';
    await sendWebPushAll(env, {
      title: 'CACUSA · Carrito abandonado',
      body: `🛒 ${lead.email}${totalTxt}${itemNames ? ' — ' + itemNames : ''}`,
      url: 'https://cacusabytaitus.com/ui_kits/admin/',
      tag: 'cacusa-cart',
      urgency: 'low',
    });
  }
  if (changed && refreshCache) await writeLeadsCache(env, leads).catch(() => {});
  return leads;
}

async function handleLeadList(env, origin) {
  if (!env.CACUSA_KV) return ok({ leads: [] }, origin);
  await migrateLegacyLeadsIfNeeded(env);
  let raw = await env.CACUSA_KV.get('leads_cache');
  if (!raw) raw = JSON.stringify(await refreshLeadsCache(env));
  let data = { leads: [] };
  try { data = JSON.parse(raw); } catch {}
  return ok({ leads: Array.isArray(data.leads) ? data.leads : [] }, origin);
}

// Borra un lead (registro del 10% o carrito abandonado) del panel — hay un solo
// registro por email (handleLeadRegister nunca duplica), así que el email lo
// identifica sin ambigüedad.
async function handleLeadDelete(body, env, origin) {
  if (!env.CACUSA_KV) return ok({ ok: true }, origin);
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return err('Falta email', 400, origin);
  await env.CACUSA_KV.delete(leadKey(email));
  await refreshLeadsCache(env).catch(() => {});
  return ok({ ok: true }, origin);
}

// Botón manual del panel — para los leads que ya existían antes de que el envío
// automático existiera (o para reenviar si la clienta dice que no le llegó). Idempotente:
// ensureWelcomeCoupon() reusa el mismo código si ya se había generado, nunca crea dos
// cupones ni resetea la vigencia de 3 meses de uno que ya se había mandado antes.
async function handleLeadSendWelcome(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const email = String(body.email || '').toLowerCase().trim();
  if (!isValidEmail(email)) return err('Email inválido', 400, origin);
  const lang = body.lang === 'en' ? 'en' : 'es';
  try {
    const code = await sendWelcomeCode(email, lang, env);
    return ok({ ok: true, code }, origin);
  } catch (e) {
    console.error('lead/send-welcome falló:', e.message);
    return err('No se pudo enviar el correo: ' + e.message, 500, origin);
  }
}

// Se llama al confirmar un pedido — pública para WhatsApp/Zelle (origin-restringida),
// o interna desde cacusa-square (ORDER_INGEST_KEY) tras confirmar el pago con tarjeta.
async function handleCouponBurnPublic(body, env, origin, request) {
  if (!env.CACUSA_KV) return ok({ ok: true }, origin);
  const trusted = isInternalIngest(request, env);
  // Rate limit por IP (15/hr) — igual que /giftcard/redeem, para que no se pueda agotar el
  // maxUses de un cupón ni bloquear el teléfono/email de una clienta real sin límite.
  if (!trusted) {
    const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
    const rlKey = `cpburnrl:${ip}`;
    const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
    if (rlCount >= 15) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
    await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }
  const rawCode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!rawCode) return ok({ ok: true }, origin);

  // Auditoría de integridad (19 sep, F04): el chequeo de orderId (agregado en la ronda
  // anterior) cerraba "curl sin ningún pedido detrás", pero no "pedido real pero vacío/
  // inventado + identidad falsa en el body + reintento múltiple sin lock" — la
  // identidad usada para marcar "ya usó el cupón" seguía saliendo del BODY de esta
  // misma llamada (cualquier email/teléfono que decidiera mandar quien llama), no del
  // pedido ya verificado, y no había ninguna llave que atara un pedido a un solo
  // consumo (se podía quemar el mismo cupón repetidas veces con el mismo pedido).
  // Ahora: (a) la identidad sale SIEMPRE del pedido verificado, nunca del body — así
  // nadie puede marcar como "ya usó este cupón" a un email/teléfono ajeno; (b)
  // burned:<orderId>:<code> asegura una sola vez por pedido, sin importar cuántas
  // veces se reintente la llamada.
  let identityEmail = '', identityPhone = '', linkedOrderId = null;
  if (!trusted) {
    const orderId = body.orderId;
    if (orderId == null) return ok({ ok: true }, origin);
    const linkedOrder = await orderGet(env, orderId);
    if (!linkedOrder || linkedOrder.cuponAplicado !== rawCode) return ok({ ok: true }, origin);
    identityEmail = (linkedOrder.cliente?.email || '').toLowerCase().trim();
    identityPhone = (linkedOrder.cliente?.telefono || '').replace(/\D/g, '');
    linkedOrderId = orderId;
  } else {
    // Camino interno (Worker-a-Worker, ya autenticado con ORDER_INGEST_KEY —
    // burnCouponViaAdmin() en square-payment-worker.js, disparado recién cuando
    // Square confirma el pago) — ya viene de un evento de pago real, la identidad
    // que manda es la que Square/el checkout ya validó.
    identityEmail = String(body.email || '').toLowerCase().trim().slice(0, 100);
    identityPhone = String(body.phone || '').replace(/\D/g, '').slice(0, 20);
    linkedOrderId = body.orderId != null ? body.orderId : null;
  }

  // Auditoría externa (22 sep, S08c): antes la marca `burned:<orderId>:<code>` se
  // escribía ACÁ, antes de aplicar el efecto real (cpused + usedCount) — si el Worker
  // se caía o KV fallaba entre esa escritura y las de abajo, un reintento veía
  // `burned` ya puesto y devolvía éxito sin haber completado el descuento/tope de usos
  // real. Ahora solo se LEE acá (para no reprocesar un pedido ya quemado del todo); la
  // escritura de `burned` se mueve al final, después de que el efecto real ya haya
  // quedado persistido — mismo criterio "efecto real primero, marca después" que ya se
  // usa en el correo de bienvenida (welcomeCouponCode).
  const burnedKey = linkedOrderId != null ? `burned:${linkedOrderId}:${rawCode}` : null;
  if (burnedKey && await env.CACUSA_KV.get(burnedKey)) return ok({ ok: true }, origin); // ya se quemó para ESTE pedido

  const coupon = await couponGet(env, rawCode);
  // Restricciones del cupón chequeadas ANTES de escribir ninguna marca (antes se
  // escribían las marcas de "cupón usado" incondicionalmente, y solo el INCREMENTO
  // de usedCount respetaba restrictToEmail/restrictToPhone — F04).
  const restrictionsOk = !!coupon
    && (!coupon.restrictToEmail || identityEmail === coupon.restrictToEmail.toLowerCase())
    && (!coupon.restrictToPhone || samePhone(identityPhone, coupon.restrictToPhone));
  if (!restrictionsOk) return ok({ ok: true }, origin);

  // Registrar uso por teléfono y email (1 año) — salvo en cupones pensados para que
  // la misma persona los reuse (ver mismo comentario en handleCouponValidate).
  const repeatableByDesign = !!(coupon.restrictToEmail || coupon.kind === 'lovers-shipping');
  if (!repeatableByDesign) {
    if (identityPhone.length >= 7) await env.CACUSA_KV.put(`cpused:ph:${identityPhone}:${rawCode}`, '1', { expirationTtl: 31536000 });
    if (identityEmail.includes('@')) await env.CACUSA_KV.put(`cpused:em:${identityEmail}:${rawCode}`, '1', { expirationTtl: 31536000 });
  }
  coupon.usedCount = (coupon.usedCount || 0) + 1;
  await env.CACUSA_KV.put(couponKey(rawCode), JSON.stringify(coupon));
  if (coupon.kind === 'referral') await markReferralMonthlyUse(env, rawCode);
  // Recién ahora, con el efecto real ya persistido, se marca este pedido como quemado.
  if (burnedKey) await env.CACUSA_KV.put(burnedKey, '1', { expirationTtl: 31536000 });
  return ok({ ok: true }, origin);
}

async function handleCouponCreate(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  const code = (body.code || '').toString().trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length < 3 || code.length > 30) return err('Código inválido (3-30 chars, A-Z 0-9 - _)', 400, origin);
  // 'freeship' = anula el costo de envío, sin descontar dinero del subtotal (por eso
  // su amount es 0 y no se le pide monto). Es el beneficio de Cacusa Lovers.
  const type = body.type === 'fixed' ? 'fixed' : (body.type === 'freeship' ? 'freeship' : 'percent');
  const amount = type === 'freeship' ? 0 : Number(body.amount);
  if (type !== 'freeship' && !(amount > 0)) return err('Monto inválido', 400, origin);
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
  // `urgency` (RFC 8030) va como header en claro — el push service lo usa para decidir
  // qué tan agresivo despertar al dispositivo (útil en low-power mode); no es secreto,
  // así que no entra al payload cifrado. El resto (title/body/url/tag) sí va cifrado.
  const { urgency, ...pushPayload } = payload || {};
  const headers = {
    TTL: '86400',
    Urgency: urgency || 'normal',
    Authorization: await vapidAuthHeader(sub.endpoint, env),
  };
  let body;
  if (payload) {
    body = await encryptPushPayload(new TextEncoder().encode(JSON.stringify(pushPayload)), sub.keys.p256dh, sub.keys.auth);
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

// ── TikTok Shop — carga masiva ──────────────────────────────────────────────────────
// El panel llamaba a estas 2 rutas desde antes de que existieran acá (hallazgo del 19
// sep, auditoría propia A07-A19) — el botón "Generar ahora" siempre daba 404. Ya existe
// todo lo demás: .github/workflows/tiktok-bulk-export.yml espera un repository_dispatch
// con event_type "tiktok-export", y scripts/generate_tiktok_bulk.py escribe
// data/tiktok_export_log.json con un bloque _meta ({lastGeneratedAt, lastCount,
// lastProducts}) — exactamente los 2 campos que ya lee el panel. Solo faltaba la pieza
// que conecta el botón con el workflow.
async function handleTiktokExportStatus(env, origin) {
  const content = await ghGetContent('data/tiktok_export_log.json', env);
  let meta = null;
  if (content) {
    try { meta = JSON.parse(content.text)._meta || null; } catch (e) { console.error('tiktok export log inválido:', e.message); }
  }
  return ok({
    ok: true,
    meta,
    downloadUrl: content ? 'https://cacusabytaitus.com/exports/tiktok_bulk_latest.xlsx' : '',
  }, origin);
}

async function handleTiktokTriggerExport(env, origin) {
  if (!env.GH_TOKEN) return err('GH_TOKEN no configurado en el Worker', 500, origin);
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
    method: 'POST', headers: ghHeaders(env),
    body: JSON.stringify({ event_type: 'tiktok-export' }),
  });
  if (!r.ok) return err('No se pudo disparar la exportación', 502, origin);
  return ok({ ok: true }, origin);
}

// ── Validación de email ────────────────────────────────────────────────────────
// Estricta a propósito, y el `\s` de la clase negada es lo importante: cubre \r y
// \n. El destinatario termina crudo dentro de una cabecera MIME en sendGmail(), así
// que un CRLF acá permitía inyectar cabeceras nuevas (Bcc:, Reply-To:) o cerrar el
// bloque de cabeceras y escribir el cuerpo — es decir, mandar correo arbitrario
// desde facturacioncacusa@gmail.com, con DKIM y SPF válidos de Gmail. La validación
// vieja era `.includes('@')`, que deja pasar todo eso.
// Ojo: NO usar esto en /coupon/validate ni /coupon/burn — ahí el email solo arma una
// llave de KV y se compara contra restrictToEmail; endurecerlo podría dejar fuera del
// checkout a una clienta con un correo válido pero raro, sin ganar nada de seguridad.
const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[a-z]{2,}$/i;
function isValidEmail(v) {
  const s = String(v || '').trim();
  return s.length <= 120 && EMAIL_RE.test(s);
}

// ── Correo de bienvenida (código 10%) vía Gmail API ─────────────────────────────
// Manda literalmente desde facturacioncacusa@gmail.com (OAuth2, no SMTP con
// contraseña) — ver el runbook al inicio del archivo para obtener los 3 secrets.
// El access token dura 1h; como este Worker no guarda estado entre invocaciones,
// simplemente lo pide de nuevo en cada envío (volumen bajo, no vale la pena cachearlo).
async function gmailAccessToken(env) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Gmail token refresh falló (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.access_token;
}

async function sendGmail(env, { to, subject, html }) {
  if (!env.GMAIL_REFRESH_TOKEN) throw new Error('GMAIL_REFRESH_TOKEN no configurado');
  // Última barrera antes de armar el MIME: `to` se concatena crudo en la cabecera To:.
  // Se valida acá además de en cada punto de entrada porque este es el cuello de
  // botella por donde pasa TODO correo del sistema — incluidos los que traen la
  // dirección desde Firebase (el cupón exclusivo), que la escribe el formulario
  // público de suscripción. Cualquier ruta de envío nueva queda cubierta sola.
  if (!isValidEmail(to)) throw new Error('Destinatario inválido');
  const accessToken = await gmailAccessToken(env);
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const mime =
    `From: CACUSA by Taitus <facturacioncacusa@gmail.com>\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subjectEncoded}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    html;
  const raw = b64url(new TextEncoder().encode(mime));
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`Gmail send falló (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

// Los 3 wrappers de abajo son el único punto que llaman handleOrder()/
// handleOrderManual()/handleUspsLabel()/la ruta interna de suscripción — evita repetir
// el guard isValidEmail() + el try/catch best-effort en cada uno de los 4 puntos de
// disparo. Ninguno de los 3 debe poder romper el flujo que los llama si Gmail falla.
async function sendOrderConfirmationEmail(order, env) {
  const email = (order.cliente && order.cliente.email) || '';
  if (!isValidEmail(email)) return; // sin correo válido, no hay a quién mandarle nada
  const lang = (order.cliente && order.cliente.idioma) === 'en' ? 'en' : 'es';
  try {
    await sendGmail(env, { to: email, ...orderConfirmationEmailContent(order, lang) });
  } catch (e) {
    console.error('email de confirmación de pedido falló:', e.message);
  }
}

async function sendShippingConfirmationEmail(order, env) {
  const email = (order.cliente && order.cliente.email) || '';
  if (!isValidEmail(email) || !order.tracking) return;
  const lang = (order.cliente && order.cliente.idioma) === 'en' ? 'en' : 'es';
  const trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(order.tracking)}`;
  try {
    await sendGmail(env, { to: email, ...shippingConfirmationEmailContent(order, trackingUrl, lang) });
  } catch (e) {
    console.error('email de confirmación de envío falló:', e.message);
  }
}

async function sendSubscriptionConfirmationEmail(body, env) {
  const email = String(body.email || '').toLowerCase().trim();
  if (!isValidEmail(email)) return;
  const lang = body.idioma === 'en' ? 'en' : 'es';
  try {
    await sendGmail(env, { to: email, ...subscriptionConfirmationEmailContent(body, lang) });
  } catch (e) {
    console.error('email de confirmación de suscripción falló:', e.message);
  }
}

// ── USPS API (guías de envío) — nuevo, 20 sep ───────────────────────────────────
// Plataforma nueva de USPS (developers.usps.com) — la vieja Web Tools API se dio
// de baja el 25 ene 2026, así que esto se integra directo contra la nueva. OAuth2
// client_credentials, ambiente elegido por env.USPS_ENV ('tem' = pruebas, 'prod' =
// real, default 'tem' para no arriesgar franqueo real hasta confirmar el flujo).
// Generar una guía real además exige: (a) que la cuenta de USPS tenga aprobación
// para la Labels API específicamente y (b) una Enterprise Payment Account (EPS)
// activa que pague el franqueo — ninguna de las 2 es algo que este código pueda
// resolver solo, son trámites reales con USPS que hace el usuario fuera del repo
// (Business Customer Gateway → invitación EPS → Developer Portal → aprobación
// Labels API). Mientras no estén listas, este endpoint simplemente va a fallar
// con el error real que devuelva USPS (nunca falla en silencio).
//
// Payload verificado (20 sep) contra el spec OpenAPI real de la Labels API
// (labels_16_0.yaml, descargado por el usuario de developers.usps.com) — ya no
// es un best-effort. Puntos no obvios confirmados contra el spec real:
//   - weightUOM SOLO acepta 'lb' (no existe 'oz') — el peso se recibe/guarda en
//     onzas (más natural para bisutería) y se convierte acá mismo antes de mandar.
//   - Accept: application/vnd.usps.labels+json pide la respuesta como un solo
//     JSON (trackingNumber + labelImage en base64, ambos top-level) en vez del
//     multipart/form-data que devuelve por defecto la API — mucho más simple de
//     manejar en un Worker.
function uspsBaseUrl(env) {
  return env.USPS_ENV === 'prod' ? 'https://apis.usps.com' : 'https://apis-tem.usps.com';
}
async function uspsOAuthToken(env) {
  if (!env.USPS_CONSUMER_KEY || !env.USPS_CONSUMER_SECRET) throw new Error('USPS_CONSUMER_KEY/USPS_CONSUMER_SECRET no configurados');
  const r = await fetch(`${uspsBaseUrl(env)}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.USPS_CONSUMER_KEY,
      client_secret: env.USPS_CONSUMER_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`USPS OAuth falló (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.access_token;
}
// El Payment Authorization Token (Payments API, POST /payment-authorization) es
// distinto del OAuth token — autoriza cargar el franqueo real a la cuenta EPS.
// Vale 8h; como este Worker no guarda estado entre invocaciones, se pide de nuevo
// en cada guía (volumen bajo — mismo criterio ya aceptado para gmailAccessToken()).
//
// Payload verificado (20 sep) contra el spec OpenAPI real de la Payments API
// (payments_5_0.yaml, descargado por el usuario de developers.usps.com/paymentsv3):
//   - El endpoint real es /payment-authorization, no /payment-token.
//   - El campo de respuesta real es paymentAuthorizationToken (top-level, string),
//     no paymentToken/payment_token.
//   - El rol LABEL_OWNER exige CRID+MID+manifestMID; el rol PAYER exige
//     CRID+accountType('EPS')+accountNumber — sin estos datos reales de la cuenta
//     USPS devuelve 400. No se pueden inventar, son específicos de cada cuenta.
async function uspsPaymentToken(env, oauthToken) {
  const required = ['USPS_CRID', 'USPS_MID', 'USPS_MANIFEST_MID', 'USPS_EPS_ACCOUNT'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Faltan secrets de USPS: ${missing.join(', ')}`);
  const r = await fetch(`${uspsBaseUrl(env)}/payments/v3/payment-authorization`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roles: [
        { roleName: 'LABEL_OWNER', CRID: env.USPS_CRID, MID: env.USPS_MID, manifestMID: env.USPS_MANIFEST_MID },
        { roleName: 'PAYER', CRID: env.USPS_CRID, accountType: 'EPS', accountNumber: env.USPS_EPS_ACCOUNT },
      ],
    }),
  });
  if (!r.ok) throw new Error(`USPS payment authorization falló (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.paymentAuthorizationToken;
}
// fromAddress (dirección de remitente) sale de un secret, NUNCA hardcodeada acá —
// este archivo vive en workers-src, que también es público (ver CLAUDE.md), y una
// dirección real de casa/negocio no debe quedar en texto plano en ningún repo.
//
// Payload verificado contra el spec OpenAPI real de la Labels API (compartido por
// el usuario, labels_16_0.yaml de developers.usps.com) — ya no es un best-effort:
// - weightUOM SOLO acepta 'lb' en el schema real (no existe 'oz') — se recibe el
//   peso en onzas (más natural para bisutería) y se convierte acá mismo.
// - length/width/height/dimensionsUOM son propiedades planas de packageDescription.
// - Accept: application/vnd.usps.labels+json pide la respuesta como un solo JSON
//   (LabelVendorResponse) en vez del multipart/form-data por defecto — mucho más
//   simple de parsear en un Worker. trackingNumber/labelImage confirmados exactos
//   contra ese schema (labelImage = base64 del PDF, top-level).
// - X-Idempotency-Key (orderId) evita comprar 2 guías si la llamada se reintenta
//   por un corte de red — mismo criterio de idempotencia ya usado en el resto del
//   repo (ver _orderIdemKey en la tienda).
// - Todo paquete sale asegurado por $100 (decisión de negocio, 21 sep) — código 930
//   = "Insurance <= $500" en el enum `extraServices` del spec real; `packageValue`
//   es el valor declarado que exige USPS para calcular ese seguro. Monto fijo, no
//   configurable por pedido.
const USPS_INSURANCE_EXTRA_SERVICE = 930;
const USPS_INSURANCE_VALUE_USD = 100;
async function uspsCreateLabel(env, { oauthToken, paymentToken, toAddress, weightOz, lengthIn, widthIn, heightIn, orderId }) {
  if (!env.USPS_FROM_ADDRESS) throw new Error('USPS_FROM_ADDRESS no configurado');
  let fromAddress;
  try { fromAddress = JSON.parse(env.USPS_FROM_ADDRESS); }
  catch { throw new Error('USPS_FROM_ADDRESS no es JSON válido'); }
  const r = await fetch(`${uspsBaseUrl(env)}/labels/v3/label`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oauthToken}`,
      'X-Payment-Authorization-Token': paymentToken,
      'X-Idempotency-Key': String(orderId),
      Accept: 'application/vnd.usps.labels+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageInfo: { imageType: 'PDF', labelType: 'SHIPPING_LABEL_101' },
      toAddress,
      fromAddress,
      packageDescription: {
        weightUOM: 'lb',
        weight: weightOz / 16,
        dimensionsUOM: 'in',
        length: lengthIn,
        width: widthIn,
        height: heightIn,
        mailClass: 'USPS_GROUND_ADVANTAGE',
        processingCategory: 'MACHINABLE',
        rateIndicator: 'SP',
        mailingDate: new Date().toISOString().slice(0, 10),
        extraServices: [USPS_INSURANCE_EXTRA_SERVICE],
        packageOptions: { packageValue: USPS_INSURANCE_VALUE_USD },
      },
    }),
  });
  if (!r.ok) throw new Error(`USPS label falló (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

// Genera la guía para UN pedido ya existente — nunca confía en una dirección que
// mande el body, siempre la del pedido guardado (mismo criterio de todo el repo:
// nunca confiar en el cliente para datos que ya están verificados server-side).
// Disparo 100% manual (decisión del usuario, no automático) — así Tita/Robin
// revisan la dirección antes de gastar franqueo real de la cuenta EPS.
async function handleUspsLabel(body, env, origin, session, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.orderId;
  if (id == null) return err('Falta orderId', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);

  const cliente = order.cliente || {};
  const paisUpper = (cliente.pais || '').toUpperCase();
  if (!['USA', 'US', 'ESTADOS UNIDOS', 'UNITED STATES'].includes(paisUpper)) {
    return err('Esta guía es solo para pedidos a Estados Unidos — para Ecuador seguí usando Servientrega a mano.', 400, origin);
  }
  if (!cliente.direccion || !cliente.ciudad || !cliente.estado || !cliente.zip) {
    return err('Al pedido le falta dirección/ciudad/estado/ZIP completos — completalo antes de generar la guía.', 400, origin);
  }

  // Peso y las 3 dimensiones son obligatorios (decisión de negocio, 21 sep) — antes
  // caían en silencio al default del catálogo si venían vacíos; ahora el panel los
  // precarga con ese mismo default pero el admin los ve y confirma (o ajusta) antes
  // de generar la guía, así que acá ya no hace falta ningún fallback ni leer el
  // catálogo — solo validar que lleguen completos.
  const weightOz = Number(body.weightOz);
  const lengthIn = Number(body.lengthIn);
  const widthIn  = Number(body.widthIn);
  const heightIn = Number(body.heightIn);
  if (!(weightOz > 0 && lengthIn > 0 && widthIn > 0 && heightIn > 0)) {
    return err('Peso y las 3 dimensiones del paquete son obligatorios para generar la guía.', 400, origin);
  }

  try {
    const oauthToken = await uspsOAuthToken(env);
    const paymentToken = await uspsPaymentToken(env, oauthToken);
    const label = await uspsCreateLabel(env, {
      oauthToken, paymentToken, weightOz, lengthIn, widthIn, heightIn, orderId: order.id,
      toAddress: {
        firstName: cliente.nombre,
        lastName: cliente.apellido,
        streetAddress: cliente.direccion,
        secondaryAddress: cliente.apto || undefined,
        city: cliente.ciudad,
        state: cliente.estado,
        ZIPCode: String(cliente.zip).split('-')[0],
        phone: cliente.telefono || undefined,
      },
    });
    order.tracking = label.trackingNumber || '';
    order.carrier = 'USPS';
    order.labelBase64 = label.labelImage || '';
    order.labelFormat = 'PDF';
    // Necesarios para que handleUspsSchedulePickup() sepa cuántas guías se generaron
    // HOY y cuánto pesan en total, sin tener que adivinar ni volver a leer nada más.
    order.labelGeneratedAt = new Date().toISOString();
    order.labelWeightOz = weightOz;
    await env.CACUSA_KV.put(orderKey(order.id), JSON.stringify(order));
    if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
    if (ctx) ctx.waitUntil(sendShippingConfirmationEmail(order, env).catch(e => console.error('email de tracking falló:', e.message)));
    return ok({ ok: true, tracking: order.tracking, labelBase64: order.labelBase64, labelFormat: order.labelFormat }, origin);
  } catch (e) {
    console.error('USPS label falló:', e.message);
    return err('No se pudo generar la guía: ' + e.message, 502, origin);
  }
}

// Carrier Pickup — pide que el cartero pase por la dirección de remitente
// (USPS_FROM_ADDRESS) y retire lo que esté listo, con la misma instrucción "toca la
// puerta, se lleva el paquete" que el usuario ya usa a mano en su cuenta de USPS.com
// (`packageLocation: 'KNOCK_ON_DOOR'` — valor de primera clase del enum real, no un
// texto libre). Payload verificado contra el spec OpenAPI real
// (`carrier-pickup_8.yaml` v3.1.10, developers.usps.com/carrierpickupv3).
function uspsPickupContact(fromAddress) {
  const cell = String(fromAddress.phone || '').replace(/\D/g, '').slice(-10);
  if (cell.length !== 10) throw new Error('USPS_FROM_ADDRESS.phone debe tener 10 dígitos para pedir la recolección');
  return [{ cellNumber: cell }];
}
async function uspsSchedulePickup(env, oauthToken, { fromAddress, packageCount, estimatedWeight, pickupDate }) {
  const r = await fetch(`${uspsBaseUrl(env)}/pickup/v3/carrier-pickup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pickupDate,
      pickupAddress: {
        firstName: fromAddress.firstName,
        lastName: fromAddress.lastName,
        address: {
          streetAddress: fromAddress.streetAddress,
          secondaryAddress: fromAddress.secondaryAddress || undefined,
          city: fromAddress.city,
          state: fromAddress.state,
          ZIPCode: fromAddress.ZIPCode,
        },
        contact: uspsPickupContact(fromAddress),
      },
      packages: [{ packageType: 'USPS_GROUND_ADVANTAGE', packageCount }],
      estimatedWeight,
      pickupLocation: { packageLocation: 'KNOCK_ON_DOOR' },
      // Si el día pedido ya no tiene servicio (cutoff 2am CT, domingo, feriado), USPS
      // reprograma solo al próximo día hábil en vez de rechazar — evita tener que
      // calcular el cutoff de zona horaria a mano acá.
      nextAvailablePickup: true,
    }),
  });
  if (!r.ok) throw new Error(`USPS pickup falló (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

// Botón "Pedir recolección de hoy" del panel — no está atado a un pedido puntual (el
// cartero pasa una vez por la dirección y se lleva TODO lo que esté listo ese día), así
// que la idempotencia es por FECHA, no por pedido: apretar el botón 2 veces el mismo
// día devuelve la misma confirmación en vez de pedir 2 recolecciones reales.
async function handleUspsSchedulePickup(body, env, origin, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const today = new Date().toISOString().slice(0, 10);
  const kvKey = `uspspickup:${today}`;
  const existingRaw = await env.CACUSA_KV.get(kvKey);
  if (existingRaw) {
    let existing;
    try { existing = JSON.parse(existingRaw); } catch { existing = null; }
    if (existing) return ok({ ok: true, alreadyRequested: true, ...existing }, origin);
  }

  const orders = await listAllOrders(env);
  const todays = orders.filter(o => o.carrier === 'USPS' && String(o.labelGeneratedAt || '').slice(0, 10) === today);
  if (!todays.length) {
    return err('No se generó ninguna guía USPS hoy — no hay nada que recoger.', 400, origin);
  }
  const packageCount = todays.length;
  const estimatedWeight = todays.reduce((sum, o) => sum + (Number(o.labelWeightOz) || 4) / 16, 0);

  if (!env.USPS_FROM_ADDRESS) return err('USPS_FROM_ADDRESS no configurado', 500, origin);
  let fromAddress;
  try { fromAddress = JSON.parse(env.USPS_FROM_ADDRESS); }
  catch { return err('USPS_FROM_ADDRESS no es JSON válido', 500, origin); }

  try {
    const oauthToken = await uspsOAuthToken(env);
    const pickup = await uspsSchedulePickup(env, oauthToken, { fromAddress, packageCount, estimatedWeight, pickupDate: today });
    const result = { confirmationNumber: pickup.confirmationNumber, pickupDate: pickup.pickupDate, packageCount };
    await env.CACUSA_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 172800 });
    return ok({ ok: true, alreadyRequested: false, ...result }, origin);
  } catch (e) {
    console.error('USPS schedule pickup falló:', e.message);
    return err('No se pudo pedir la recolección: ' + e.message, 502, origin);
  }
}

// ── Cacusa Lovers — "pedido de envío" del ciclo (nuevo, 20 sep) ─────────────────
// Antes de esto, invoice.payment_made (lovers-webhook-worker.js) solo actualizaba
// el estado de la suscriptora en Firebase — nunca quedaba ningún registro de "qué
// se le envía a quién este mes/año", así que no había nada sobre lo cual generar
// una guía. Este endpoint (Worker-a-Worker, mismo ORDER_INGEST_KEY de siempre) crea
// un pedido normal en el sistema (mismo esquema que buildOrderCore(), aparece en el
// panel como cualquier otro) con productos vacío a propósito — Tita/Robin todavía
// tienen que elegir a mano qué 2 piezas van ese ciclo, eso sigue siendo curaduría
// humana — pero con la dirección ya completa desde el día uno, que es lo único que
// hace falta para poder generar la guía después con el mismo botón/endpoint de
// arriba, sin código nuevo ahí.
async function handleLoversShipmentIngest(body, env, origin, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const invoiceId = String(body.squareInvoiceId || '').slice(0, 100);
  if (!invoiceId) return err('Falta squareInvoiceId', 400, origin);

  // Idempotencia real (no solo un intento): un reintento de Square del mismo cobro
  // no debe crear un segundo pedido de envío para el mismo ciclo. Mismo patrón que
  // el resto del repo (marcador dedicado en KV, chequeado antes de crear).
  //
  // Auditoría externa (22 sep, S04): el chequeo de abajo (get→crear→put, no
  // atómico) podía dejar pasar 2 pedidos de envío si 2 reintentos de la misma
  // factura llegaban genuinamente al mismo tiempo, o si el 2do llegaba justo entre
  // el `put` del pedido y el `put` del marcador. Reclamar la key en
  // OrderIdempotency primero (misma DO que ya usa handleOrder(), ver más arriba)
  // cierra esa carrera. Sin binding todavía, cae al comportamiento de siempre.
  const dedupeKey = 'lovershipinvoice:' + invoiceId;
  const claim = await orderIdemClaim(env, dedupeKey);
  if (!claim.claimed) {
    if (claim.timedOut) return err('Esta operación ya se está procesando, intentá de nuevo en un momento', 409, origin);
    if (claim.orderId != null) return ok({ ok: true, orderId: claim.orderId, alreadyExisted: true }, origin);
  }
  const already = await env.CACUSA_KV.get(dedupeKey);
  if (already) {
    if (claim.claimed) await orderIdemFinalize(env, dedupeKey, Number(already)).catch(() => {});
    return ok({ ok: true, orderId: Number(already), alreadyExisted: true }, origin);
  }

  const newOrder = buildOrderCore({
    cliente: {
      nombre: body.nombre, apellido: body.apellido, telefono: body.telefono,
      direccion: body.direccion, apto: body.apto, ciudad: body.ciudad,
      estado: body.estado, zip: body.zip, pais: body.pais,
    },
    productos: [],
    pago: 'Lovers',
    total: 0, subtotal: 0, envio: 0, impuesto: 0,
    notas: `Envío ${body.plan || 'Cacusa Lovers'} — pendiente de elegir piezas del ciclo`,
  }, { strictPago: false });

  assignOrderId(newOrder);
  try {
    await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
    await env.CACUSA_KV.put(dedupeKey, String(newOrder.id), { expirationTtl: 400 * 24 * 3600 });
  } catch (e) {
    if (claim.claimed) await orderIdemRelease(env, dedupeKey).catch(() => {});
    return err('No se pudo guardar el pedido de envío, intentá de nuevo', 500, origin);
  }
  if (claim.claimed) await orderIdemFinalize(env, dedupeKey, newOrder.id).catch(() => {});
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  return ok({ ok: true, orderId: newOrder.id, alreadyExisted: false }, origin);
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
function sessionKey(user, jti) { return `sess:${user}:${jti}`; }
// Auditoría (20 sep, F21-c): las sesiones eran 100% stateless (HMAC + expiración) — sin
// ningún registro server-side, no había forma de invalidar UN token específico antes de
// sus 12h naturales sin también invalidar TODAS las sesiones de ese usuario (quitándolo
// de VALID_USERS). Cada login ahora genera un `jti` random y lo registra en KV
// (`sess:<user>:<jti>`, TTL igual a la sesión) — revocar es borrar esa key sola.
// Tokens firmados ANTES de este cambio no tienen `jti`: verifyToken() los sigue
// aceptando igual (no hay sesión activa que revocar para ellos) hasta que expiren solos.
async function createSession(user, env) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const jti = b64url(crypto.getRandomValues(new Uint8Array(16)));
  if (env.CACUSA_KV) {
    await env.CACUSA_KV.put(sessionKey(user, jti), '1', { expirationTtl: SESSION_HOURS * 3600 });
  }
  return signToken({ user, exp, jti }, env);
}
async function verifyToken(token, env) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const expected = await hmac(p, env.SESSION_SECRET);
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  // Barrido de seguridad (2da ronda, 19 sep): antes solo se revisaba firma + expiración —
  // un token firmado con un usuario inválido (ej. el bug de A01, antes del fix, o cualquier
  // otro camino de firma que se descubra a futuro) seguía siendo válido hasta las 12h de
  // expiración natural, aunque passwordFor() ya rechazara ese usuario en el login. Revalidar
  // acá invalida de inmediato cualquier token histórico que no sea de un usuario real.
  if (!VALID_USERS.has(payload.user)) return null;
  // F21-c: si el token tiene jti, su sesión debe seguir registrada en KV — si no está
  // (revocada a mano vía /logout-all, o el binding no existía al momento del login), el
  // token deja de servir aunque la firma/expiración sigan siendo válidas. Sin jti (tokens
  // viejos, o KV no disponible al firmar) no hay nada que chequear — se acepta como antes.
  if (payload.jti && env.CACUSA_KV) {
    const active = await env.CACUSA_KV.get(sessionKey(payload.user, payload.jti));
    if (!active) return null;
  }
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
// El rpId ya se verifica (hash SHA-256 contra authData) pero el origin de
// clientData nunca se comparaba contra nada — un rpId es válido para
// cualquier subdominio, así que si alguna vez un subdominio quedara
// comprometido (DNS colgante, XSS), una ceremonia corrida desde ahí pasaba
// igual. Hallazgo del 19 sep (auditoría propia, A07-A19).
const WA_ORIGIN = 'https://cacusabytaitus.com';

// Auditoría (20 sep, F20): las 4 rutas de WebAuthn no tenían ningún tope de intentos
// por IP más allá del TTL de 300s del challenge — a diferencia de /login (loginrl:) y
// del resto de rutas públicas de este archivo. Límite generoso (30/hora): las 2
// cuentas reales rara vez inician sesión más de un puñado de veces al día.
async function waRateLimit(env, request, prefix, max = 30) {
  if (!env.CACUSA_KV) return true;
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const rlKey = `${prefix}:${ip}`;
  const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
  if (rlCount >= max) return false;
  await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  return true;
}

async function handleWaRegChallenge(body, env, origin, request) {
  if (!(await waRateLimit(env, request, 'warl'))) return err('Demasiados intentos. Intenta más tarde.', 429, origin);
  const session = await verifyToken(body.token, env);
  if (!session) return err('Sesión inválida', 401, origin);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.CACUSA_KV.put(`wac:${challenge}`, session.user, { expirationTtl: 300 });
  const existing = await env.CACUSA_KV.get(`wacred:${session.user}`);
  const excludeIds = existing ? [JSON.parse(existing).credentialId] : [];
  return ok({ challenge, rpId: WA_RP_ID, rpName: WA_RP_NAME, userId: session.user, excludeIds }, origin);
}

async function handleWaRegister(body, env, origin, request) {
  if (!(await waRateLimit(env, request, 'warl'))) return err('Demasiados intentos. Intenta más tarde.', 429, origin);
  const session = await verifyToken(body.token, env);
  if (!session) return err('Sesión inválida', 401, origin);
  // Auditoría (20 sep, F21-b): antes esto solo pedía un token de sesión válido — quien
  // robara un token (XSS, filtración) podía registrar su propio dispositivo en silencio,
  // ganando acceso persistente que sobrevive a la expiración del token robado. Ahora exige
  // reconfirmar la contraseña real, no solo el token — un token robado ya no alcanza solo.
  // En el flujo normal del panel esto es transparente: "Activar Face ID" ocurre justo
  // después de un login por contraseña exitoso, con la contraseña todavía en memoria.
  const expectedPass = passwordFor(session.user, env);
  if (!expectedPass || !safeEqual(body.pass || '', expectedPass)) {
    return err('Contraseña incorrecta', 401, origin);
  }
  const { challenge, credentialId, attestationObject, clientDataJSON } = body;
  if (!challenge || !credentialId || !attestationObject || !clientDataJSON) return err('Datos incompletos', 400, origin);
  const user = await env.CACUSA_KV.get(`wac:${challenge}`);
  if (!user || user !== session.user) return err('Challenge inválido', 400, origin);
  await env.CACUSA_KV.delete(`wac:${challenge}`);
  const cdBytes = b64urlDecode(clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(cdBytes));
  if (cd.type !== 'webauthn.create' || cd.challenge !== challenge) return err('clientData inválido', 400, origin);
  if (cd.origin !== WA_ORIGIN) return err('origin no coincide', 400, origin);
  const attObj = decodeCBOR(b64urlDecode(attestationObject));
  const authData = attObj.authData;
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(WA_RP_ID)));
  if (!arraysEqual(authData.slice(0, 32), rpHash)) return err('rpId no coincide', 400, origin);
  // Auditoría externa (19 sep, ronda nueva): antes no se exigía ni presencia (UP) ni
  // verificación de usuario (UV, ej. PIN/biometría) al registrar una passkey nueva —
  // solo se chequeaba que la credencial viniera atestiguada (0x40). Un authenticator
  // configurado para aceptar solo un toque, sin PIN/biometría, quedaba igual de
  // registrado que uno con Face ID/huella real. Face ID/Touch ID/Windows Hello (lo
  // único que usan las 2 cuentas reales) siempre pone ambos bits en 1, así que esto no
  // cambia el flujo normal.
  if (!(authData[32] & 0x01)) return err('User presence requerida', 400, origin);
  if (!(authData[32] & 0x04)) return err('Verificación de usuario requerida', 400, origin);
  if (!(authData[32] & 0x40)) return err('Sin datos de credencial atestiguada', 400, origin);
  const credIdLen = (authData[53] << 8) | authData[54];
  const coseKey   = authData.slice(55 + credIdLen);
  const signCount = (authData[33]<<24 | authData[34]<<16 | authData[35]<<8 | authData[36]) >>> 0;
  await env.CACUSA_KV.put(`wacred:${session.user}`, JSON.stringify({
    credentialId, publicKey: Array.from(coseKey), signCount, created: new Date().toISOString()
  }));
  // Registrar una passkey nueva solo pide un token de sesión válido — quien
  // robe un token (XSS, filtración) podría registrar su propio dispositivo
  // en silencio, reemplazando el de la dueña real. No hay forma barata de
  // pedir re-autenticación fuerte acá sin rediseñar el flujo, así que al
  // menos se avisa de inmediato — mismo patrón "ante la duda, avisar a
  // Tita/Robin" que ya usa el resto del repo (push de pedido nuevo, etc.).
  try {
    await sendWebPushAll(env, {
      title: 'CACUSA · Nueva passkey registrada',
      body: `⚠️ Se agregó un Face ID/huella nuevo para ${session.user} — si no fuiste vos, avisa ya.`,
      url: 'https://cacusabytaitus.com/ui_kits/admin/',
      tag: 'cacusa-webauthn',
      urgency: 'high',
    });
  } catch (e) { console.error('push nueva passkey falló:', e.message); }
  return ok({ ok: true }, origin);
}

async function handleWaLoginChallenge(body, env, origin, request) {
  if (!(await waRateLimit(env, request, 'warl'))) return err('Demasiados intentos. Intenta más tarde.', 429, origin);
  const { user } = body;
  // Antes distinguía "usuario no encontrado" de "sin Face ID configurado" —
  // con solo 2 cuentas reales eso alcanzaba para confirmar cuáles existen.
  // Mismo mensaje genérico para los 2 casos (el motivo real sigue quedando
  // en el log del servidor para debug).
  const genericErr = () => err('No se puede iniciar el login con Face ID', 400, origin);
  if (!WA_USERS.includes(user)) { console.log('wa-login-challenge: usuario no encontrado', user); return genericErr(); }
  const credRaw = await env.CACUSA_KV.get(`wacred:${user}`);
  if (!credRaw) { console.log('wa-login-challenge: sin passkey configurada', user); return genericErr(); }
  const { credentialId } = JSON.parse(credRaw);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.CACUSA_KV.put(`walc:${challenge}`, user, { expirationTtl: 300 });
  return ok({ challenge, credentialId, rpId: WA_RP_ID }, origin);
}

// Reto de login SIN usuario elegido de antemano — habilita el autocompletado nativo del
// navegador (Conditional UI / credenciales discoverable, 21 sep): el navegador sugiere la
// passkey directo en el campo de usuario en vez de que primero se aprete un botón "Ingresar
// con Face ID" que ya sabe de qué cuenta se trata. El servidor recién sabe qué usuario fue
// al leer `userHandle` de la respuesta, en handleWaLogin() — el resto de la verificación
// (firma, origin, rpId, UP/UV, replay) es exactamente la misma que el flujo con botón
// explícito, no se duplica nada de eso.
async function handleWaLoginChallengeAny(body, env, origin, request) {
  if (!(await waRateLimit(env, request, 'warl'))) return err('Demasiados intentos. Intenta más tarde.', 429, origin);
  const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.CACUSA_KV.put(`walc:${challenge}`, '*', { expirationTtl: 300 });
  return ok({ challenge, rpId: WA_RP_ID }, origin);
}

async function handleWaLogin(body, env, origin, request) {
  if (!(await waRateLimit(env, request, 'warl'))) return err('Demasiados intentos. Intenta más tarde.', 429, origin);
  const { challenge, credentialId, authenticatorData, clientDataJSON, signature, userHandle } = body;
  if (!challenge || !credentialId || !authenticatorData || !clientDataJSON || !signature) return err('Datos incompletos', 400, origin);
  let user = await env.CACUSA_KV.get(`walc:${challenge}`);
  if (!user) return err('Challenge inválido o expirado', 400, origin);
  await env.CACUSA_KV.delete(`walc:${challenge}`);
  // El challenge "any" (autocompletado nativo, ver handleWaLoginChallengeAny) llega marcado
  // con '*' — recién acá se sabe qué cuenta es, vía el userHandle que el propio navegador
  // devuelve para credenciales discoverable (los mismos bytes de `user.id` que se mandaron
  // al registrar la passkey, ver _waRegister en el frontend). El resto de abajo (firma,
  // origin, rpId, UP/UV, replay) es IDÉNTICO al flujo con usuario conocido de antemano.
  if (user === '*') {
    if (!userHandle) return err('Datos incompletos', 400, origin);
    try { user = new TextDecoder().decode(b64urlDecode(userHandle)); } catch { return err('userHandle inválido', 400, origin); }
    if (!WA_USERS.includes(user)) return err('Credencial no encontrada', 404, origin);
  }
  const credRaw = await env.CACUSA_KV.get(`wacred:${user}`);
  if (!credRaw) return err('Credencial no encontrada', 404, origin);
  const credData = JSON.parse(credRaw);
  if (credentialId !== credData.credentialId) return err('Credencial no coincide', 400, origin);
  const cdBytes = b64urlDecode(clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(cdBytes));
  if (cd.type !== 'webauthn.get' || cd.challenge !== challenge) return err('clientData inválido', 400, origin);
  if (cd.origin !== WA_ORIGIN) return err('origin no coincide', 400, origin);
  const authBytes = b64urlDecode(authenticatorData);
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(WA_RP_ID)));
  if (!arraysEqual(authBytes.slice(0, 32), rpHash)) return err('rpId no coincide', 400, origin);
  if (!(authBytes[32] & 0x01)) return err('User presence requerida', 400, origin);
  // Auditoría externa (19 sep, ronda nueva): faltaba exigir UV (verificación de
  // usuario — PIN/biometría), solo se chequeaba UP (presencia). Ver el comentario
  // idéntico en handleWaRegister más arriba.
  if (!(authBytes[32] & 0x04)) return err('Verificación de usuario requerida', 400, origin);
  const pubKey = await importCOSEKey(new Uint8Array(credData.publicKey));
  const valid = await verifyWebAuthnSig(authBytes, cdBytes, b64urlDecode(signature), pubKey);
  if (!valid) return err('Firma inválida', 401, origin);
  const newCount = (authBytes[33]<<24 | authBytes[34]<<16 | authBytes[35]<<8 | authBytes[36]) >>> 0;
  if (newCount > 0 && newCount <= credData.signCount) return err('Replay detectado', 401, origin);
  credData.signCount = newCount;
  await env.CACUSA_KV.put(`wacred:${user}`, JSON.stringify(credData));
  const token = await createSession(user, env);
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
