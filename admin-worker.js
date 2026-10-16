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
 *   MKT_POSTAL_ADDRESS    (text)    Dirección postal del negocio (calle o PO Box, ciudad,
 *                                   estado, ZIP) que va al pie de los correos de marketing —
 *                                   la exige la ley CAN-SPAM de EE.UU. Sin ella el panel no deja
 *                                   crear campañas reales (sí vista previa y prueba).
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
 *    de contacto. IMPORTANTE (13 oct): después pasar la app a "In production"
 *    (Google Auth Platform → Público → Publicar app). En modo "Testing" Google vence el
 *    refresh token a los 7 días y TODOS los correos fallan con invalid_grant (pasó en
 *    oct). Para publicar pide página principal + política de privacidad
 *    (cacusabytaitus.com/privacidad.html) + dominio autorizado, y NO subir logo (con
 *    logo exige verificación). Sin logo no hace falta verificar: solo la usa esta cuenta.
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
 *    GMAIL_REFRESH_TOKEN). Con la app "In production" este token no expira solo (en
 *    "Testing" vence a los 7 días). El access token dura 1h y este Worker lo renueva
 *    solo en cada envío — no se guarda en ningún lado.
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
  'https://www.cacusabytaitus.com',
  'https://admin.cacusabytaitus.com'
];

// Panel admin en su propio origen (26 sep) — separado de la tienda, que carga GTM.
const ADMIN_URL = 'https://admin.cacusabytaitus.com/';

// Origen del POS (app aparte, GitHub Pages) — solo puede usar rutas explícitamente marcadas
const POS_ORIGIN = 'https://robingonzalez-ux.github.io';

export default {
  async fetch(request, env, ctx) {
    const origin      = request.headers.get('Origin') || '';
    const allowOrigin = (ORIGIN_ALLOWLIST.includes(origin) || origin === POS_ORIGIN) ? origin : (env.ALLOWED_ORIGIN || ORIGIN_ALLOWLIST[0]);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(allowOrigin) });

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    // Link de baja del marketing (pie del correo y List-Unsubscribe one-click): GET y POST,
    // sin JSON ni sesión — por eso va antes del chequeo de método y del parseo del body.
    if (path.endsWith('/m/baja') && (request.method === 'GET' || request.method === 'POST')) {
      try { return await handleMktUnsub(request, env); }
      catch (e) { console.error('m/baja:', e.message); return new Response('Error', { status: 500 }); }
    }
    if (request.method !== 'POST') return err('Method not allowed', 405, allowOrigin);
    // Base de los links de baja: el mismo Worker que atiende esta request.
    const selfBase = new URL(request.url).origin;
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

      if (path.endsWith('/login')) return await handleLogin(body, env, allowOrigin, request, ctx);

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
      // Correo "tu suscripción se pausó" (cobro por factura sin pagar 7 días después de
      // vencer) — lo pide el cron de lovers-webhook-worker.js. Mismo guard interno.
      // Correos de ciclo de vida de Lovers (11 oct): 'expiring' (manual por vencer) y
      // 'goodbye' (cancelación). Los pide lovers-webhook-worker.js.
      if (path.endsWith('/internal/lovers/email')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        await sendLoversLifecycleEmail(body, env).catch(e => console.error('lovers email interno falló:', e.message));
        return ok({ ok: true }, allowOrigin);
      }

      if (path.endsWith('/internal/lovers/paused-email')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        await sendLoversPausedEmail(body, env).catch(e => console.error('paused-email interno falló:', e.message));
        return ok({ ok: true }, allowOrigin);
      }

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
      // Reconstruye la lista de pedidos del panel UNA vez al final de un lote (12 oct):
      // los pedidos del lote llegan con noRefresh para no escribir orders_cache 20 veces
      // seguidas (KV acepta 1 escritura por segundo a la misma llave; las demás fallan y
      // la lista podía quedar sin las últimas cajas).
      if (path.endsWith('/internal/lovers/reconcile-orders')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleLoversReconcileOrders(body, env, allowOrigin, ctx);
      }
      if (path.endsWith('/internal/orders/refresh')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, allowOrigin);
        const data = await refreshOrdersCache(env);
        return ok({ ok: true, orders: data.orders.length }, allowOrigin);
      }

      // Notificación push disparada desde OTRO Worker (hoy: cacusa-lovers-webhook, cuando
      // nace una suscriptora nueva) — autenticada con el mismo ORDER_INGEST_KEY compartido,
      // no con un token de sesión de admin (este Worker no tiene sesión iniciada).
      if (path.endsWith('/push/notify')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        if (!env.VAPID_PRIVATE_KEY_JWK) return ok({ error: 'VAPID_PRIVATE_KEY_JWK no configurado' }, allowOrigin);
        const title   = (body.title || 'CACUSA').toString().slice(0, 100);
        const text    = (body.body  || '').toString().slice(0, 200);
        const url     = (body.url   || ADMIN_URL).toString().slice(0, 300);
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
          // También las suscripciones push de esta cuenta (push:<user>:<hash>).
          cursor = undefined;
          do {
            const page = await env.CACUSA_KV.list({ prefix: `push:${session.user}:`, cursor, limit: 1000 });
            for (const k of page.keys) await env.CACUSA_KV.delete(k.name);
            cursor = page.list_complete ? null : page.cursor;
          } while (cursor);
        }
        return ok({ ok: true, revoked }, allowOrigin);
      }

      // Cierra solo la sesión actual (borra sess:<user>:<jti> de este token).
      if (path.endsWith('/logout')) {
        if (env.CACUSA_KV && session.jti) await env.CACUSA_KV.delete(sessionKey(session.user, session.jti));
        return ok({ ok: true }, allowOrigin);
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
      if (path.endsWith('/usps/rate-check')) return await handleUspsRateCheck(body, env, allowOrigin);
      if (path.endsWith('/usps/prod-payment-check')) return await handleUspsProdPaymentCheck(env, allowOrigin);
      if (path.endsWith('/order/label'))    return await handleOrderLabelGet(body, env, allowOrigin);
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
      if (path.endsWith('/marketing/audience'))   return await handleMktAudience(body, env, allowOrigin);
      if (path.endsWith('/marketing/preview'))    return await handleMktPreview(body, env, allowOrigin, selfBase);
      if (path.endsWith('/marketing/test'))       return await handleMktTest(body, env, allowOrigin, selfBase);
      if (path.endsWith('/marketing/campaign'))   return await handleMktCampaignCreate(body, env, allowOrigin, session);
      if (path.endsWith('/marketing/send-batch')) return await handleMktSendBatch(body, env, allowOrigin, selfBase);
      if (path.endsWith('/marketing/campaigns'))  return await handleMktCampaigns(env, allowOrigin);
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
          url:   ADMIN_URL,
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

// Rate limit sin gastar escrituras de KV (plan gratis: 1.000 al día para TODA la
// cuenta — antes cada ruta pública escribía su contador en KV en cada llamada, así que
// un abuso podía agotarlas y dejar sin guardar los pedidos del día). Contador en una
// instancia de la DO GiftCardLedger por name:key (ruta /rl), guardado en su storage
// SQLite (durable, 100.000 filas/día gratis). No usa la Cache API: en *.workers.dev no
// tiene efecto. Ante error, no bloquea (best-effort, igual que antes).
// opts.mode: 'take' (default), 'peek', 'hit', 'reset' — ver la ruta /rl de la DO.
async function rateLimit(env, name, key, max, windowSec, { mode = 'take', durable = true } = {}) {
  try {
    if (!env || !env.GIFT_CARD_LEDGER) return true;
    const id = env.GIFT_CARD_LEDGER.idFromName(`rl:${name}:${String(key)}`);
    const r = await env.GIFT_CARD_LEDGER.get(id).fetch('https://gc/rl', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max, windowSec, mode, durable }),
    });
    const d = await r.json();
    return d.allowed !== false;
  } catch (e) {
    console.error('rateLimit falló:', e.message);
    return true;
  }
}
function clientIp(request) {
  return (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
}

// Texto de push armado con input público: sin saltos/control, sin URLs, 40 chars.
function sanitizePushText(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

// Máx. 1 correo por destinatario por hora (correos disparados desde rutas públicas).
async function emailRecipientAllowed(env, email) {
  return rateLimit(env, 'emailrcpt', String(email || '').toLowerCase().trim(), 1, 3600);
}

// Push best-effort a las admins (nunca rompe el flujo que lo llama).
async function adminPush(env, title, body, tag = 'cacusa-system', urgency = 'high') {
  if (!env.VAPID_PRIVATE_KEY_JWK || !env.CACUSA_KV) return;
  try {
    await sendWebPushAll(env, { title, body, url: ADMIN_URL, tag, urgency });
  } catch (e) {
    console.error('adminPush falló:', e.message);
  }
}

const LOGIN_USER_MAX_FAILS = 10;
async function handleLogin(body, env, origin, request, ctx) {
  // Contadores de fallos (12 oct): en la DO (rateLimit, storage durable), no en KV —
  // en el plan gratis cada intento fallido gastaba 1–2 de las 1.000 escrituras diarias.
  const ip = clientIp(request);
  if (!(await rateLimit(env, 'login-ip', ip, 5, 3600, { mode: 'peek' }))) {
    return err('Demasiados intentos fallidos. Intenta en una hora.', 429, origin);
  }
  const user     = (body.user || '').trim();
  const pass     = body.pass || '';
  // Contador de fallos por usuario (solo usuarios reales; suma solo al fallar).
  const realUser = VALID_USERS.has(user);
  // Bloqueado 1h: mismo error genérico.
  if (realUser && !(await rateLimit(env, 'login-user', user, LOGIN_USER_MAX_FAILS, 3600, { mode: 'peek' }))) {
    return err('Usuario o contraseña incorrectos.', 401, origin);
  }
  const expected = passwordFor(user, env);
  if (!expected || !safeEqual(pass, expected)) {
    await rateLimit(env, 'login-ip', ip, 5, 3600, { mode: 'hit' });
    if (realUser) {
      const stillOk = await rateLimit(env, 'login-user', user, LOGIN_USER_MAX_FAILS, 3600, { mode: 'hit' });
      if (!stillOk) {
        const p = adminPush(env, 'CACUSA · Cuenta bloqueada', `⚠ ${LOGIN_USER_MAX_FAILS} intentos fallidos: ${user} bloqueado 1 hora`);
        if (ctx) ctx.waitUntil(p); else await p;
      }
    }
    return err('Usuario o contraseña incorrectos.', 401, origin);
  }
  if (realUser) await rateLimit(env, 'login-user', user, LOGIN_USER_MAX_FAILS, 3600, { mode: 'reset' });
  const token = await createSession(user, env);
  const p = adminPush(env, 'CACUSA · Inicio de sesión', `🔐 Inicio de sesión con contraseña: ${user}`, 'cacusa-login', 'normal');
  if (ctx) ctx.waitUntil(p); else await p;
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
    url:   ADMIN_URL,
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
    // Solo formatos seguros (ej. CA-260906-1234); si no, handleOrder usa el id.
    numero:    NUMERO_RE.test(str(order.numero, 30)) ? str(order.numero, 30) : undefined,
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

const NUMERO_RE = /^[A-Za-z0-9#-]{1,30}$/;
function orderKey(id) { return 'order:' + String(id); }
function labelKey(id) { return 'label:' + String(id); }
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
// ── Lectura de muchas llaves de KV (12 oct, plan gratis) ───────────────────────
// Cada ejecución tiene un tope de 1.000 operaciones de KV (en todos los planes). Leer
// llave por llave hacía que la lista de pedidos del panel (y el resto de listas)
// dejara de armarse al pasar ~1.000 pedidos guardados — en silencio. La lectura en
// bloque del binding (get con un arreglo, hasta 100 llaves) cuenta como 1 operación.
// Si el runtime no la soportara, cae a leer una por una (lo de siempre).
async function kvGetMany(env, keys, chunk = 100) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += chunk) {
    const part = keys.slice(i, i + chunk);
    let res = null;
    if (part.length > 1) { try { res = await env.CACUSA_KV.get(part); } catch (_) { res = null; } }
    if (res instanceof Map) { for (const k of part) out.set(k, res.get(k) ?? null); }
    else { for (const k of part) out.set(k, await env.CACUSA_KV.get(k)); }
  }
  return out;
}
async function kvListKeys(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.CACUSA_KV.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}
async function kvGetAllJson(env, prefix) {
  const values = await kvGetMany(env, await kvListKeys(env, prefix));
  const out = [];
  for (const raw of values.values()) { if (raw) { try { out.push(JSON.parse(raw)); } catch (_) {} } }
  return out;
}

async function listAllOrders(env) {
  const orders = await kvGetAllJson(env, 'order:');
  orders.sort((a, b) => (b.id || 0) - (a.id || 0));
  return orders;
}
async function refreshOrdersCacheOnce(env) {
  // El PDF de la guía nunca va en la caché (pesa); el panel lo pide a /order/label.
  const orders = (await listAllOrders(env)).map((o) => {
    if (!o || !o.labelBase64) return o;
    const { labelBase64, ...rest } = o;
    return { ...rest, labelStored: true };
  });
  const data = { version: '1.0', lastUpdated: new Date().toISOString(), orders };
  await env.CACUSA_KV.put('orders_cache', JSON.stringify(data));
  return data;
}
async function refreshOrdersCache(env) {
  try {
    return await refreshOrdersCacheOnce(env);
  } catch (e) {
    // KV acepta 1 escritura por segundo a la misma llave: si 2 pedidos entran casi juntos,
    // la segunda falla. Se reintenta una vez pasado ese segundo (con el estado de ahora).
    await new Promise((r) => setTimeout(r, 1100));
    return refreshOrdersCacheOnce(env);
  }
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
  const leads = await kvGetAllJson(env, 'lead:');
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
    if (!(await rateLimit(env, 'order', clientIp(request), 5, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
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
      // Mismo tope mensual de referidos que /coupon/validate.
      if (coupon && coupon.kind === 'referral' && await referralMonthlyCapReached(env, coupon.code)) coupon = null;
      // Auditoría (12 oct): si el cupón no valida, no queda anotado en el pedido — antes
      // quedaba igual, y un pedido falso con el código de un cupón ajeno alcanzaba para
      // gastarle usos vía /coupon/burn (que solo exige cuponAplicado === code).
      if (!coupon) order.cuponAplicado = undefined;
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
  // Keys públicas con prefijo 'pub:' — nunca chocan con las internas (referenceId de
  // Square, lovershipinvoice:...).
  const rawIdemKey = str(order.idempotencyKey, 100);
  const idemKey = rawIdemKey ? (trusted ? rawIdemKey : 'pub:' + rawIdemKey) : '';
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
  if (!newOrder.numero && order.numero) newOrder.numero = String(newOrder.id);
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
  // Pedidos públicos: máx. 1 correo por destinatario por hora (se salta en silencio).
  if (ctx) ctx.waitUntil((async () => {
    if (!trusted && !(await emailRecipientAllowed(env, orderEmailLc))) return;
    await sendOrderConfirmationEmail(newOrder, env);
  })().catch(e => console.error('email confirmación pedido falló:', e.message)));

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
        body:  `${icon} ${newOrder.pago} · ${sanitizePushText(newOrder.cliente?.nombre) || 'Cliente'} · $${newOrder.total}`,
        url:   ADMIN_URL,
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
  if (!newOrder.numero && order.numero) newOrder.numero = String(newOrder.id);
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
    if (order.labelStored) await env.CACUSA_KV.delete(labelKey(id)).catch(() => {});
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
  // Borrar el tracking a mano borra también la guía guardada: si no, quedaba el PDF viejo
  // (ej. la guía de prueba de [clienta], 16 oct) y contaba para la recolección del día.
  if ('tracking' in patch && !String(order.tracking || '').trim() && (order.labelStored || order.labelGeneratedAt)) {
    await env.CACUSA_KV.delete(labelKey(id)).catch(() => {});
    delete order.labelStored; delete order.labelFormat; delete order.labelGeneratedAt;
    delete order.labelWeightOz; delete order.labelEnv; delete order.labelBase64;
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

  if (!(await rateLimit(env, 'sq-locations', clientIp(request), 20, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);

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

  if (!(await rateLimit(env, 'sq-paylink', clientIp(request), 20, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);

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

    // Contador de rate limit (ver rateLimit()). Una instancia por nombre:clave.
    // durable (12 oct, plan gratis): el contador vive en el storage SQLite de la DO —
    // 100.000 filas escritas al día gratis, contra 1.000 escrituras de KV — y no se
    // reinicia si la instancia se descarta por inactividad (antes era solo memoria, y un
    // intento por minuto nunca llegaba al tope). mode: 'take' (consume si queda cupo),
    // 'peek' (solo mira), 'hit' (suma sin chequear: contar fallos), 'reset' (borra).
    if (url.pathname === '/rl') {
      const now = Date.now();
      const max = Math.max(1, Number(body.max) || 1);
      const windowMs = Math.max(1, Number(body.windowSec) || 60) * 1000;
      const mode = ['peek', 'hit', 'reset'].includes(body.mode) ? body.mode : 'take';
      let rl = body.durable ? await this.state.storage.get('rl') : this.rl;
      if (!rl || rl.exp <= now) rl = { n: 0, exp: now + windowMs };
      let allowed = rl.n < max;
      let changed = false;
      if (mode === 'reset') { rl = { n: 0, exp: now + windowMs }; changed = true; allowed = true; }
      else if (mode === 'hit') { rl.n++; changed = true; allowed = rl.n < max; } // false = este fallo llenó el cupo
      else if (mode === 'take' && allowed) { rl.n++; changed = true; }
      if (body.durable) {
        if (changed) {
          if (mode === 'reset') await this.state.storage.delete('rl');
          else await this.state.storage.put('rl', rl);
        }
      } else {
        this.rl = rl;
      }
      return Response.json({ allowed });
    }

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
  const cards = await kvGetAllJson(env, 'gc:');
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
  if (!(await rateLimit(env, 'gc-validate-ip', clientIp(request), 15, 3600))) return ok({ valid: false }, origin);
  // Rate limit por código: max 8 intentos fallidos/hr — silencioso para no revelar existencia del código
  const rawCode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!rawCode) return ok({ valid: false }, origin);
  if (!(await rateLimit(env, 'gc-validate-code', rawCode, 8, 3600, { mode: 'peek' }))) return ok({ valid: false }, origin);
  const card = await gcGet(env, rawCode);
  const valid = !!(card && card.active !== false && card.balance > 0);
  if (!valid) await rateLimit(env, 'gc-validate-code', rawCode, 8, 3600, { mode: 'hit' });
  if (!valid) return ok({ valid: false }, origin);
  return ok({ valid: true, balance: card.balance }, origin);
}

// Redención — pública para Zelle/WhatsApp (origin-restringida + rate-limit por IP),
// o interna desde cacusa-square (ORDER_INGEST_KEY) tras confirmar el pago con tarjeta.
async function handleGcRedeem(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  if (!isInternalIngest(request, env)) {
    if (!(await rateLimit(env, 'gc-redeem', clientIp(request), 15, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
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
function emailShellGeneric({ lang, preheader, eyebrow, title, bodyHtml, ctaText, ctaUrl, footerExtraHtml = '', waText = '' }) {
  const waMsg = encodeURIComponent(waText || (lang === 'en' ? 'Hi! I have a question about my CACUSA by Taitus order.' : 'Hola, tengo una consulta sobre mi pedido de CACUSA by Taitus.'));
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
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#96486F;">${footerText}</div>${footerExtraHtml}
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
  const numeroRaw = String(order.numero || ('#' + order.id));
  const numero = esc(numeroRaw); // va al HTML (preheader incluido)
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
      subject: `Order confirmed — ${numeroRaw} — CACUSA by Taitus`,
      html: emailShellGeneric({
        lang, preheader: `We've got your order ${numero} — here's what you ordered.`,
        eyebrow: 'Order confirmed', title: `Thank you${nombre ? ', ' + esc(nombre) : ''}! ✦`,
        bodyHtml, ctaText: 'Keep shopping →', ctaUrl: storeUrl,
      }),
    };
  }
  return {
    subject: `Pedido confirmado — ${numeroRaw} — CACUSA by Taitus`,
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
async function lookupActiveLoversPhone(phoneDigits, env) {
  if (!env.ORDER_INGEST_KEY) return { active: false };
  try {
    const r = await loversFetch(env, `/internal/lovers/active?phone=${encodeURIComponent(phoneDigits)}`, {
      headers: { 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
    });
    if (!r.ok) return { active: false };
    const d = await r.json().catch(() => ({}));
    // email/idioma solo vienen si está activa (lovers-webhook >= 26 sep).
    return { active: !!d.active, email: d.active ? (d.email || '') : '', idioma: d.idioma === 'en' ? 'en' : 'es' };
  } catch (e) {
    return { active: false };
  }
}
async function isActiveLoversPhone(phoneDigits, env) {
  return (await lookupActiveLoversPhone(phoneDigits, env)).active;
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
  if (!(await rateLimit(env, 'referral-ip', clientIp(request), 10, 3600))) return err(REFERRAL_GENERIC_MSG, 429, origin);

  const name = String(body.name || '').trim().slice(0, 100);
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  if (!name || phoneDigits.length < 7) {
    return err('Faltan nombre o teléfono válido', 400, origin);
  }
  if (!(await rateLimit(env, 'referral-phone', phoneDigits.slice(-7), 5, 3600))) return err(REFERRAL_GENERIC_MSG, 429, origin);
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

function loversShippingCodeEmailContent(code, idioma) {
  const bodyHtml = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 18px;">
<tr><td style="background:#FCE8F3;border:1.5px dashed #C0336E;border-radius:10px;padding:14px 30px;">
<span style="font-family:Georgia,'Bodoni Moda',serif;font-size:24px;font-weight:700;letter-spacing:3px;color:#C0336E;">${esc(code)}</span>
</td></tr>
</table>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#96486F;text-align:center;margin:0;">${idioma === 'en'
    ? 'Use it at checkout for free shipping on every store order while your subscription is active.'
    : 'Úsalo al pagar para tener envío gratis en todas tus compras mientras tu suscripción esté activa.'}</p>`;
  const storeUrl = idioma === 'en' ? 'https://cacusabytaitus.com/en/ui_kits/store/' : 'https://cacusabytaitus.com/ui_kits/store/';
  if (idioma === 'en') {
    return {
      subject: 'Your free shipping code — Cacusa Lovers',
      html: emailShellGeneric({
        lang: 'en', preheader: 'Your personal Cacusa Lovers free shipping code.',
        eyebrow: 'Cacusa Lovers', title: 'Free shipping, always ✦',
        bodyHtml, ctaText: 'Go to the store →', ctaUrl: storeUrl,
      }),
    };
  }
  return {
    subject: 'Tu código de envío gratis — Cacusa Lovers',
    html: emailShellGeneric({
      lang: 'es', preheader: 'Tu código personal de envío gratis de Cacusa Lovers.',
      eyebrow: 'Cacusa Lovers', title: 'Envío gratis, siempre ✦',
      bodyHtml, ctaText: 'Ir a la tienda →', ctaUrl: storeUrl,
    }),
  };
}

// Nunca devuelve el código: si el teléfono es de una suscriptora activa, se le manda
// al correo que tiene guardado. La respuesta es SIEMPRE la misma (no revela si es
// suscriptora). Rate limits por Cache API: 10/h por IP (429) y 1 correo/h por teléfono.
const SHIPPING_CODE_GENERIC = { ok: true, sent: true };
async function handleLoversShippingCode(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  if (!env.SESSION_SECRET) return err('No disponible', 500, origin);

  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  if (!(await rateLimit(env, 'shipcode-ip', ip, 10, 3600))) {
    return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
  }

  const name = String(body.name || '').trim().slice(0, 100);
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  if (!name || phoneDigits.length < 7) return ok(SHIPPING_CODE_GENERIC, origin);
  if (!(await rateLimit(env, 'shipcode-phone', phoneDigits.slice(-7), 1, 3600))) {
    return ok(SHIPPING_CODE_GENERIC, origin);
  }
  const lovers = await lookupActiveLoversPhone(phoneDigits, env);
  if (!lovers.active) return ok(SHIPPING_CODE_GENERIC, origin);

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
  if (isValidEmail(lovers.email)) {
    try {
      await sendGmail(env, { to: lovers.email, ...loversShippingCodeEmailContent(coupon.code, lovers.idioma) });
    } catch (e) {
      console.error('email código de envío Lovers falló:', e.message);
    }
  } else {
    console.error('shipping-code: suscriptora activa sin email válido guardado');
  }
  return ok(SHIPPING_CODE_GENERIC, origin);
}

// ── Aviso de "nueva suscripción pendiente" de Cacusa Lovers ───────────────────
// Quien llama solo manda un email; todo lo demás (si corresponde avisar, con qué
// nombre, una sola vez) lo decide cacusa-lovers-webhook leyendo Firebase con su
// propio secreto. Así nadie puede escribir el texto de un push al celular de
// Tita/Robin ni hacer sonar avisos de suscriptoras que no existen.
async function handleLoversNotifyPending(body, env, origin, request) {
  if (!env.CACUSA_KV) return err('KV no configurado', 500, origin);
  if (!env.ORDER_INGEST_KEY) return ok({ ok: true, notified: false }, origin);

  if (!(await rateLimit(env, 'lovers-pending', clientIp(request), 5, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);

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
        body:  `🕐 ${sanitizePushText(claim.nombre) || 'Alguien'} llenó el formulario (${esAnual ? 'anual' : 'mensual'}) — falta que complete el pago`,
        url:   ADMIN_URL,
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
  if (!(await rateLimit(env, 'lovers-register', clientIp(request), 10, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);

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
        body: `🕐 ${sanitizePushText(nombre) || 'Alguien'} (sin confirmar) llenó el formulario (${esAnual ? 'anual' : 'mensual'}) — falta que confirme el correo y complete el pago`,
        url: ADMIN_URL,
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
    // Máx. 1 correo de confirmación por destinatario por hora (se salta en silencio).
    if (await emailRecipientAllowed(env, email)) {
      await sendGmail(env, { to: email, ...loversRegisterEmailContent(nombre, confirmUrl, idioma) });
    }
  } catch (e) {
    // Best-effort — el pago sigue su curso igual aunque el correo falle (la clienta
    // puede confirmar más tarde si el formulario le ofrece un botón de reenviar, o
    // Tita/Robin pueden confirmarla a mano desde el panel como ya hacían antes).
    console.error('email de confirmación de Lovers falló:', e.message);
  }

  // Cobro por factura (2 oct): la página redirige a la factura del primer pago (Apple
  // Pay/Google Pay/tarjeta) en vez de a los links fijos de suscripción de Square — ver
  // "Cobro por factura" en lovers-webhook-worker.js. Si algo falla, payUrl queda vacío y
  // la página cae a los links viejos (tarjeta), así nunca se pierde una alta.
  let payUrl = '', already = false;
  if (env.ORDER_INGEST_KEY) {
    try {
      const r = await loversFetch(env, '/internal/lovers/start-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
        body: JSON.stringify({ email, nombre, apellido: pendingData.apellido, plan: pendingData.plan, idioma }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && typeof d.url === 'string' && /^https:\/\/[a-z0-9.-]*square(up)?\.(com|site|link)\//i.test(d.url)) payUrl = d.url;
      if (r.ok && d.already) already = true;
      if (!r.ok) console.error('start-invoice respondió', r.status, JSON.stringify(d).slice(0, 300));
    } catch (e) {
      console.error('start-invoice falló:', e.message);
    }
  }
  return ok({ ok: true, payUrl, already }, origin);
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
  if (!(await rateLimit(env, 'coupon-validate-ip', clientIp(request), 20, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
  // Rate limit por código: max 8 intentos fallidos/hr — silencioso
  const rawCode = String(body.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!rawCode) return ok({ valid: false }, origin);
  const rawPhone = String(body.phone || '').replace(/\D/g, '').slice(0, 20);
  const rawEmail = String(body.email || '').toLowerCase().trim().slice(0, 100);
  const coupon = await couponGet(env, rawCode);
  if (!(await rateLimit(env, 'coupon-validate-code', rawCode, 8, 3600, { mode: 'peek' }))) return ok({ valid: false }, origin);
  // El chequeo de "cupón ya usado" (cpused:ph/em, saltado para cupones pensados para
  // reusarse — restrictToEmail o envío gratis de Lovers) vive DENTRO de couponIsValid()
  // desde el 22 sep (S08a) — un solo lugar, en vez de duplicarlo acá y en handleOrder().
  let valid = await couponIsValid(coupon, rawEmail, rawPhone, env);
  // Cupones de referido: máximo 1 regalo por mes por código, sin importar quién lo use.
  if (valid && coupon.kind === 'referral' && await referralMonthlyCapReached(env, rawCode)) valid = false;
  if (!valid) await rateLimit(env, 'coupon-validate-code', rawCode, 8, 3600, { mode: 'hit' });
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
  if (!(await rateLimit(env, 'lead-register', clientIp(request), 3, 3600))) return ok({ ok: true }, origin);
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
  if (!(await rateLimit(env, 'lead-cancel', clientIp(request), 10, 3600))) return ok({ ok: true }, origin);
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
    // Texto que viene del navegador: mismo saneo que los demás avisos (sin URLs ni saltos).
    const itemNames = (lead.cart || []).map(i => sanitizePushText(i.name)).filter(Boolean).slice(0, 3).join(', ');
    const totalTxt = typeof lead.total === 'number' ? ` · $${lead.total.toFixed(2)}` : '';
    await sendWebPushAll(env, {
      title: 'CACUSA · Carrito abandonado',
      body: `🛒 ${lead.email}${totalTxt}${itemNames ? ' — ' + itemNames : ''}`,
      url: ADMIN_URL,
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
    if (!(await rateLimit(env, 'coupon-burn', clientIp(request), 15, 3600))) return err('Demasiadas solicitudes. Intenta más tarde.', 429, origin);
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
  const coupons = await kvGetAllJson(env, 'coupon:');
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
  const body  = `${icon} ${order.pago} · ${sanitizePushText(order.cliente?.nombre) || 'Cliente'} · $${order.total}`;
  try {
    const r = await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
      method:  'POST',
      headers: {
        'Title':        'CACUSA · Nuevo pedido',
        'Priority':     'high',
        'Tags':         'bell,shopping',
        'Click':        ADMIN_URL,
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
async function sendWebPushAll(env, payload, { excludeKey } = {}) {
  const list = await env.CACUSA_KV.list({ prefix: 'push:' });
  const stats = { total: list.keys.length, sent: 0, failed: 0, cleaned: 0 };
  for (const k of list.keys) {
    if (excludeKey && k.name === excludeKey) continue;
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
// Solo push services reales (FCM, Mozilla, Windows, Apple) — nunca una URL arbitraria.
function isAllowedPushEndpoint(endpoint) {
  let u;
  try { u = new URL(String(endpoint)); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  return h === 'fcm.googleapis.com' || h.endsWith('.push.services.mozilla.com') ||
    h.endsWith('.notify.windows.com') || h === 'web.push.apple.com' || h.endsWith('.push.apple.com');
}
async function handlePushSubscribe(body, env, origin, session) {
  const sub = body.subscription;
  if (!sub || !sub.endpoint || !sub.keys) return err('Suscripción inválida', 400, origin);
  if (!isAllowedPushEndpoint(sub.endpoint)) return err('Endpoint de push no permitido', 400, origin);
  const key = await pushKeyFor(session.user, sub.endpoint);
  const existed = !!(await env.CACUSA_KV.get(key));
  await env.CACUSA_KV.put(key, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }));
  // Dispositivo nuevo: avisar a los demás ya suscritos.
  if (!existed && env.VAPID_PRIVATE_KEY_JWK) {
    await sendWebPushAll(env, {
      title: 'CACUSA · Nuevo dispositivo',
      body: `🔔 Un dispositivo nuevo empezó a recibir avisos (usuario ${session.user})`,
      url: ADMIN_URL,
      tag: 'cacusa-system',
      urgency: 'normal',
    }, { excludeKey: key }).catch((e) => console.error('push dispositivo nuevo falló:', e.message));
  }
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

async function sendGmail(env, { to, subject, html, accessToken: token, headers }) {
  if (!env.GMAIL_REFRESH_TOKEN) throw new Error('GMAIL_REFRESH_TOKEN no configurado');
  // Última barrera antes de armar el MIME: `to` se concatena crudo en la cabecera To:.
  // Se valida acá además de en cada punto de entrada porque este es el cuello de
  // botella por donde pasa TODO correo del sistema — incluidos los que traen la
  // dirección desde Firebase (el cupón exclusivo), que la escribe el formulario
  // público de suscripción. Cualquier ruta de envío nueva queda cubierta sola.
  if (!isValidEmail(to)) throw new Error('Destinatario inválido');
  // token: el que ya pidió quien llama (las tandas de marketing piden 1 solo por tanda).
  const accessToken = token || await gmailAccessToken(env);
  // Cabeceras extra (hoy solo List-Unsubscribe/-Post del marketing): nombre y valor
  // validados — nada que traiga \r o \n llega al MIME.
  let extra = '';
  for (const [k, v] of Object.entries(headers || {})) {
    if (/^[A-Za-z][A-Za-z-]{0,40}$/.test(k) && typeof v === 'string' && v && !/[\r\n]/.test(v)) extra += `${k}: ${v.slice(0, 900)}\r\n`;
  }
  const subjectEncoded = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const mime =
    `From: CACUSA by Taitus <facturacioncacusa@gmail.com>\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subjectEncoded}\r\n` +
    extra +
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

// Correo "tu suscripción se pausó" — cobro por factura (2 oct). Solo acepta como botón
// una URL de Square (la factura pendiente); si no hay, el botón lleva a la página de
// Lovers para volver a suscribirse.
function loversPausedEmailContent(nombre, url, lang) {
  const safeUrl = /^https:\/\/[a-z0-9.-]*square(up)?\.(com|site|link)\//i.test(url || '') ? url
    : (lang === 'en' ? 'https://cacusabytaitus.com/en/cacusa-lovers.html' : 'https://cacusabytaitus.com/cacusa-lovers.html');
  const p = (t) => `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#96486F;text-align:center;margin:0 0 14px;">${t}</p>`;
  if (lang === 'en') {
    return {
      subject: 'Your Cacusa Lovers membership is paused',
      html: emailShellGeneric({
        lang, preheader: 'Your payment is pending — pay anytime to reactivate.',
        eyebrow: 'Cacusa Lovers', title: `We miss you${nombre ? ', ' + esc(nombre) : ''} ♡`,
        bodyHtml: p('We didn\'t receive your Cacusa Lovers payment, so your benefits (5% off and free shipping) are paused for now.')
          + p('You can reactivate anytime by paying your pending invoice with Apple Pay, Google Pay or card.'),
        ctaText: 'Pay and reactivate →', ctaUrl: safeUrl,
      }),
    };
  }
  return {
    subject: 'Tu membresía Cacusa Lovers está en pausa',
    html: emailShellGeneric({
      lang, preheader: 'Tu pago está pendiente — paga cuando quieras para reactivarla.',
      eyebrow: 'Cacusa Lovers', title: `Te extrañamos${nombre ? ', ' + esc(nombre) : ''} ♡`,
      bodyHtml: p('No recibimos tu pago de Cacusa Lovers, así que tus beneficios (5% de descuento y envío gratis) quedaron en pausa por ahora.')
        + p('Puedes reactivarla cuando quieras pagando tu factura pendiente con Apple Pay, Google Pay o tarjeta.'),
      ctaText: 'Pagar y reactivar →', ctaUrl: safeUrl,
    }),
  };
}

function loversLifecycleEmailContent(kind, nombre, vence, lang) {
  const p = (t) => `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#96486F;text-align:center;margin:0 0 14px;">${t}</p>`;
  const en = lang === 'en';
  const loversUrl = en ? 'https://cacusabytaitus.com/en/cacusa-lovers.html' : 'https://cacusabytaitus.com/cacusa-lovers.html';
  const wa = 'https://wa.me/17867375336';
  const fechaTxt = /^\d{4}-\d{2}-\d{2}$/.test(vence || '')
    ? new Date(vence + 'T12:00:00Z').toLocaleDateString(en ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  const hi = nombre ? ', ' + esc(nombre) : '';
  if (kind === 'expiring') {
    return en ? {
      subject: 'Your Cacusa Lovers membership is about to expire',
      html: emailShellGeneric({
        lang, preheader: 'Renew to keep receiving your monthly pieces.',
        eyebrow: 'Cacusa Lovers', title: `Just a reminder${hi} ♡`,
        bodyHtml: p(`Your Cacusa Lovers membership ${fechaTxt ? 'expires on <strong>' + esc(fechaTxt) + '</strong>' : 'is about to expire'}.`)
          + p('To keep receiving your 2 handmade pieces every month, plus your 5% off and free shipping, message us on WhatsApp to renew.'),
        ctaText: 'Renew on WhatsApp →', ctaUrl: wa,
      }),
    } : {
      subject: 'Tu membresía Cacusa Lovers está por vencer',
      html: emailShellGeneric({
        lang, preheader: 'Renueva para seguir recibiendo tus piezas cada mes.',
        eyebrow: 'Cacusa Lovers', title: `Un recordatorio${hi} ♡`,
        bodyHtml: p(`Tu membresía Cacusa Lovers ${fechaTxt ? 'vence el <strong>' + esc(fechaTxt) + '</strong>' : 'está por vencer'}.`)
          + p('Para seguir recibiendo tus 2 piezas hechas a mano cada mes, además de tu 5% de descuento y el envío gratis, escríbenos por WhatsApp y la renovamos.'),
        ctaText: 'Renovar por WhatsApp →', ctaUrl: wa,
      }),
    };
  }
  // goodbye
  return en ? {
    subject: 'Thank you for being a Cacusa Lover ♡',
    html: emailShellGeneric({
      lang, preheader: 'Your membership has been canceled — the door is always open.',
      eyebrow: 'Cacusa Lovers', title: `Thank you${hi} ♡`,
      bodyHtml: p('Your Cacusa Lovers membership has been canceled. Thank you for being part of our community and for letting us create pieces just for you every month.')
        + p('We\'d love to have you back soon — new handmade designs arrive every month, and the club will be waiting for you whenever you\'re ready.'),
      ctaText: 'Come back to Cacusa Lovers →', ctaUrl: loversUrl,
    }),
  } : {
    subject: 'Gracias por ser una Cacusa Lover ♡',
    html: emailShellGeneric({
      lang, preheader: 'Tu membresía fue cancelada — la puerta siempre está abierta.',
      eyebrow: 'Cacusa Lovers', title: `Gracias${hi} ♡`,
      bodyHtml: p('Tu membresía Cacusa Lovers fue cancelada. Gracias por haber sido parte de nuestra comunidad y por dejarnos crear piezas pensadas en ti cada mes.')
        + p('Nos encantaría tenerte de vuelta pronto: cada mes llegan diseños nuevos hechos a mano, y el club te estará esperando cuando quieras volver.'),
      ctaText: 'Volver a Cacusa Lovers →', ctaUrl: loversUrl,
    }),
  };
}

async function sendLoversLifecycleEmail(body, env) {
  const email = String(body.email || '').toLowerCase().trim();
  if (!isValidEmail(email)) return;
  const kind = body.kind === 'expiring' ? 'expiring' : (body.kind === 'goodbye' ? 'goodbye' : null);
  if (!kind) return;
  const lang = body.idioma === 'en' ? 'en' : 'es';
  try {
    await sendGmail(env, { to: email, ...loversLifecycleEmailContent(kind, String(body.nombre || '').slice(0, 100), String(body.vence || ''), lang) });
  } catch (e) {
    console.error('email Lovers', kind, 'falló:', e.message);
  }
}

async function sendLoversPausedEmail(body, env) {
  const email = String(body.email || '').toLowerCase().trim();
  if (!isValidEmail(email)) return;
  const lang = body.idioma === 'en' ? 'en' : 'es';
  try {
    await sendGmail(env, { to: email, ...loversPausedEmailContent(String(body.nombre || '').slice(0, 100), String(body.url || ''), lang) });
  } catch (e) {
    console.error('email de suscripción pausada falló:', e.message);
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
// Caché de tokens (10 oct): USPS aprobó Shipping Suite 0 con un límite de 50 llamadas
// por día y pide expresamente NO regenerar el OAuth token ni el payment token en cada
// llamada (ambos valen 8 h). Se guardan en KV con un margen antes de que venzan. La
// clave incluye el ambiente (tem/prod) y un hash del Consumer Key, así un cambio de
// credenciales o de ambiente nunca reusa un token viejo. Sin KV, se piden cada vez.
async function uspsTokenKey(env, kind) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(env.USPS_CONSUMER_KEY || '')));
  const hex = [...new Uint8Array(h)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  return `uspstok:${kind}:${env.USPS_ENV === 'prod' ? 'prod' : 'tem'}:${hex}`;
}
async function uspsClearTokens(env) {
  if (!env.CACUSA_KV) return;
  await env.CACUSA_KV.delete(await uspsTokenKey(env, 'oauth'));
  await env.CACUSA_KV.delete(await uspsTokenKey(env, 'pay'));
}
// Corre fn(oauthToken, paymentToken) con tokens del caché; si USPS responde 401 (token
// revocado antes de tiempo), limpia el caché y reintenta UNA vez con tokens nuevos.
// 16 oct: lo mismo si la autorización de pago da 403 con un OAuth token del caché — los
// "claims" del token (CRID, cuentas de pago) se fijan al emitirlo; después de "Refresh
// Claims" en el Customer Onboarding Portal, un token guardado (hasta 8 h) seguiría sin
// ellos. Con un token recién pedido no se reintenta (un 403 ahí es real).
async function uspsWithTokens(env, needPayment, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cached = attempt === 0 && env.CACUSA_KV ? !!(await env.CACUSA_KV.get(await uspsTokenKey(env, 'oauth'))) : false;
    const oauthToken = await uspsOAuthToken(env);
    let paymentToken = null;
    if (needPayment) {
      try {
        paymentToken = await uspsPaymentToken(env, oauthToken);
      } catch (e) {
        if (attempt === 0 && cached && e && e.status === 403) { await uspsClearTokens(env); continue; }
        throw e;
      }
    }
    try {
      return await fn(oauthToken, paymentToken);
    } catch (e) {
      if (attempt === 0 && e && e.status === 401) { await uspsClearTokens(env); continue; }
      throw e;
    }
  }
}
function uspsError(msg, status) { const e = new Error(msg); e.status = status; return e; }

async function uspsOAuthToken(env) {
  if (!env.USPS_CONSUMER_KEY || !env.USPS_CONSUMER_SECRET) throw new Error('USPS_CONSUMER_KEY/USPS_CONSUMER_SECRET no configurados');
  const cacheKey = env.CACUSA_KV ? await uspsTokenKey(env, 'oauth') : null;
  if (cacheKey) { const c = await env.CACUSA_KV.get(cacheKey); if (c) return c; }
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
  if (cacheKey && d.access_token) {
    const ttl = Math.max(60, Math.min(Number(d.expires_in) || 28800, 28800) - 600);
    await env.CACUSA_KV.put(cacheKey, d.access_token, { expirationTtl: ttl });
  }
  return d.access_token;
}
// El Payment Authorization Token (Payments API, POST /payment-authorization) es
// distinto del OAuth token — autoriza cargar el franqueo real a la cuenta EPS.
// Vale 8h; se guarda en KV 7h30 (ver uspsTokenKey/uspsWithTokens).
//
// Payload verificado (20 sep) contra el spec OpenAPI real de la Payments API
// (payments_5_0.yaml, descargado por el usuario de developers.usps.com/paymentsv3):
//   - El endpoint real es /payment-authorization, no /payment-token.
//   - El campo de respuesta real es paymentAuthorizationToken (top-level, string),
//     no paymentToken/payment_token.
//   - El rol LABEL_OWNER exige CRID+MID+manifestMID; el rol PAYER exige
//     CRID+accountType('EPS')+accountNumber — sin estos datos reales de la cuenta
//     USPS devuelve 400. No se pueden inventar, son específicos de cada cuenta.
// Resumen SEGURO de lo que el OAuth token (JWT) dice de la cuenta: solo CRID, cuentas de
// pago, roles y scopes, comparado con lo que mandamos. Nunca devuelve el token ni sus
// firmas. Si el token no es un JWT o no trae esos campos, lo dice en vez de fallar.
function uspsTokenClaimsSummary(oauthToken, env, etiqueta = 'Datos del token de USPS', envLabel) {
  try {
    const part = String(oauthToken || '').split('.')[1];
    if (!part) return ` | ${etiqueta}: el token no es un JWT legible.`;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))));
    const list = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.accountNumber || x.account || x.CRID || x.crid || JSON.stringify(x)) : x).join(',') : (v == null ? '—' : String(v));
    const pick = (...k) => { for (const x of k) if (claims[x] != null && claims[x] !== '') return claims[x]; return null; };
    const parts = [
      `crid=${list(pick('crid', 'CRID', 'crids'))}`,
      `cuentas_de_pago=${list(pick('payment_accounts', 'paymentAccounts', 'accounts'))}`,
      `roles=${list(pick('roles'))}`,
      `scope=${String(pick('scope', 'scopes') || '—').slice(0, 400)}`,
      // Solo los NOMBRES de los campos del token (sin valores), para ver si trae el CRID o las
      // cuentas de pago bajo otro nombre que los que buscamos arriba.
      `campos=${Object.keys(claims).slice(0, 30).join(',')}`,
      `empresa=${list(pick('company_name'))}`,
      `mail_owners=${list(pick('mail_owners'))}`,
      `pedimos: crid=${env.USPS_CRID} eps=${env.USPS_EPS_ACCOUNT} env=${envLabel || (env.USPS_ENV === 'prod' ? 'prod' : 'tem')}`,
    ];
    return ` | ${etiqueta}: ${parts.join(' ; ')}`.slice(0, 1400);
  } catch (e) {
    return ` | ${etiqueta}: no se pudo leer el token.`;
  }
}
async function uspsPaymentToken(env, oauthToken) {
  const required = ['USPS_CRID', 'USPS_MID', 'USPS_MANIFEST_MID', 'USPS_EPS_ACCOUNT'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Faltan secrets de USPS: ${missing.join(', ')}`);
  const cacheKey = env.CACUSA_KV ? await uspsTokenKey(env, 'pay') : null;
  if (cacheKey) { const c = await env.CACUSA_KV.get(cacheKey); if (c) return c; }
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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    // 403 = USPS no autoriza esa combinación CRID/MID/EPS para ESTAS credenciales. El OAuth
    // token es un JWT que trae a qué CRID y a qué cuentas de pago da acceso USPS: mostrarlo
    // (solo esos datos, jamás el token) deja ver de inmediato si el problema es lo que pedimos
    // o lo que USPS tiene registrado (13-16 oct: 403 repetido aun con CRID/MID/EPS correctos).
    let info = r.status === 403 ? uspsTokenClaimsSummary(oauthToken, env) : '';
    // Diagnóstico temporal (16 oct): desde TEM, pide TAMBIÉN un OAuth token de producción y
    // muestra qué CRID/cuentas de pago trae. Solo es un OAuth (client_credentials): no autoriza
    // pagos ni compra guías, no se guarda en caché ni se usa para nada más. Quitar cuando
    // USPS resuelva el 403.
    if (r.status === 403 && env.USPS_ENV !== 'prod') {
      try {
        const pr = await fetch('https://apis.usps.com/oauth2/v3/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.USPS_CONSUMER_KEY, client_secret: env.USPS_CONSUMER_SECRET }),
        });
        if (pr.ok) {
          const pd = await pr.json();
          info += uspsTokenClaimsSummary(pd.access_token, env, 'PRODUCCIÓN (solo lectura del token)', 'prod');
        } else {
          info += ` | PRODUCCIÓN: el servidor de USPS respondió ${pr.status} al pedir un token con estas credenciales.`;
        }
      } catch (e) { info += ' | PRODUCCIÓN: no se pudo consultar.'; }
    }
    throw uspsError(`USPS payment authorization falló (${r.status}): ${body}${info}`, r.status);
  }
  const d = await r.json();
  if (cacheKey && d.paymentAuthorizationToken) {
    await env.CACUSA_KV.put(cacheKey, d.paymentAuthorizationToken, { expirationTtl: 27000 });
  }
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
      // 16 oct: USPS exige un UUID (antes iba el número de pedido → 400 "not a valid UUID").
      // Sale del pedido, siempre el mismo: un reintento del mismo pedido no compra otra guía.
      'X-Idempotency-Key': await uspsIdempotencyUuid(orderId),
      Accept: 'application/vnd.usps.labels+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // 16 oct: mismo bloque que el ejemplo oficial de USPS (USPS/api-examples, README,
      // "Domestic Label Request"); 'SHIPPING_LABEL_101' no es un labelType válido → 400.
      imageInfo: {
        imageType: 'PDF',
        labelType: '4X6LABEL',
        receiptOption: 'NONE',
        suppressPostage: false,
        suppressMailDate: false,
        returnLabel: false,
      },
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
        destinationEntryFacilityType: 'NONE',
        extraServices: [USPS_INSURANCE_EXTRA_SERVICE],
        packageOptions: { packageValue: USPS_INSURANCE_VALUE_USD },
      },
    }),
  });
  // 1500: los 400 de validación de USPS listan cada campo con problema; 300 cortaba el motivo.
  if (!r.ok) throw uspsError(`USPS label falló (${r.status}): ${(await r.text()).slice(0, 1500)}`, r.status);
  return await r.json();
}
// Desglose del costo que devuelve Labels v3: postage (franqueo), extraServices [{name, price}],
// zone. Total = franqueo + extras. null si USPS no mandó precios.
function uspsLabelCost(label) {
  const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  const postage = num(label && label.postage);
  const extras = (Array.isArray(label && label.extraServices) ? label.extraServices : [])
    .map(x => ({ name: String((x && x.name) || '').slice(0, 80), price: num(x && x.price) }))
    .filter(x => x.name || x.price != null);
  if (postage == null && !extras.length) return null;
  const total = Math.round(((postage || 0) + extras.reduce((a, x) => a + (x.price || 0), 0)) * 100) / 100;
  return { postage, extras, total, zone: label && label.zone ? String(label.zone).slice(0, 4) : '', sku: label && label.SKU ? String(label.SKU).slice(0, 40) : '' };
}

// POST /usps/prod-payment-check — prueba GRATIS si producción está lista para comprar guías
// (16 oct): pide un OAuth de producción y una autorización de pago de producción, SIN crear
// ninguna guía. La autorización no cobra nada; lo que cobra es crear la guía (/labels), que acá
// nunca se llama. No usa ni escribe el caché de tokens. Devuelve si pasó y, si no, el error
// completo y lo que trae el token de producción (CRID, cuentas de pago), sin el token.
async function handleUspsProdPaymentCheck(env, origin) {
  const required = ['USPS_CONSUMER_KEY', 'USPS_CONSUMER_SECRET', 'USPS_CRID', 'USPS_MID', 'USPS_EPS_ACCOUNT'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) return err(`Faltan variables de USPS: ${missing.join(', ')}`, 500, origin);
  const base = 'https://apis.usps.com';
  const tr = await fetch(`${base}/oauth2/v3/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.USPS_CONSUMER_KEY, client_secret: env.USPS_CONSUMER_SECRET }),
  });
  if (!tr.ok) return ok({ ok: false, paso: 'oauth', error: `(${tr.status}) ${(await tr.text()).slice(0, 800)}` }, origin);
  const token = (await tr.json()).access_token;
  const claims = uspsTokenClaimsSummary(token, env, 'Token de producción', 'prod');
  const pr = await fetch(`${base}/payments/v3/payment-authorization`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles: [
      { roleName: 'LABEL_OWNER', CRID: env.USPS_CRID, MID: env.USPS_MID, manifestMID: env.USPS_MANIFEST_MID || env.USPS_MID },
      { roleName: 'PAYER', CRID: env.USPS_CRID, accountType: 'EPS', accountNumber: env.USPS_EPS_ACCOUNT },
    ] }),
  });
  const text = await pr.text();
  if (!pr.ok) return ok({ ok: false, paso: 'pago', status: pr.status, error: text.slice(0, 1000), claims }, origin);
  let autorizado = false;
  try { autorizado = !!JSON.parse(text).paymentAuthorizationToken; } catch (_) {}
  return ok({ ok: autorizado, paso: 'pago', claims, eps: env.USPS_EPS_ACCOUNT }, origin);
}

// POST /usps/rate-check — cotiza en PRODUCCIÓN, sin comprar ni cobrar, cuánto costaría la guía de
// un pedido: precio COMERCIAL para nuestra cuenta EPS y RETAIL para comparar (16 oct: en TEM la
// guía salía $8.41 y Click-N-Ship cotizaba $5.65 comercial para el mismo envío). Usa la API de
// Precios (Domestic Prices v3, cuerpo igual al ejemplo oficial de USPS/api-examples): no toca
// Payments ni Labels. Pide un OAuth de producción sin caché y no toca el caché de TEM.
// Gasta ~3 llamadas (1 OAuth + 2 precios).
async function handleUspsRateCheck(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  if (!env.USPS_CONSUMER_KEY || !env.USPS_CONSUMER_SECRET) return err('Faltan las credenciales de USPS', 500, origin);
  const order = body.orderId != null ? await orderGet(env, body.orderId) : null;
  if (!order) return err('Pedido no encontrado', 404, origin);
  const cliente = order.cliente || {};
  const { pais: paisUpper } = orderCountryParts(cliente);
  if (!US_COUNTRY_VALUES.includes(paisUpper)) return err('La cotización de USPS es solo para pedidos a Estados Unidos.', 400, origin);
  const destZip = String(cliente.zip || '').trim().split('-')[0];
  if (!/^\d{5}$/.test(destZip)) return err('Al pedido le falta un ZIP válido (5 dígitos).', 400, origin);
  let fromZip = '';
  try { fromZip = String(JSON.parse(env.USPS_FROM_ADDRESS || '{}').ZIPCode || '').trim().split('-')[0]; } catch (_) {}
  if (!/^\d{5}$/.test(fromZip)) return err('USPS_FROM_ADDRESS no tiene un ZIP válido.', 500, origin);
  const weightOz = Number(body.weightOz), lengthIn = Number(body.lengthIn), widthIn = Number(body.widthIn), heightIn = Number(body.heightIn);
  if (!(weightOz > 0 && lengthIn > 0 && widthIn > 0 && heightIn > 0)) return err('Peso y las 3 dimensiones son obligatorios.', 400, origin);

  const base = 'https://apis.usps.com';
  const tr = await fetch(`${base}/oauth2/v3/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: env.USPS_CONSUMER_KEY, client_secret: env.USPS_CONSUMER_SECRET }),
  });
  if (!tr.ok) return err(`USPS OAuth (producción) falló (${tr.status}): ${(await tr.text()).slice(0, 500)}`, 502, origin);
  const token = (await tr.json()).access_token;
  const ingredients = {
    originZIPCode: fromZip, destinationZIPCode: destZip,
    weight: Math.round((weightOz / 16) * 10000) / 10000, length: lengthIn, width: widthIn, height: heightIn,
    mailClass: 'USPS_GROUND_ADVANTAGE', processingCategory: 'MACHINABLE',
    destinationEntryFacilityType: 'NONE', rateIndicator: 'SP',
    mailingDate: new Date().toISOString().slice(0, 10),
  };
  const quote = async (extra) => {
    const r = await fetch(`${base}/prices/v3/base-rates/search`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ingredients, ...extra }),
    });
    const text = await r.text();
    if (!r.ok) return { error: `(${r.status}) ${text.slice(0, 800)}` };
    let d = {}; try { d = JSON.parse(text); } catch (_) {}
    const rate = (Array.isArray(d.rates) && d.rates[0]) || {};
    const price = Number(d.totalBasePrice ?? rate.price);
    return { price: Number.isFinite(price) ? price : null, zone: rate.zone || '', sku: rate.SKU || '', description: rate.description || '', priceType: rate.priceType || '' };
  };
  // Comercial (16 oct): con nuestra EPS dio 403 "requested contract information is not
  // authorized"; se prueba primero sin datos de cuenta (precio comercial publicado) y, si
  // también falla, con cada cuenta de pago que traiga el token de producción. Cada intento
  // queda listado con su etiqueta, para ver exactamente qué acepta USPS.
  const claims = uspsTokenClaimsSummary(token, env, 'Token de producción', 'prod');
  let claimAccounts = [];
  try {
    const part = String(token || '').split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), ch => ch.charCodeAt(0))));
    claimAccounts = (Array.isArray(c.payment_accounts) ? c.payment_accounts : [])
      .map(x => (x && typeof x === 'object') ? (x.accountNumber || x.account || '') : x)
      .map(x => String(x || '').replace(/\D/g, '')).filter(Boolean).slice(0, 2);
  } catch (_) {}
  const intentos = [];
  let commercial = await quote({ priceType: 'COMMERCIAL' });
  intentos.push({ como: 'comercial sin cuenta', ...commercial });
  for (const acct of claimAccounts) {
    if (commercial.price != null) break;
    commercial = await quote({ priceType: 'COMMERCIAL', accountType: 'EPS', accountNumber: acct });
    intentos.push({ como: `comercial con EPS ${acct}`, ...commercial });
  }
  const retail = await quote({ priceType: 'RETAIL' });
  return ok({ ok: true, version: 'rate-check-3', commercial, retail, intentos, claims, ingredients }, origin);
}
// UUID determinístico (formato v4) a partir del pedido: mismo pedido → misma clave.
async function uspsIdempotencyUuid(orderId) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cacusa-usps-label:' + String(orderId))));
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// ── Dirección para USPS (12 oct, auditoría) ────────────────────────────────────
// La Labels API pide el estado en 2 letras ("FL"). El formulario de Cacusa Lovers lo
// guarda con el nombre completo ("Florida") — y de ahí sale la dirección de las cajas
// del lote —, así que se normaliza acá: nombres en inglés o español, con o sin acentos,
// o el código. Lo que no se reconozca se rechaza con un mensaje claro en vez de gastar
// una llamada (de 50 al día) en un 400 de USPS.
const US_STATE_CODES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', hawai: 'HI',
  idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', luisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', misisipi: 'MS', missouri: 'MO', misuri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', newhampshire: 'NH', nuevohampshire: 'NH',
  newjersey: 'NJ', nuevajersey: 'NJ', newmexico: 'NM', nuevomexico: 'NM', newyork: 'NY',
  nuevayork: 'NY', northcarolina: 'NC', carolinadelnorte: 'NC', northdakota: 'ND',
  dakotadelnorte: 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  pensilvania: 'PA', rhodeisland: 'RI', southcarolina: 'SC', carolinadelsur: 'SC',
  southdakota: 'SD', dakotadelsur: 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', westvirginia: 'WV', virginiaoccidental: 'WV', wisconsin: 'WI',
  wyoming: 'WY', districtofcolumbia: 'DC', distritodecolumbia: 'DC', washingtondc: 'DC',
  puertorico: 'PR', guam: 'GU', virginislands: 'VI', islasvirgenes: 'VI', americansamoa: 'AS',
};
const US_STATE_SET = new Set(Object.values(US_STATE_CODES));
function usStateCode(v) {
  const raw = String(v || '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return US_STATE_SET.has(raw.toUpperCase()) ? raw.toUpperCase() : '';
  const k = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return US_STATE_CODES[k] || '';
}
// País de un pedido: `pais`, o lo que va después de la última coma de `ciudad` — la
// tienda mandaba el país pegado a la ciudad en Zelle/WhatsApp ("Miami, US") y sin `pais`,
// así que esos pedidos nunca podían generar guía.
const US_COUNTRY_VALUES = ['USA', 'US', 'ESTADOS UNIDOS', 'UNITED STATES', 'EEUU', 'EE.UU.', 'EE UU', 'EE. UU.'];
// (Desde el 12 oct la tienda manda también `pais`, pero sigue pegándolo a la ciudad para
// que se lea igual en el panel: si coincide, se quita de la ciudad que va a USPS.)
function orderCountryParts(cliente) {
  const pais = String((cliente && cliente.pais) || '').trim().toUpperCase();
  const ciudad = String((cliente && cliente.ciudad) || '').trim();
  const m = ciudad.match(/^(.*?),\s*([^,]+)$/);
  const sufijo = m ? m[2].trim().toUpperCase() : '';
  if (pais) return { pais, ciudad: m && sufijo === pais ? m[1].trim() : ciudad };
  return m ? { pais: sufijo, ciudad: m[1].trim() } : { pais: '', ciudad };
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
  const { pais: paisUpper, ciudad: ciudadEnvio } = orderCountryParts(cliente);
  if (!US_COUNTRY_VALUES.includes(paisUpper)) {
    return err('Esta guía es solo para pedidos a Estados Unidos — para Ecuador seguí usando Servientrega a mano.', 400, origin);
  }
  if (!cliente.direccion || !ciudadEnvio || !cliente.estado || !cliente.zip) {
    return err('Al pedido le falta dirección/ciudad/estado/ZIP completos — completalo antes de generar la guía.', 400, origin);
  }
  const stateCode = usStateCode(cliente.estado);
  if (!stateCode) {
    return err(`El estado "${String(cliente.estado).slice(0, 40)}" no se reconoce como un estado de EE.UU. — corregilo con "✎ Editar dirección" (ej. FL o Florida).`, 400, origin);
  }
  const zip5 = String(cliente.zip).trim().split('-')[0];
  if (!/^\d{5}$/.test(zip5)) {
    return err(`El ZIP "${String(cliente.zip).slice(0, 20)}" no es válido (5 dígitos) — corregilo con "✎ Editar dirección".`, 400, origin);
  }
  // Pedidos de la tienda (Zelle/WhatsApp) guardan nombre y apellido juntos en `nombre`.
  let firstName = String(cliente.nombre || '').trim();
  let lastName = String(cliente.apellido || '').trim();
  if (!lastName && firstName.includes(' ')) {
    const i = firstName.lastIndexOf(' ');
    lastName = firstName.slice(i + 1);
    firstName = firstName.slice(0, i);
  }
  // Teléfono: 10 dígitos de EE.UU., o no se manda (un formato raro no debe tumbar la guía).
  const telDigits = String(cliente.telefono || '').replace(/\D/g, '');
  const phone10 = telDigits.length === 10 ? telDigits : (telDigits.length === 11 && telDigits[0] === '1' ? telDigits.slice(1) : '');

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
  // Límites de USPS: 70 lb y largo + contorno ≤ 108 in (largo = lado mayor).
  if (weightOz > 70 * 16) return err('El paquete supera el peso máximo de USPS (70 lb).', 400, origin);
  const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  if (dims[0] + 2 * (dims[1] + dims[2]) > 108) {
    return err('El paquete supera el tamaño máximo de USPS (largo + contorno ≤ 108 in).', 400, origin);
  }
  // Nunca comprar una 2da guía por accidente: solo con reprint explícito.
  const isReprint = body.reprint === true;
  if (order.tracking && !isReprint) {
    return err('Este pedido ya tiene guía/tracking. Para generar otra, confirmá la reimpresión.', 409, origin);
  }

  try {
    const label = await uspsWithTokens(env, true, (oauthToken, paymentToken) => uspsCreateLabel(env, {
      oauthToken, paymentToken, weightOz, lengthIn, widthIn, heightIn,
      // Reimpresión con idempotency key propia (si no USPS devolvería la guía vieja).
      orderId: isReprint && order.tracking ? `${order.id}-r${(Number(order.labelReprints) || 0) + 1}` : order.id,
      toAddress: {
        firstName,
        lastName: lastName || undefined,
        streetAddress: cliente.direccion,
        secondaryAddress: cliente.apto || undefined,
        city: ciudadEnvio,
        state: stateCode,
        ZIPCode: zip5,
        phone: phone10 || undefined,
      },
    }));
    // 16 oct: en TEM (pruebas) USPS devuelve una guía "SAMPLE - DO NOT MAIL" con un tracking
    // que no existe. Antes se guardaba en el pedido y se le mandaba a la clienta el correo de
    // "tu pedido fue enviado" con ese número (pasó con [clienta]). Ahora solo se devuelve
    // el PDF para revisarlo: no toca el pedido, no cuenta para la recolección, no manda correo.
    // Desglose de lo que cobra USPS (16 oct): franqueo, cada servicio extra con su precio y la
    // zona — para comparar con Click-N-Ship y ver si el seguro se cobra aparte.
    const costo = uspsLabelCost(label);
    if (env.USPS_ENV !== 'prod') {
      return ok({ ok: true, test: true, tracking: label.trackingNumber || '', labelBase64: label.labelImage || '', labelFormat: 'PDF', costo }, origin);
    }
    const wasReprint = isReprint && !!order.tracking;
    const prevTracking = order.tracking || '';
    order.tracking = label.trackingNumber || '';
    order.carrier = 'USPS';
    // El PDF va en su propia key (label:<id>), nunca dentro de order:/orders_cache.
    const labelBase64 = label.labelImage || '';
    await env.CACUSA_KV.put(labelKey(order.id), labelBase64);
    delete order.labelBase64;
    order.labelStored = true;
    order.labelFormat = 'PDF';
    if (wasReprint) order.labelReprints = (Number(order.labelReprints) || 0) + 1;
    // Necesarios para que handleUspsSchedulePickup() sepa cuántas guías se generaron
    // HOY y cuánto pesan en total, sin tener que adivinar ni volver a leer nada más.
    order.labelGeneratedAt = new Date().toISOString();
    order.labelWeightOz = weightOz;
    order.labelEnv = 'prod';
    if (costo) order.labelCost = costo;
    await env.CACUSA_KV.put(orderKey(order.id), JSON.stringify(order));
    if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
    // En reimpresión solo se avisa a la clienta si cambió el número de guía.
    if (ctx && (!wasReprint || order.tracking !== prevTracking)) ctx.waitUntil(sendShippingConfirmationEmail(order, env).catch(e => console.error('email de tracking falló:', e.message)));
    return ok({ ok: true, tracking: order.tracking, labelBase64, labelFormat: order.labelFormat, labelStored: true, costo }, origin);
  } catch (e) {
    console.error('USPS label falló:', e.message);
    return err('No se pudo generar la guía: ' + e.message, 502, origin);
  }
}

// PDF de la guía de UN pedido (label:<id>; fallback a pedidos viejos con el PDF inline).
async function handleOrderLabelGet(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.orderId;
  if (id == null) return err('Falta orderId', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);
  const labelBase64 = (await env.CACUSA_KV.get(labelKey(order.id))) || order.labelBase64 || '';
  if (!labelBase64) return err('Este pedido no tiene guía guardada', 404, origin);
  return ok({ ok: true, orderId: order.id, tracking: order.tracking || '', labelBase64, labelFormat: order.labelFormat || 'PDF' }, origin);
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
  if (!r.ok) throw uspsError(`USPS pickup falló (${r.status}): ${(await r.text()).slice(0, 300)}`, r.status);
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
    const pickup = await uspsWithTokens(env, false, (oauthToken) =>
      uspsSchedulePickup(env, oauthToken, { fromAddress, packageCount, estimatedWeight, pickupDate: today }));
    const result = { confirmationNumber: pickup.confirmationNumber, pickupDate: pickup.pickupDate, packageCount };
    await env.CACUSA_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 172800 });
    return ok({ ok: true, alreadyRequested: false, ...result }, origin);
  } catch (e) {
    console.error('USPS schedule pickup falló:', e.message);
    return err('No se pudo pedir la recolección: ' + e.message, 502, origin);
  }
}

// ── Pedidos de Cacusa Lovers: adoptar/completar los del sistema anterior (12 oct) ─────
// Hasta el 11 oct el pedido de envío nacía al llegar CADA pago. Si el sistema no
// encontraba la ficha (bug de los duplicados), creaba una ficha nueva con los datos de
// Square y generaba el pedido con eso: sin dirección ni teléfono ("." bajo el nombre). Esos
// pedidos viejos quedaban sin completar y el lote, al verlos, no creaba el suyo (o, en las
// anuales, creaba uno aparte = duplicado). Acá se adoptan: el pedido viejo pasa a ser el
// del ciclo, con la dirección de la ficha. Siempre por ids (lovershipinvoice:<factura> →
// pedido, loverslote:<mes>:<llave> → pedido), nunca adivinando por nombre.
const LOVERS_PLACEHOLDER_RE = /pendiente de elegir piezas del ciclo/i;
const LOVERS_FILL_FIELDS = ['nombre', 'apellido', 'telefono', 'direccion', 'apto', 'ciudad', 'estado', 'zip', 'pais', 'email'];
// Los pedidos viejos del ciclo `lote` (YYYY-MM) son los creados desde el día 11 del mes
// anterior (corte del lote) en adelante: así el pedido de septiembre de una anual (su primera
// caja) nunca se confunde con el de octubre.
function loversCicloDesde(lote) {
  const [y, m] = lote.split('-').map(Number);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-11`;
}
function loversLoteNota(lote, plan) {
  return `Lote Lovers ${lote} — ${plan || 'Cacusa Lovers'} · sale la 3ra semana (15–21) · elegir 2 piezas`;
}
// Pedido del sistema anterior: de Lovers, sin lote y con la nota de marcador.
function isLegacyLoversOrder(o) {
  return !!o && o.pago === 'Lovers' && !o.lote && LOVERS_PLACEHOLDER_RE.test(String(o.notas || ''));
}
// Aún sin trabajar: nuevo, sin guía ni tracking y sin piezas elegidas.
function isUntouchedLoversOrder(o) {
  return !!o && (o.estado || 'Nuevo') === 'Nuevo' && !o.tracking && !o.labelStored && !o.labelBase64
    && !(Array.isArray(o.productos) && o.productos.length);
}
// Se puede borrar sin perder nada: marcador sin tocar y que nadie editó a mano.
function isDisposableLegacyOrder(o) {
  return isLegacyLoversOrder(o) && isUntouchedLoversOrder(o) && !o.updatedBy;
}
// Completa los datos del cliente desde la ficha. overwrite=true (marcador que nadie tocó)
// pone los de la ficha; si no, solo rellena lo VACÍO — nunca pisa lo que alguien editó.
function mergeFichaIntoOrder(o, c, { overwrite = false } = {}) {
  let changed = false;
  o.cliente = o.cliente || {};
  for (const f of LOVERS_FILL_FIELDS) {
    const v = String((c && c[f]) || '').trim();
    if (!v) continue;
    if (overwrite ? o.cliente[f] !== v : !String(o.cliente[f] || '').trim()) { o.cliente[f] = v; changed = true; }
  }
  if (c && c.idioma && (overwrite || changed) && o.cliente.idioma !== (c.idioma === 'en' ? 'en' : 'es')) {
    o.cliente.idioma = c.idioma === 'en' ? 'en' : 'es'; changed = true;
  }
  return changed;
}
function orderFullName(c) {
  const n = String((c && c.nombre) || '').trim(), a = String((c && c.apellido) || '').trim();
  if (!a || n.toLowerCase().includes(a.toLowerCase())) return n;
  return n ? `${n} ${a}` : a;
}
function cleanFichaCliente(c) {
  const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  c = c || {};
  return {
    nombre: str(c.nombre, 100), apellido: str(c.apellido, 100), telefono: str(c.telefono, 30),
    direccion: str(c.direccion, 200), apto: str(c.apto, 40), ciudad: str(c.ciudad, 100),
    estado: str(c.estado, 50), zip: str(c.zip, 20), pais: str(c.pais, 40),
    email: isValidEmail(c.email) ? String(c.email).trim().toLowerCase() : '',
    idioma: c.idioma === 'en' ? 'en' : (c.idioma === 'es' ? 'es' : ''),
  };
}
async function kvOrderIdFrom(env, key) {
  const v = await env.CACUSA_KV.get(key);
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : null;
}
// Pedidos viejos (sistema anterior) de una suscriptora, por los ids de sus facturas.
async function legacyOrdersByInvoices(env, invoiceIds, lote) {
  const desde = lote ? loversCicloDesde(lote) : '';
  const out = [];
  const seen = new Set();
  for (const inv of (Array.isArray(invoiceIds) ? invoiceIds : []).slice(0, 6)) {
    const id = String(inv || '').slice(0, 100);
    // Los ids de factura de Square traen dos puntos ("inv:0-ChC…"): sin ':' acá se
    // descartaban todos y nunca se encontraba el pedido viejo (13 oct, duplicados reales).
    if (!/^[A-Za-z0-9:_-]{1,100}$/.test(id)) continue;
    const orderId = await kvOrderIdFrom(env, 'lovershipinvoice:' + id);
    if (!orderId || seen.has(orderId)) continue;
    seen.add(orderId);
    const o = await orderGet(env, orderId);
    if (isLegacyLoversOrder(o) && (!desde || String(o.fecha || '').slice(0, 10) >= desde)) out.push(o);
  }
  return out;
}
// Convierte un pedido viejo en el del ciclo: completo, con su lote y su marca.
async function adoptLegacyLoversOrder(env, o, { lote, loteKey, plan, cliente }) {
  mergeFichaIntoOrder(o, cliente, { overwrite: !o.updatedBy });
  o.lote = lote;
  o.notas = loversLoteNota(lote, plan);
  o.updatedAt = new Date().toISOString();
  await env.CACUSA_KV.put(orderKey(o.id), JSON.stringify(o));
  await env.CACUSA_KV.put('loverslote:' + loteKey, String(o.id), { expirationTtl: 400 * 24 * 3600 });
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
  // Lote mensual (11 oct): el pedido nace del lote de envío (corte día 10, sale la
  // 3ra semana), no de cada pago — su clave de idempotencia es loteKey
  // ("<YYYY-MM>:<suscriptora>"): 1 pedido por suscriptora por lote.
  const loteKey = /^\d{4}-\d{2}:[A-Za-z0-9_@,+-]{1,128}$/.test(String(body.loteKey || '')) ? String(body.loteKey) : '';
  const lote = loteKey ? loteKey.slice(0, 7) : '';
  if (!invoiceId && !loteKey) return err('Falta squareInvoiceId o loteKey', 400, origin);

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
  const dedupeKey = loteKey ? 'loverslote:' + loteKey : 'lovershipinvoice:' + invoiceId;
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

  // Antes de crear una caja nueva: si la suscriptora ya tiene el pedido del sistema anterior
  // para este ciclo (por el id de su factura), se ADOPTA en vez de duplicar — también en las
  // anuales, que antes recibían uno nuevo además del viejo.
  if (loteKey && Array.isArray(body.invoiceIds) && body.invoiceIds.length) {
    const viejos = await legacyOrdersByInvoices(env, body.invoiceIds, lote);
    const candidatos = viejos.filter(o => isUntouchedLoversOrder(o));
    if (candidatos.length) {
      const viejo = candidatos[0];
      await adoptLegacyLoversOrder(env, viejo, {
        lote, loteKey, plan: body.plan,
        cliente: cleanFichaCliente({ ...body, email: body.email, idioma: body.idioma }),
      });
      if (claim.claimed) await orderIdemFinalize(env, dedupeKey, viejo.id).catch(() => {});
      if (ctx && body.noRefresh !== true) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
      return ok({ ok: true, orderId: viejo.id, alreadyExisted: false, adopted: true }, origin);
    }
    if (viejos.length) {
      // Ya la están trabajando (Confirmado, con guía o con piezas): ESE es el pedido del
      // ciclo. No se crea otro (sería enviarle la caja dos veces); queda la marca.
      await env.CACUSA_KV.put(dedupeKey, String(viejos[0].id), { expirationTtl: 400 * 24 * 3600 });
      if (claim.claimed) await orderIdemFinalize(env, dedupeKey, viejos[0].id).catch(() => {});
      return ok({ ok: true, orderId: viejos[0].id, alreadyExisted: true, yaTrabajado: true }, origin);
    }
  }

  const newOrder = buildOrderCore({
    cliente: {
      nombre: body.nombre, apellido: body.apellido, telefono: body.telefono,
      direccion: body.direccion, apto: body.apto, ciudad: body.ciudad,
      estado: body.estado, zip: body.zip, pais: body.pais,
      // 12 oct: con el email, al generar la guía USPS le llega a la suscriptora el correo
      // con su número de seguimiento (sendShippingConfirmationEmail), en su idioma. Esta
      // ruta no manda el correo de "pedido confirmado" (no hay compra que confirmar).
      email: isValidEmail(body.email) ? String(body.email).trim().toLowerCase() : '',
      idioma: body.idioma === 'en' ? 'en' : 'es',
    },
    productos: [],
    pago: 'Lovers',
    total: 0, subtotal: 0, envio: 0, impuesto: 0,
    notas: lote
      ? `Lote Lovers ${lote} — ${body.plan || 'Cacusa Lovers'} · sale la 3ra semana (15–21) · elegir 2 piezas`
      : `Envío ${body.plan || 'Cacusa Lovers'} — pendiente de elegir piezas del ciclo`,
  }, { strictPago: false });
  if (lote) newOrder.lote = lote;

  assignOrderId(newOrder);
  try {
    await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
    await env.CACUSA_KV.put(dedupeKey, String(newOrder.id), { expirationTtl: 400 * 24 * 3600 });
  } catch (e) {
    if (claim.claimed) await orderIdemRelease(env, dedupeKey).catch(() => {});
    return err('No se pudo guardar el pedido de envío, intentá de nuevo', 500, origin);
  }
  if (claim.claimed) await orderIdemFinalize(env, dedupeKey, newOrder.id).catch(() => {});
  // noRefresh: el lote pide un solo refresco al final (/internal/orders/refresh).
  if (ctx && body.noRefresh !== true) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  return ok({ ok: true, orderId: newOrder.id, alreadyExisted: false }, origin);
}

// POST /internal/lovers/reconcile-orders — deja UN pedido completo por suscriptora del lote:
// adopta el pedido viejo si es el único, quita el viejo si ya hay uno del lote, y completa
// los campos vacíos desde la ficha. dryRun solo informa. Ver el comentario de arriba.
async function handleLoversReconcileOrders(body, env, origin, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : '';
  if (!month) return err('Mes inválido', 400, origin);
  const dryRun = body.dryRun !== false;
  const subs = (Array.isArray(body.subs) ? body.subs : []).slice(0, 60);
  const out = { month, dryRun, adoptados: [], completados: [], borrados: [], sinResolver: [], sinDireccion: [], vacios: [] };
  let cambios = 0;
  const protegidos = new Set(); // pedidos viejos de suscriptoras a las que solo les falta la dirección
  for (const sub of subs) {
    const key = String((sub && sub.key) || '');
    if (!/^[A-Za-z0-9_@,+-]{1,128}$/.test(key)) continue;
    const cliente = cleanFichaCliente(sub.cliente);
    const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || key;
    const loteKey = `${month}:${key}`;
    const loteId = await kvOrderIdFrom(env, 'loverslote:' + loteKey);
    const loteOrder = loteId ? await orderGet(env, loteId) : null;
    const legacy = (await legacyOrdersByInvoices(env, sub.invoiceIds, month)).filter(o => !loteOrder || o.id !== loteOrder.id);
    if (!loteOrder && !legacy.length) continue;
    if (!cliente.direccion && !(loteOrder && loteOrder.cliente && loteOrder.cliente.direccion)) {
      if (legacy.length || loteOrder) out.sinDireccion.push({ id: key, nombre });
      legacy.forEach(o => protegidos.add(o.id));
      continue;
    }
    let ciclo = loteOrder;
    if (!ciclo) {
      // Solo está el viejo: se adopta el primero que no se haya trabajado.
      const adoptable = legacy.find(o => isUntouchedLoversOrder(o));
      if (adoptable) {
        out.adoptados.push({ id: key, nombre, orden: adoptable.id });
        if (!dryRun) {
          await adoptLegacyLoversOrder(env, adoptable, { lote: month, loteKey, plan: sub.plan, cliente });
          cambios++;
        }
        ciclo = adoptable;
        legacy.splice(legacy.indexOf(adoptable), 1);
      }
    } else {
      // Pedido del lote existente: se le rellenan los campos vacíos desde la ficha
      // (solo lo vacío, nunca pisa lo editado a mano — vale aunque ya lo estén trabajando).
      const copia = JSON.parse(JSON.stringify(ciclo));
      if (mergeFichaIntoOrder(copia, cliente, { overwrite: false })) {
        out.completados.push({ id: key, nombre, orden: ciclo.id });
        if (!dryRun) {
          copia.updatedAt = new Date().toISOString();
          await env.CACUSA_KV.put(orderKey(copia.id), JSON.stringify(copia));
          cambios++;
        }
      }
    }
    // Los demás pedidos viejos del mismo ciclo son duplicados: se quitan los que nadie tocó.
    if (ciclo) {
      for (const v of legacy) {
        if (isDisposableLegacyOrder(v)) {
          out.borrados.push({ id: key, nombre, orden: v.id });
          if (!dryRun) {
            await env.CACUSA_KV.delete(orderKey(v.id));
            if (v.labelStored) await env.CACUSA_KV.delete(labelKey(v.id)).catch(() => {});
            cambios++;
          }
        } else {
          out.sinResolver.push({ id: key, nombre, orden: v.id });
        }
      }
    }
  }
  // Pedidos viejos TOTALMENTE vacíos que no se pudieron ligar a nadie (sin dirección, teléfono ni
  // correo; sin tocar y sin editar) — no se pueden enviar. Se listan y solo se borran si la
  // usuaria lo pide (limpiar:true), nunca solos. Se protegen los de suscriptoras a las que solo
  // les falta la dirección (su pedido sirve de recordatorio hasta que la completen).
  if (body.vacios === true) {
    const vacio = o => isDisposableLegacyOrder(o) && !protegidos.has(o.id)
      && !String(o.cliente?.direccion || '').trim() && !String(o.cliente?.telefono || '').trim() && !String(o.cliente?.email || '').trim();
    for (const o of await kvGetAllJson(env, 'order:')) {
      if (!vacio(o)) continue;
      out.vacios.push({ orden: o.id, nombre: orderFullName(o.cliente) || 'Cliente', fecha: String(o.fecha || '').slice(0, 10) });
      if (!dryRun && body.limpiar === true) {
        await env.CACUSA_KV.delete(orderKey(o.id));
        cambios++;
      }
    }
  }
  if (!dryRun && cambios > 0) {
    if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
    else await refreshOrdersCache(env).catch(() => {});
  }
  return ok({ ok: true, ...out }, origin);
}

// ── Marketing por correo (13 oct) ──────────────────────────────────────────────────
// Campañas desde la pestaña "✉ Marketing" del panel a: registros del popup del 10%
// (lead:*, sin los de carrito abandonado) y suscriptoras de Cacusa Lovers (Firebase, vía
// cacusa-lovers-webhook /internal/lovers/marketing-list). Sale por el MISMO Gmail de los
// correos de pedidos, así que:
//  - tandas de MKT_BATCH (plan Free: ~50 subpeticiones por invocación) que el panel pide
//    una tras otra (/marketing/send-batch); el progreso queda en mktcamp:<id> y se puede
//    retomar con el panel cerrado y vuelto a abrir;
//  - tope diario MKT_DAILY_CAP (Gmail permite ~500/día; el resto queda para los correos de
//    pedidos, que nunca deben quedarse sin cupo);
//  - cada tanda se reclama en la DO OrderIdempotency (mktbatch:<id>:<desde>) antes de
//    mandar: dos pestañas abiertas (o una lectura vieja de KV) nunca mandan la misma tanda
//    dos veces.
// Cada correo lleva link de baja firmado (HMAC, /m/baja, también como List-Unsubscribe
// one-click) y la dirección postal del negocio (MKT_POSTAL_ADDRESS, exigida por CAN-SPAM;
// variable de Cloudflare, nunca escrita en este archivo público). Sin esa variable no se
// puede crear una campaña real (sí la vista previa y la prueba).
const MKT_BATCH = 20;
const MKT_DAILY_CAP = 400;
const MKT_MAX_RECIPIENTS = 1500;
const MKT_SITE = 'https://cacusabytaitus.com';
const MKT_ERRORES_MAX = 50;

function escAttr(v) { return esc(v).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// Solo https, sin usuario/clave embebidos. Vacío si no sirve.
function mktUrl(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : '';
  } catch { return ''; }
}
function mktCleanVersion(c) {
  const s = (v, n) => typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, n) : '';
  c = c && typeof c === 'object' ? c : {};
  const out = {
    subject: s(c.subject, 150).replace(/\s*\n\s*/g, ' '),
    preheader: s(c.preheader, 200).replace(/\s*\n\s*/g, ' '),
    title: s(c.title, 150),
    body: s(c.body, 5000),
    imageUrl: mktUrl(c.imageUrl),
    ctaText: s(c.ctaText, 60).replace(/\s*\n\s*/g, ' '),
    ctaUrl: mktUrl(c.ctaUrl),
  };
  if (!out.ctaUrl || !out.ctaText) { out.ctaUrl = ''; out.ctaText = ''; }
  return out;
}
// Valida lo que manda el panel. errores: lista en español para mostrar tal cual.
function mktCleanContent(body) {
  const errores = [];
  const check = (raw, v, sufijo) => {
    raw = raw && typeof raw === 'object' ? raw : {};
    if (!v.subject) errores.push('Falta el asunto' + sufijo);
    if (!v.title && !v.body) errores.push('Falta el título o el texto' + sufijo);
    if (String(raw.imageUrl || '').trim() && !v.imageUrl) errores.push('La imagen debe ser un link que empiece con https://' + sufijo);
    if (String(raw.ctaText || '').trim() && !v.ctaUrl) errores.push('El link del botón debe empezar con https://' + sufijo);
  };
  const es = mktCleanVersion(body.es);
  check(body.es, es, '');
  let en = null;
  if (body.en && typeof body.en === 'object') { en = mktCleanVersion(body.en); check(body.en, en, ' (inglés)'); }
  const productIds = [...new Set((Array.isArray(body.productIds) ? body.productIds : [])
    .map(x => String(x)).filter(id => /^[A-Za-z0-9_-]{1,40}$/.test(id)))].slice(0, 4);
  return { es, en, productIds, errores };
}

// Misma lógica de slug que _slugify/_productParam (ui_kits/store/app.js) y
// slugify/product_param (generate_product_schema.py) — deben coincidir siempre.
function mktSlugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function mktProductParam(p, lang) {
  const name = String(((lang === 'en' && p.name_en) ? p.name_en : p.name) || '').replace(/\s+/g, ' ').trim();
  const slug = mktSlugify(name);
  return (slug ? slug + '-' : '') + p.id;
}
// Las tarjetas de producto se arman en el servidor desde data/products.json (nunca con
// links/fotos que mande el panel): nombre, precio, foto y link a la página del producto.
async function mktResolveProducts(env, ids) {
  if (!ids || !ids.length) return [];
  const f = await ghGetContent(PRODUCTS_PATH, env);
  let data = null;
  try { data = f ? JSON.parse(f.text) : null; } catch (_) { data = null; }
  const byId = new Map(((data && data.products) || []).map(p => [String(p.id), p]));
  return ids.map(id => byId.get(String(id))).filter(Boolean).map(p => {
    const imgs = (Array.isArray(p.images) ? p.images : []).concat(p.imageUrl ? [p.imageUrl] : []);
    const image = imgs.map(x => mktUrl(typeof x === 'string' ? x : (x && x.url))).find(Boolean) || '';
    const price = Number(p.price);
    return {
      id: String(p.id),
      name: String(p.name || '').slice(0, 120),
      name_en: String(p.name_en || '').slice(0, 120),
      price: Number.isFinite(price) && price > 0 ? price : null,
      image,
      urlEs: `${MKT_SITE}/ui_kits/store/producto/${encodeURIComponent(mktProductParam(p, 'es'))}/`,
      urlEn: `${MKT_SITE}/en/ui_kits/store/producto/${encodeURIComponent(mktProductParam(p, 'en'))}/`,
    };
  });
}

function mktParagraphs(text) {
  return String(text || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
    .map(t => `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#6B3A55;text-align:left;">${esc(t).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
function mktProductsHtml(products, lang) {
  if (!products || !products.length) return '';
  const cell = p => {
    const url = escAttr(lang === 'en' ? p.urlEn : p.urlEs);
    const name = esc(lang === 'en' && p.name_en ? p.name_en : p.name);
    const img = p.image ? `<a href="${url}"><img src="${escAttr(p.image)}" alt="${escAttr(lang === 'en' && p.name_en ? p.name_en : p.name)}" width="190" style="display:block;width:100%;max-width:190px;height:auto;border-radius:12px;margin:0 auto 8px;border:0;"></a>` : '';
    const price = p.price != null ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#C0336E;">$${esc(p.price % 1 ? p.price.toFixed(2) : String(p.price))}</div>` : '';
    return `<td width="50%" valign="top" style="padding:8px;text-align:center;">${img}<a href="${url}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8B2A5A;text-decoration:none;font-weight:600;">${name}</a>${price}</td>`;
  };
  let rows = '';
  for (let i = 0; i < products.length; i += 2) {
    rows += `<tr>${cell(products[i])}${products[i + 1] ? cell(products[i + 1]) : '<td width="50%"></td>'}</tr>`;
  }
  const head = lang === 'en' ? 'You might love' : 'Te pueden encantar';
  return `<div style="font-family:Georgia,'Bodoni Moda',serif;font-size:16px;font-weight:700;color:#8B2A5A;margin:10px 0 4px;">${head}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">${rows}</table>`;
}
async function mktUnsubToken(email, env) { return hmac('mktbaja:' + email, env.SESSION_SECRET); }
async function mktUnsubUrl(email, env, base) {
  return `${base}/m/baja?e=${encodeURIComponent(email)}&t=${await mktUnsubToken(email, env)}`;
}
// v: versión ya limpia (mktCleanVersion). Todo texto pasa por esc()/escAttr().
function marketingEmailHtml(v, products, lang, { unsubUrl, postal }) {
  const en = lang === 'en';
  const image = v.imageUrl ? `<img src="${escAttr(v.imageUrl)}" alt="" width="420" style="display:block;width:100%;max-width:420px;height:auto;border-radius:12px;margin:0 auto 18px;border:0;">` : '';
  const legal = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#A07090;margin-top:12px;">${en
    ? 'You are receiving this email because you signed up at cacusabytaitus.com.'
    : 'Recibes este correo porque te registraste en cacusabytaitus.com.'}<br><a href="${escAttr(unsubUrl)}" style="color:#C0336E;">${en ? 'Unsubscribe' : 'Darme de baja'}</a> · <a href="${MKT_SITE}/privacidad.html" style="color:#C0336E;">${en ? 'Privacy policy' : 'Política de privacidad'}</a>${postal ? `<br>CACUSA by Taitus · ${esc(postal)}` : ''}</div>`;
  return emailShellGeneric({
    lang,
    preheader: esc(v.preheader),
    eyebrow: en ? 'CACUSA news' : 'Novedades CACUSA',
    title: esc(v.title),
    bodyHtml: image + mktParagraphs(v.body) + mktProductsHtml(products, lang),
    ctaText: esc(v.ctaText),
    ctaUrl: v.ctaUrl ? escAttr(v.ctaUrl) : '',
    footerExtraHtml: legal,
    waText: en ? 'Hi! I have a question about CACUSA by Taitus.' : 'Hola, tengo una consulta sobre CACUSA by Taitus.',
  });
}
// Idioma de cada persona: la versión EN si existe; si no, TODO en español (texto y pie) —
// nunca un correo con el texto en español y los botones/pie en inglés.
function mktVersionFor(content, lang) {
  return lang === 'en' && content.en ? { v: content.en, lang: 'en' } : { v: content.es, lang: 'es' };
}

// Audiencia: sel = { leads: bool, lovers: ['activas','pausadas','canceladas'] }.
// Devuelve destinatarios únicos por email, sin las que se dieron de baja.
function mktLoversGrupo(estado) {
  if (estado === 'activo') return 'activas';
  if (estado === 'cancelado' || estado === 'pendiente') return 'canceladas';
  return 'pausadas'; // pausado, vencido, pago_fallido
}
async function mktAudience(env, sel) {
  sel = sel && typeof sel === 'object' ? sel : {};
  const grupos = new Set((Array.isArray(sel.lovers) ? sel.lovers : []).filter(g => ['activas', 'pausadas', 'canceladas'].includes(g)));
  const byEmail = new Map();
  const conteo = { landing: 0, lovers: 0, enAmbas: 0, bajas: 0 };
  if (sel.leads === true) {
    for (const l of await listAllLeads(env)) {
      if (!l || l.source === 'cart_checkout_start') continue;
      const e = String(l.email || '').trim().toLowerCase();
      if (!isValidEmail(e) || byEmail.has(e)) continue;
      byEmail.set(e, { e, l: l.lang === 'en' ? 'en' : 'es' });
      conteo.landing++;
    }
  }
  if (grupos.size) {
    if (!env.ORDER_INGEST_KEY) throw new Error('Falta ORDER_INGEST_KEY para leer las suscriptoras de Lovers');
    const r = await loversFetch(env, '/internal/lovers/marketing-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: '{}',
    });
    if (!r.ok) throw new Error(`No se pudo leer las suscriptoras de Lovers (${r.status})`);
    const d = await r.json();
    for (const s of (Array.isArray(d.subs) ? d.subs : [])) {
      if (!s || !grupos.has(mktLoversGrupo(s.estado))) continue;
      const e = String(s.email || '').trim().toLowerCase();
      if (!isValidEmail(e)) continue;
      const prev = byEmail.get(e);
      // El idioma de la ficha de Lovers es más confiable que el del popup.
      if (prev) { prev.l = s.idioma === 'en' ? 'en' : 'es'; conteo.enAmbas++; continue; }
      byEmail.set(e, { e, l: s.idioma === 'en' ? 'en' : 'es' });
      conteo.lovers++;
    }
  }
  const all = [...byEmail.values()];
  const bajas = await kvGetMany(env, all.map(x => 'mktunsub:' + x.e));
  const recipients = all.filter(x => !bajas.get('mktunsub:' + x.e));
  conteo.bajas = all.length - recipients.length;
  return { recipients, conteo };
}

function mktDayKey() { return 'mktsent:' + new Date().toISOString().slice(0, 10); }
async function mktSentToday(env) { return Number(await env.CACUSA_KV.get(mktDayKey())) || 0; }
async function mktAddSent(env, n) {
  if (n <= 0) return;
  await env.CACUSA_KV.put(mktDayKey(), String((await mktSentToday(env)) + n), { expirationTtl: 3 * 24 * 3600 });
}
function mktSummary(c) {
  return {
    id: c.id, createdAt: c.createdAt, createdBy: c.createdBy, updatedAt: c.updatedAt || c.createdAt,
    subject: c.content && c.content.es ? c.content.es.subject : '',
    total: (c.recipients || []).length, next: c.next || 0, sent: c.sent || 0, skipped: c.skipped || 0,
    done: !!c.done, errores: (c.errores || []).length, audiencia: c.audiencia || null,
  };
}

async function handleMktAudience(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  let aud;
  try { aud = await mktAudience(env, body.audiencia); } catch (e) { return err(e.message, 502, origin); }
  const { recipients, conteo } = aud;
  return ok({
    ok: true, total: recipients.length, conteo,
    enviadosHoy: await mktSentToday(env), topeDiario: MKT_DAILY_CAP,
    direccionPostal: !!String(env.MKT_POSTAL_ADDRESS || '').trim(),
  }, origin);
}
async function handleMktPreview(body, env, origin, base) {
  const c = mktCleanContent(body);
  const products = await mktResolveProducts(env, c.productIds);
  const lang = body.lang === 'en' ? 'en' : 'es';
  const { v, lang: l } = mktVersionFor(c, lang);
  const html = marketingEmailHtml(v, products, l, {
    unsubUrl: `${base}/m/baja?e=ejemplo%40correo.com&t=vista-previa`,
    postal: String(env.MKT_POSTAL_ADDRESS || '').trim() || (l === 'en' ? '[business mailing address]' : '[dirección postal del negocio]'),
  });
  return ok({ ok: true, html, subject: v.subject, errores: c.errores, productos: products.length }, origin);
}
async function handleMktTest(body, env, origin, base) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const to = String(body.to || '').trim().toLowerCase().slice(0, 100);
  if (!isValidEmail(to)) return err('Escribe un correo válido para la prueba', 400, origin);
  const c = mktCleanContent(body);
  if (c.errores.length) return err(c.errores.join(' · '), 400, origin);
  if ((await mktSentToday(env)) >= MKT_DAILY_CAP) return err('Se llegó al tope de correos de marketing de hoy. Prueba mañana.', 429, origin);
  const products = await mktResolveProducts(env, c.productIds);
  const { v, lang } = mktVersionFor(c, body.lang === 'en' ? 'en' : 'es');
  const unsubUrl = await mktUnsubUrl(to, env, base);
  try {
    await sendGmail(env, {
      to, subject: '[PRUEBA] ' + v.subject,
      html: marketingEmailHtml(v, products, lang, { unsubUrl, postal: String(env.MKT_POSTAL_ADDRESS || '').trim() }),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  } catch (e) {
    return err('No se pudo enviar la prueba: ' + String(e && e.message || e).slice(0, 200), 502, origin);
  }
  await mktAddSent(env, 1);
  return ok({ ok: true }, origin);
}
async function handleMktCampaignCreate(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  if (!String(env.MKT_POSTAL_ADDRESS || '').trim()) {
    return err('Falta la dirección postal del negocio (variable MKT_POSTAL_ADDRESS en Cloudflare → cacusa-admin). La ley de EE.UU. la exige en los correos de promoción.', 400, origin);
  }
  const c = mktCleanContent(body);
  if (c.errores.length) return err(c.errores.join(' · '), 400, origin);
  let aud;
  try { aud = await mktAudience(env, body.audiencia); } catch (e) { return err(e.message, 502, origin); }
  const { recipients, conteo } = aud;
  if (!recipients.length) return err('No hay nadie a quien mandarle con esa selección', 400, origin);
  if (recipients.length > MKT_MAX_RECIPIENTS) return err(`Son ${recipients.length} personas; el máximo por campaña es ${MKT_MAX_RECIPIENTS}`, 400, origin);
  const products = await mktResolveProducts(env, c.productIds);
  const id = Date.now().toString(36) + b64url(crypto.getRandomValues(new Uint8Array(4)));
  const camp = {
    id, createdAt: new Date().toISOString(), createdBy: session.user,
    content: { es: c.es, en: c.en }, products,
    audiencia: { leads: body.audiencia && body.audiencia.leads === true, lovers: (body.audiencia && Array.isArray(body.audiencia.lovers)) ? body.audiencia.lovers.slice(0, 3) : [], conteo },
    recipients, next: 0, sent: 0, skipped: 0, errores: [], done: false,
  };
  await env.CACUSA_KV.put('mktcamp:' + id, JSON.stringify(camp));
  return ok({ ok: true, campaign: mktSummary(camp) }, origin);
}
async function handleMktSendBatch(body, env, origin, base) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return err('Campaña inválida', 400, origin);
  const key = 'mktcamp:' + id;
  const raw = await env.CACUSA_KV.get(key);
  if (!raw) return err('Campaña no encontrada', 404, origin);
  const camp = JSON.parse(raw);
  const total = camp.recipients.length;
  if (camp.done || camp.next >= total) return ok({ ok: true, campaign: mktSummary(camp) }, origin);
  const postal = String(env.MKT_POSTAL_ADDRESS || '').trim();
  if (!postal) return err('Falta MKT_POSTAL_ADDRESS en Cloudflare → cacusa-admin', 400, origin);

  const desde = camp.next;
  const claimKey = `mktbatch:${id}:${desde}`;
  const claim = await orderIdemClaim(env, claimKey);
  // Otra pestaña ya está mandando (o ya mandó) esta tanda: no se repite. El panel espera y
  // vuelve a pedir; para entonces mktcamp:<id> ya tiene el progreso nuevo.
  if (!claim.claimed) return ok({ ok: true, ocupado: true, campaign: mktSummary(camp) }, origin);

  let advanced = false;
  try {
    const usados = await mktSentToday(env);
    const cupo = MKT_DAILY_CAP - usados;
    if (cupo <= 0) return ok({ ok: true, topeDiario: true, campaign: mktSummary(camp) }, origin);
    const lote = camp.recipients.slice(desde, desde + Math.min(MKT_BATCH, cupo));
    // Alguien pudo darse de baja con la campaña ya en curso: se revisa justo antes de mandar.
    const bajas = await kvGetMany(env, lote.map(x => 'mktunsub:' + x.e));
    let accessToken;
    try { accessToken = await gmailAccessToken(env); }
    catch (e) { return err('No se pudo conectar con Gmail: ' + String(e && e.message || e).slice(0, 200), 502, origin); }
    let enviados = 0, i = 0, frenar = '';
    for (; i < lote.length; i++) {
      const r = lote[i];
      if (bajas.get('mktunsub:' + r.e)) { camp.skipped = (camp.skipped || 0) + 1; continue; }
      const { v, lang } = mktVersionFor(camp.content, r.l);
      const unsubUrl = await mktUnsubUrl(r.e, env, base);
      try {
        await sendGmail(env, {
          to: r.e, subject: v.subject, accessToken,
          html: marketingEmailHtml(v, camp.products || [], lang, { unsubUrl, postal }),
          headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        });
        enviados++;
      } catch (e) {
        const msg = String(e && e.message || e).slice(0, 200);
        // Límite de Gmail o credenciales caídas: se frena la tanda SIN avanzar a esta
        // persona, para reintentarla después. Cualquier otro error (dirección rechazada,
        // etc.) se anota y se sigue con la siguiente.
        if (/\((429|401|403)\)|token refresh/i.test(msg)) { frenar = msg; break; }
        if ((camp.errores || []).length < MKT_ERRORES_MAX) (camp.errores = camp.errores || []).push({ e: r.e, msg });
      }
    }
    camp.next = desde + i;
    camp.sent = (camp.sent || 0) + enviados;
    camp.done = camp.next >= total;
    camp.updatedAt = new Date().toISOString();
    advanced = camp.next > desde;
    if (advanced) await env.CACUSA_KV.put(key, JSON.stringify(camp));
    await mktAddSent(env, enviados);
    return ok({ ok: true, enviadosLote: enviados, frenado: frenar || undefined, topeDiario: usados + enviados >= MKT_DAILY_CAP, campaign: mktSummary(camp) }, origin);
  } finally {
    // Avanzó: la tanda queda marcada como hecha (la próxima arranca en otro índice). No
    // avanzó (tope, Gmail caído o error): se libera para poder reintentarla.
    if (advanced) await orderIdemFinalize(env, claimKey, camp.next).catch(() => {});
    else await orderIdemRelease(env, claimKey).catch(() => {});
  }
}
async function handleMktCampaigns(env, origin) {
  if (!env.CACUSA_KV) return ok({ campaigns: [] }, origin);
  const list = (await kvGetAllJson(env, 'mktcamp:')).map(mktSummary)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30);
  return ok({ ok: true, campaigns: list, enviadosHoy: await mktSentToday(env), topeDiario: MKT_DAILY_CAP }, origin);
}

// GET/POST /m/baja?e=<email>&t=<hmac> — pública, sin sesión (es el link del pie del correo).
// GET muestra un botón (los antivirus de correo abren los links solos: un GET nunca da de
// baja). POST da de baja: lo manda ese botón o Gmail ("List-Unsubscribe-Post" one-click).
// Solo escribe si la persona no estaba ya de baja (no se pueden gastar escrituras de KV
// repitiendo el mismo link).
async function handleMktUnsub(request, env) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get('e') || '').trim().toLowerCase().slice(0, 100);
  const t = String(url.searchParams.get('t') || '').slice(0, 200);
  const valido = isValidEmail(email) && !!env.SESSION_SECRET && safeEqual(t, await mktUnsubToken(email, env));
  const page = (status, titulo, texto, form = '') => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>CACUSA by Taitus</title></head>
<body style="margin:0;background:#FEF8FF;font-family:Arial,Helvetica,sans-serif;color:#8B2A5A;">
<main style="max-width:440px;margin:60px auto;padding:32px 26px;background:#fff;border-radius:18px;border:1px solid #F3E4EE;text-align:center;">
<div style="font-family:Georgia,serif;font-size:24px;font-weight:700;letter-spacing:.12em;">CACUSA</div>
<div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:#96486F;margin-bottom:22px;">by Taitus</div>
<h1 style="font-family:Georgia,serif;font-size:20px;margin:0 0 12px;">${titulo}</h1>
<p style="font-size:14px;line-height:1.6;color:#96486F;margin:0;">${texto}</p>${form}
<p style="margin:26px 0 0;"><a href="${MKT_SITE}" style="color:#C0336E;font-size:13px;">cacusabytaitus.com</a></p>
</main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    },
  });
  if (!valido || !env.CACUSA_KV) {
    return page(400, 'Link no válido · Invalid link', 'Este link de baja no es válido. Escríbenos por WhatsApp y te damos de baja a mano.<br>This unsubscribe link is not valid. Message us on WhatsApp and we will remove you.');
  }
  const k = 'mktunsub:' + email;
  const ya = await env.CACUSA_KV.get(k);
  if (request.method === 'POST') {
    if (!ya) await env.CACUSA_KV.put(k, new Date().toISOString());
    return page(200, 'Listo · Done', `${esc(email)} ya no recibirá correos de promociones. Los correos de tus pedidos siguen llegando normal.<br><br>${esc(email)} will no longer receive promotional emails. Order emails will still arrive as usual.`);
  }
  if (ya) return page(200, 'Ya estás de baja · Already unsubscribed', `${esc(email)} ya no recibe correos de promociones.<br>${esc(email)} no longer receives promotional emails.`);
  return page(200, '¿Darte de baja? · Unsubscribe?',
    `Dejarás de recibir correos de promociones en <strong>${esc(email)}</strong>.<br>You will stop receiving promotional emails at <strong>${esc(email)}</strong>.`,
    `<form method="POST" action="${escAttr(url.pathname + url.search)}" style="margin-top:22px;"><button type="submit" style="background:#C0336E;color:#fff;border:0;border-radius:999px;padding:13px 28px;font-size:14px;font-weight:700;cursor:pointer;">Darme de baja · Unsubscribe</button></form>`);
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
// El rpId sigue siendo el dominio registrable: las passkeys existentes sirven desde el subdominio.
// Auditoría (12 oct): la transición terminó (el panel vive en su subdominio desde el 26
// sep y la ruta vieja de la tienda solo redirige) — se quita el origen de la tienda, que
// carga scripts de terceros (GTM) y no tiene por qué poder iniciar sesión en el panel.
const WA_ORIGINS = ['https://admin.cacusabytaitus.com'];

// Auditoría (20 sep, F20): las 4 rutas de WebAuthn no tenían ningún tope de intentos
// por IP más allá del TTL de 300s del challenge — a diferencia de /login (loginrl:) y
// del resto de rutas públicas de este archivo. Límite generoso (30/hora): las 2
// cuentas reales rara vez inician sesión más de un puñado de veces al día.
async function waRateLimit(env, request, prefix, max = 30) {
  return rateLimit(env, 'webauthn-' + prefix, clientIp(request), max, 3600);
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
  if (!WA_ORIGINS.includes(cd.origin)) return err('origin no coincide', 400, origin);
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
      url: ADMIN_URL,
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
  if (!WA_ORIGINS.includes(cd.origin)) return err('origin no coincide', 400, origin);
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
