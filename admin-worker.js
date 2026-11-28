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
 *   USPS_ENV              (text)    'prod' = el panel puede comprar guías reales por la API
 *                                   (cobra franqueo de la cuenta EPS). Cualquier otro valor (o
 *                                   vacío) = compra de guías y recolección APAGADAS. Desde el 20
 *                                   oct no existe modo de pruebas: el Worker nunca llama a
 *                                   apis-tem (decisión del usuario; las guías van por
 *                                   Click-N-Ship y el panel solo cotiza).
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
 *   ANTHROPIC_API_KEY     (secret)  Opcional. Llave de la API de Claude (console.anthropic.com →
 *                                   API Keys) para "✦ Sugerir datos desde la foto" al crear un
 *                                   producto (/product/describe, Claude Haiku 5.5, < $0.001 por
 *                                   ficha, tope 40/día). Sin ella el panel usa sus plantillas gratis.
 *                                   La misma llave activa la segunda opinión del identificador por
 *                                   foto (/identify/rerank, solo cuando duda, ~$0.0002, tope 150/día).
 *                                   Y la traducción ES→EN de fichas (/product/translate, ~$0.0001, tope 200/día).
 *                                   Ingreso de inventario: leer la factura del proveedor (/product/invoice,
 *                                   ~$0.0007, tope 30/día) y contar unidades en una foto (/product/count,
 *                                   ~$0.0002, tope 100/día).
 *   FB_DB_SECRET          (secret)  Wave 1 (reseñas): MISMO valor que ya tienen cacusa-lovers-webhook y
 *                                   cacusa-backup. Lo usan /review/submit, /pub/reviews, /reviews/list
 *                                   y /reviews/moderate. Sin él, esas rutas responden 503 y el resto
 *                                   del Worker funciona igual.
 *   FB_DB_URL             (text)    Opcional (default https://cacusa-pos-default-rtdb.firebaseio.com).
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
 *
 * Cron Trigger (nov, opcional pero necesario para los correos automáticos): Cloudflare →
 * cacusa-admin → Settings → Triggers → Cron Triggers → Add → "7 16 * * *" (1 vez al día,
 * 11:07 en Ecuador / hora del Este en invierno). Corre runAutoEmails(): pedido de reseña
 * 3 días después de la entrega + recordatorio de carrito pendiente (24 h). No manda nada
 * mientras falte MKT_POSTAL_ADDRESS. Llaves nuevas en KV: acart:<email> (TTL 7 días),
 * cartremsent:<email> (TTL 7 días); en los pedidos: entregadoAt/entregadoFuente/reviewReqAt.
 * Wave 2: la misma corrida revisa antes en USPS hasta 10 pedidos "Enviado" (runAutoDelivered)
 * y pasa a "Entregado" los que USPS ya dio por entregados. Llave nueva: uspsautotrack:v1.
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
  // Cron Trigger de cacusa-admin (nuevo, nov) — correos automáticos a clientas: pedido de
  // reseña después de la entrega y recordatorio de carrito pendiente. Se configura a mano
  // en Cloudflare → cacusa-admin → Settings → Triggers → Cron (ver runAutoEmails()).
  // Wave 2: antes de los correos, "Entregado" automático por USPS (runAutoDelivered). Las dos
  // tareas comparten el tope de ~50 llamadas externas por ejecución: lo que gasta la primera se
  // le descuenta a la segunda (CRON_SUBREQ_TOTAL).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
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
    // Stock público para la tienda (18 nov): GET, sin sesión ni body, cacheable 60 s.
    if (path.endsWith('/pub/stock') && (request.method === 'GET' || request.method === 'POST')) {
      try { return await handlePubStock(env, allowOrigin); }
      catch (e) { console.error('pub/stock:', e.message); return err('Error del servidor', 500, allowOrigin); }
    }
    // Reseñas aprobadas para la tienda (wave 1): GET o POST, sin sesión, cacheable 300 s. Sale de
    // una copia en KV (reviews_pub) que se rehace al moderar — nunca toca Firebase por visita.
    if (path.endsWith('/pub/reviews') && (request.method === 'GET' || request.method === 'POST')) {
      try { return await handlePubReviews(env, allowOrigin); }
      catch (e) { console.error('pub/reviews:', e.message); return err('Error del servidor', 500, allowOrigin); }
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

      // Carrito pendiente para el recordatorio por correo (nov): la tienda lo manda UNA vez
      // por sesión de checkout (al salir del campo de email, con debounce) y solo si la
      // clienta marcó el permiso de recordatorio. Ver handleCartPending().
      if (path.endsWith('/cart/pending')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleCartPending(body, env, allowOrigin, request);
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

      // Reseña nueva desde la tienda (wave 1): antes el navegador escribía directo a Firebase
      // (regla pública de solo-crear). Ahora pasa por acá: Origin + rateLimit (3/h por IP y tope
      // diario global), producto validado contra el catálogo y texto saneado. Nace approved:false.
      if (path.endsWith('/review/submit')) {
        if (!ORIGIN_ALLOWLIST.includes(origin)) return err('No permitido', 403, allowOrigin);
        return await handleReviewSubmit(body, env, allowOrigin, request);
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
      // Reembolso de Square (wave 1): cacusa-square avisa cuando un pago con tarjeta se reembolsa;
      // el pedido queda "reembolsado" (total) o con reembolsoCents (parcial). Mismo guard interno.
      if (path.endsWith('/internal/order/refund')) {
        if (!isInternalIngest(request, env)) return err('No permitido', 403, allowOrigin);
        return await handleOrderRefundIngest(body, env, allowOrigin, ctx);
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
      if (path.endsWith('/order/usps-notify')) return await handleUspsNotifyRetry(body, env, allowOrigin, ctx);
      if (path.endsWith('/order/usps-status')) return await handleUspsStatus(body, env, allowOrigin);
      if (path.endsWith('/order/cns-export')) return await handleCnsExport(body, env, allowOrigin);
      if (path.endsWith('/identify/refs'))      return await handleIdentifyRefs(env, allowOrigin);
      if (path.endsWith('/identify/ref/add'))   return await handleIdentifyRefAdd(body, env, allowOrigin);
      if (path.endsWith('/identify/ref/clear')) return await handleIdentifyRefClear(body, env, allowOrigin);
      if (path.endsWith('/product/describe'))   return await handleProductDescribe(body, env, allowOrigin);
      if (path.endsWith('/identify/rerank'))    return await handleIdentifyRerank(body, env, allowOrigin);
      if (path.endsWith('/product/translate'))  return await handleProductTranslate(body, env, allowOrigin);
      if (path.endsWith('/product/invoice'))    return await handleProductInvoice(body, env, allowOrigin);
      if (path.endsWith('/product/count'))      return await handleProductCount(body, env, allowOrigin);
      if (path.endsWith('/cost/list'))          return await handleCostList(env, allowOrigin);
      if (path.endsWith('/cost/set'))           return await handleCostSet(body, env, allowOrigin, session);
      if (path.endsWith('/stock/list'))       return await handleStockList(env, allowOrigin);
      if (path.endsWith('/stock/set'))        return await handleStockSet(body, env, allowOrigin, session);
      if (path.endsWith('/stock/adjust'))     return await handleStockAdjust(body, env, allowOrigin, session);
      if (path.endsWith('/stock/history'))    return await handleStockHistory(body, env, allowOrigin);
      if (path.endsWith('/reviews/list'))     return await handleReviewsList(body, env, allowOrigin);
      if (path.endsWith('/reviews/moderate')) return await handleReviewsModerate(body, env, allowOrigin, session);
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
      // Correos automáticos (reseña + carrito): vista previa (dryRun, por defecto) o corrida a
      // mano de la misma tarea que hace el Cron Trigger. Mismo presupuesto y mismos topes.
      // Wave 2: vista previa (dryRun, por defecto) o corrida a mano del "Entregado" automático.
      if (path.endsWith('/usps/auto-delivered')) {
        if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, allowOrigin);
        return ok({ ok: true, ...(await runAutoDelivered(env, { dryRun: body.dryRun !== false })) }, allowOrigin);
      }
      if (path.endsWith('/mail-auto/run')) {
        if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, allowOrigin);
        return ok({ ok: true, ...(await runAutoEmails(env, { dryRun: body.dryRun !== false })) }, allowOrigin);
      }
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

  // productsSha (wave 1): el panel lo devuelve al publicar (baseSha) para detectar que otra
  // persona publicó entretanto — ver handleSave.
  return ok({ products: products ? products.text : null, productsSha: products ? products.sha : null, orders: ordersText }, origin);
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

  // (27 nov) El costo es privado (KV admin_costs): si un panel viejo o un error lo mete en un
  // producto, se quita antes de publicar data/products.json (público).
  let outContent = content;
  if (path === PRODUCTS_PATH && /"(cost|costCurrency)"\s*:/.test(content)) {
    try {
      const data = JSON.parse(content);
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
      let stripped = 0;
      for (const p of list) if (p && typeof p === 'object') for (const k of ['cost', 'costCurrency']) if (k in p) { delete p[k]; stripped++; }
      if (stripped) { outContent = JSON.stringify(data, null, 2); console.warn('save: se quitaron', stripped, 'campos de costo del catálogo público'); }
    } catch (_) {}
  }
  // Conflicto de publicación (wave 1): antes se leía el sha ACTUAL de GitHub y se pisaba — si
  // Tita y Robin publicaban casi a la vez, la última borraba en silencio los cambios de la otra.
  // Ahora el panel manda el sha sobre el que trabajó (baseSha): si ya no es el actual → 409 con el
  // catálogo nuevo para que el panel vuelva a aplicar sus cambios encima. Además el PUT va con
  // ESE sha, así que GitHub mismo rechaza (409/422) si alguien publica entre la lectura y el PUT.
  // Un panel viejo que no manda baseSha sigue funcionando igual que antes.
  const baseSha = typeof body.baseSha === 'string' && /^[0-9a-f]{40}$/i.test(body.baseSha) ? body.baseSha.toLowerCase() : null;
  const cur = await ghGetContent(path, env);
  const conflict = (latest) => jsonResp({
    error: 'Otra persona publicó cambios mientras editabas.', conflict: true,
    sha: latest ? latest.sha : null, products: latest ? latest.text : null,
  }, 409, origin);
  if (baseSha && cur && cur.sha !== baseSha) return conflict(cur);
  let res;
  try {
    res = await ghPut(path, b64encode(outContent), baseSha || (cur ? cur.sha : null), message || `[admin] ${session.user}`, env);
  } catch (e) {
    if (baseSha && /GitHub PUT (409|422)/.test(e.message)) return conflict(await ghGetContent(path, env).catch(() => null));
    throw e;
  }

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

// ── Estado del pago (wave 1) ─────────────────────────────────────────────────────
// pagoEstado: 'pendiente' | 'recibido' | 'reembolsado', con pagoAt (ISO) y pagoBy (cuenta del
// panel, 'square' o 'lovers'). Los pedidos viejos no lo tienen: el panel lo infiere (Tarjeta y
// Lovers = recibido; el resto = pendiente solo si sigue "Nuevo", si no recibido).
const PAGO_ESTADOS = new Set(['pendiente', 'recibido', 'reembolsado']);
function setInitialPagoEstado(order, estado, by) {
  order.pagoEstado = PAGO_ESTADOS.has(estado) ? estado : 'pendiente';
  if (order.pagoEstado === 'recibido') { order.pagoAt = order.fecha || new Date().toISOString(); order.pagoBy = String(by || '').slice(0, 40); }
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
  // Pago (wave 1): solo un pedido con tarjeta que ya confirmó el webhook de Square llega cobrado;
  // Zelle/WhatsApp/transferencia nacen "pendiente" hasta que Tita/Robin marcan "Pago recibido".
  setInitialPagoEstado(newOrder, trusted && newOrder.pago === 'Tarjeta' ? 'recibido' : 'pendiente', 'square');

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

  // Stock (18 nov): se calcula acá — después de la idempotencia (un reintento ya devolvió
  // arriba y nunca vuelve a descontar) — y se confirma solo si el pedido se guarda.
  const stockPlanNew = await stockPrepareNewOrder(env, newOrder);

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
  await stockFinishNewOrder(env, newOrder, stockPlanNew);
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  // Si esta clienta tenía un carrito marcado como abandonado, ya no lo está — compró.
  // Best-effort: nunca debe afectar la respuesta del pedido si falla.
  const orderEmailLc = (newOrder.cliente?.email || '').toLowerCase();
  if (ctx && orderEmailLc) ctx.waitUntil(removeCartLead(orderEmailLc, env).catch(() => {}));
  if (ctx && orderEmailLc) ctx.waitUntil(clearPendingCart(orderEmailLc, env).catch(() => {}));
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
  // Wave 2: forma nueva (v: 2) del modal "Nuevo pedido manual" — líneas del catálogo validadas,
  // totales recalculados acá, descuento y correo solo si se pidió. Sin v (panel viejo), igual que antes.
  if (order.v === 2) return await handleOrderManualV2(order, env, origin, session, ctx);

  const newOrder = buildOrderCore(order, { strictPago: false });
  newOrder.createdBy = session.user;
  // Pago (wave 1): un pedido manual nace "pendiente", salvo que el modal diga que ya se cobró.
  setInitialPagoEstado(newOrder, order.pagoEstado === 'recibido' ? 'recibido' : 'pendiente', session.user);

  assignOrderId(newOrder);
  if (!newOrder.numero && order.numero) newOrder.numero = String(newOrder.id);
  // Stock (18 nov): solo líneas con id del catálogo; sin ids no se consulta nada.
  const stockPlanNew = newOrder.productos.some((p) => p.id) ? await stockPrepareNewOrder(env, newOrder) : null;
  await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
  await stockFinishNewOrder(env, newOrder, stockPlanNew);
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  const orderEmailLc = (newOrder.cliente?.email || '').toLowerCase();
  if (ctx && orderEmailLc) ctx.waitUntil(removeCartLead(orderEmailLc, env).catch(() => {}));
  if (ctx && orderEmailLc) ctx.waitUntil(clearPendingCart(orderEmailLc, env).catch(() => {}));
  if (ctx) ctx.waitUntil(sendOrderConfirmationEmail(newOrder, env).catch(e => console.error('email confirmación pedido manual falló:', e.message)));

  return ok({ ok: true, order: newOrder }, origin);
}

// ── Pedido manual completo (wave 2) ─────────────────────────────────────────────────────
// order = { v: 2, cliente: {nombre, apellido, telefono, email?, idioma, pais, estado, ciudad, zip,
//   direccion, apto, notas?}, productos: [{id, qty, price} | {manual: true, name, qty, price}],
//   envio, descuento, pago, pagoEstado, notas?, notifyEmail }
// - Líneas del catálogo: el id tiene que existir en el catálogo publicado (si no, 400) y el nombre
//   sale del catálogo; precio y cantidad los decide quien carga el pedido (rebaja a mano, etc.).
// - Líneas a mano (manual: true): texto libre marcado — no descuentan stock ni cuentan en
//   "Más vendidos" del panel.
// - subtotal/total los calcula el Worker (nunca los del navegador): subtotal = Σ precio × cant.,
//   total = subtotal + envío − descuento.
// - Stock: el mismo camino que un pedido de la tienda (stockPrepareNewOrder → guardar →
//   stockFinishNewOrder, DO stock:ledger con opId ordnew:<id>, idempotente).
// - Correo de confirmación: el mismo de la tienda (sendOrderConfirmationEmail), SOLO si viene
//   notifyEmail: true y el correo es válido. Un correo inválido (no vacío) se rechaza con 400 para
//   que se corrija en el modal en vez de guardarse mal.
const MANUAL_LINES_MAX = 30;
const MANUAL_PRICE_MAX = 10000;
const MANUAL_QTY_MAX = 99;
async function handleOrderManualV2(order, env, origin, session, ctx) {
  const str = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, max) : '';
  const money = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
  const lines = Array.isArray(order.productos) ? order.productos : [];
  if (!lines.length) return err('Agrega al menos una pieza al pedido.', 400, origin);
  if (lines.length > MANUAL_LINES_MAX) return err(`Máximo ${MANUAL_LINES_MAX} líneas por pedido.`, 400, origin);
  const c = order.cliente || {};
  const nombre = str(c.nombre, 100);
  if (!nombre) return err('Falta el nombre de la clienta.', 400, origin);
  const email = str(c.email, 150);
  if (email && !isValidEmail(email)) return err('El correo no es válido. Corrígelo o déjalo vacío.', 400, origin);

  const needCatalog = lines.some((l) => l && l.manual !== true);
  const catalog = needCatalog ? await fetchCatalogForOrderValidation() : null;
  if (needCatalog && !catalog) return err('No se pudo leer el catálogo para validar las piezas. Intenta de nuevo en un momento.', 502, origin);
  const byId = new Map(((catalog && catalog.products) || []).filter((p) => p && p.id != null).map((p) => [String(p.id), p]));

  const productos = [];
  for (const [i, l] of lines.entries()) {
    if (!l || typeof l !== 'object') return err(`Línea ${i + 1} inválida.`, 400, origin);
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MANUAL_QTY_MAX) return err(`Línea ${i + 1}: la cantidad debe ser un entero entre 1 y ${MANUAL_QTY_MAX}.`, 400, origin);
    const price = money(l.price);
    if (!(price >= 0 && price <= MANUAL_PRICE_MAX)) return err(`Línea ${i + 1}: precio inválido.`, 400, origin);
    const personalization = str(l.personalization, 300);
    if (l.manual === true) {
      const name = str(l.name, 150);
      if (!name) return err(`Línea ${i + 1}: escribe qué pieza es.`, 400, origin);
      productos.push({ id: '', name, price, qty, personalization, manual: true });
      continue;
    }
    const id = l.id != null ? String(l.id) : '';
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err(`Línea ${i + 1}: id de producto inválido.`, 400, origin);
    const prod = byId.get(id);
    if (!prod) return err(`Línea ${i + 1}: ese producto no está en el catálogo publicado (si es nuevo, publícalo primero).`, 400, origin);
    productos.push({ id, name: String(prod.name || '').slice(0, 150), price, qty, personalization, ...(prod.sku ? { sku: String(prod.sku).slice(0, 40) } : {}) });
  }

  const envio = money(order.envio || 0), descuento = money(order.descuento || 0);
  if (!(envio >= 0 && envio <= 1000)) return err('Costo de envío inválido.', 400, origin);
  const subtotal = Math.round(productos.reduce((a, p) => a + p.price * p.qty, 0) * 100) / 100;
  if (!(descuento >= 0 && descuento <= subtotal + envio)) return err('El descuento no puede ser mayor que el pedido.', 400, origin);
  const total = Math.round((subtotal + envio - descuento) * 100) / 100;

  const newOrder = buildOrderCore({
    pago: order.pago, notas: order.notas, numero: order.numero,
    cliente: { ...c, nombre, email }, total, subtotal, envio,
  }, { strictPago: false });
  newOrder.productos = productos;
  if (descuento > 0) newOrder.descuento = descuento;
  newOrder.createdBy = session.user;
  newOrder.manualV = 2;
  setInitialPagoEstado(newOrder, order.pagoEstado === 'recibido' ? 'recibido' : 'pendiente', session.user);
  const wantsEmail = order.notifyEmail === true && !!email;
  if (wantsEmail) newOrder.confirmEmailAt = new Date().toISOString();

  assignOrderId(newOrder);
  if (!newOrder.numero && order.numero) newOrder.numero = String(newOrder.id);
  const stockPlanNew = productos.some((p) => p.id) ? await stockPrepareNewOrder(env, newOrder, catalog) : null;
  await env.CACUSA_KV.put(orderKey(newOrder.id), JSON.stringify(newOrder));
  await stockFinishNewOrder(env, newOrder, stockPlanNew);
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  const orderEmailLc = email.toLowerCase();
  if (ctx && orderEmailLc) ctx.waitUntil(removeCartLead(orderEmailLc, env).catch(() => {}));
  if (ctx && orderEmailLc) ctx.waitUntil(clearPendingCart(orderEmailLc, env).catch(() => {}));
  if (wantsEmail) {
    const p = sendOrderConfirmationEmail(newOrder, env).catch(e => console.error('email confirmación pedido manual falló:', e.message));
    if (ctx) ctx.waitUntil(p); else await p;
  }
  return ok({ ok: true, order: newOrder, emailQueued: wantsEmail, stockOversold: newOrder.stockOversold || null }, origin);
}

// ── Editar o borrar UN pedido existente desde el admin (cambiar estado, agregar
// tracking/carrier, actualizar datos del cliente, o eliminarlo). Reemplaza el patrón
// viejo de reenviar el array completo de pedidos (saveOrdersNow) — acá se lee y se
// escribe solo la llave de ESE pedido puntual, así que nunca puede pisar ni perder a
// un pedido distinto. El allowlist de campos evita que un patch toque productos/total/
// giftcard de un pedido ya cerrado.
const ORDER_PATCH_FIELDS = new Set(['estado', 'tracking', 'carrier']);
const ORDER_CLIENTE_PATCH_FIELDS = ['nombre', 'apellido', 'email', 'telefono', 'direccion', 'apto', 'ciudad', 'estado', 'zip', 'pais', 'notas'];
// Correo de envío cuando el tracking se pega a mano (guía comprada en Click-N-Ship): estado
// "Enviado", tracking presente, transportista USPS (o vacío con un número con formato USPS:
// 20–22 dígitos que empiezan con 9), email válido y que ese número no se haya avisado ya.
const USPS_TRACKING_RE = /^9\d{19,21}$/;
// ¿El pedido tiene un tracking de USPS? (transportista USPS, o vacío con número tipo USPS)
function orderHasUspsTracking(order) {
  const tracking = String((order && order.tracking) || '').replace(/\s+/g, '');
  if (!tracking) return false;
  const carrier = String(order.carrier || '').trim().toUpperCase();
  return carrier === 'USPS' || (!carrier && USPS_TRACKING_RE.test(tracking));
}
function shouldSendManualShipEmail(order) {
  const tracking = String((order && order.tracking) || '').replace(/\s+/g, '');
  if (!tracking || order.estado !== 'Enviado') return false;
  const carrier = String(order.carrier || '').trim().toUpperCase();
  if (!(carrier === 'USPS' || (!carrier && USPS_TRACKING_RE.test(tracking)))) return false;
  if (!isValidEmail((order.cliente && order.cliente.email) || '')) return false;
  return String(order.shipEmailSentFor || '').replace(/\s+/g, '') !== tracking;
}

// Pedido tal como lo ve el panel (sin el PDF de la guía, igual que orders_cache).
function orderForPanel(o) {
  if (!o || !o.labelBase64) return o;
  const { labelBase64, ...rest } = o;
  return { ...rest, labelStored: true };
}
// 409 "este pedido cambió en otro teléfono" con el pedido actual, para que el panel lo refresque.
function orderConflict(order, origin) {
  return jsonResp({ error: 'Este pedido cambió en otro teléfono.', conflict: true, order: orderForPanel(order) }, 409, origin);
}

async function handleOrderUpdate(body, env, origin, session, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.id;
  if (id == null) return err('Falta id', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);

  // Control de versión (wave 1): el panel manda el updatedAt del pedido que tenía en pantalla
  // (null si el pedido nunca se editó). Si ya no coincide, otra persona lo cambió mientras tanto
  // → 409 con el pedido actual, en vez de pisarlo con una decisión tomada sobre datos viejos
  // (ej. Tita lo marca "Enviado" y el panel atrasado de Robin lo devolvía a "En proceso", o un
  // "Entregado" que perdía su entregadoAt y con eso el correo de reseña). Un panel viejo que no
  // manda baseUpdatedAt sigue funcionando como antes (sin chequeo).
  if (Object.prototype.hasOwnProperty.call(body, 'baseUpdatedAt')) {
    const base = body.baseUpdatedAt == null || body.baseUpdatedAt === '' ? null : String(body.baseUpdatedAt);
    if ((order.updatedAt || null) !== base) return orderConflict(order, origin);
  }

  // Borrar = archivar (wave 1). Antes /order/update {delete:true} borraba la llave para siempre y
  // sin devolver el stock; ahora queda archivado (oculto en el panel, restaurable) y devuelve lo
  // descontado igual que una cancelación. Un panel viejo que todavía manda delete:true archiva.
  if (body.delete === true || body.archive === true) return await archiveOrder(order, env, origin, session, ctx);
  if (body.restore === true) return await restoreOrder(order, env, origin, session, ctx);

  const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
  if ('pagoEstado' in patch && !PAGO_ESTADOS.has(patch.pagoEstado)) return err('Estado de pago inválido', 400, origin);
  // 18 nov: piezas cargadas desde el panel ("Agregar pieza con foto" o búsqueda a mano).
  // Se resuelve TODO antes de tocar el pedido: si algo falla, no se escribe nada.
  const piecesRes = await applyOrderPiecePatch(order, patch, session);
  if (piecesRes.error) return err(piecesRes.error, piecesRes.status || 400, origin);
  // Stock (18 nov): deltas de piezas agregadas/quitadas + devolución al cancelar (una vez).
  const stockDeltas = { ...(piecesRes.stockDeltas || {}) };
  const stockNames = { ...(piecesRes.stockNames || {}) };
  const wasCancelled = order.estado === 'Cancelado';
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'cliente' && v && typeof v === 'object') {
      order.cliente = order.cliente || {};
      for (const ck of ORDER_CLIENTE_PATCH_FIELDS) {
        if (ck in v) order.cliente[ck] = String(v[ck] ?? '').slice(0, 500);
      }
      // 22 oct: idioma de la clienta (para WhatsApp/correos) — solo 'es' o 'en', elegido en el panel.
      if ('idioma' in v && (v.idioma === 'es' || v.idioma === 'en')) order.cliente.idioma = v.idioma;
      continue;
    }
    if (k === 'pagoEstado') {
      // Pago recibido / pendiente / reembolsado: quién y cuándo lo pone el servidor, nunca el cliente.
      if (order.pagoEstado !== v) { order.pagoEstado = v; order.pagoAt = new Date().toISOString(); order.pagoBy = session.user; }
      continue;
    }
    if (ORDER_PATCH_FIELDS.has(k)) order[k] = String(v ?? '').slice(0, 200);
  }
  // Borrar el tracking a mano borra también la guía guardada: si no, quedaba el PDF viejo
  // (ej. una guía de prueba del 16 oct) y contaba para la recolección del día.
  if ('tracking' in patch && !String(order.tracking || '').trim() && (order.labelStored || order.labelGeneratedAt)) {
    await env.CACUSA_KV.delete(labelKey(id)).catch(() => {});
    delete order.labelStored; delete order.labelFormat; delete order.labelGeneratedAt;
    delete order.labelWeightOz; delete order.labelEnv; delete order.labelBase64;
  }
  // 21 oct: cuándo quedó el pedido con un tracking de USPS (pegado a mano desde Click-N-Ship o
  // de una guía de la API) — así "Pedir recolección de hoy" cuenta también los paquetes de
  // Click-N-Ship. Se marca una vez por número; si se borra o deja de ser USPS, se quita.
  // 22 oct (auditoría): solo cuando ESTE cambio toca tracking o transportista. Antes, editar cualquier
  // pedido viejo (sin uspsTrackingFor) lo marcaba "de hoy": entraba en la recolección y se le
  // registraban avisos de USPS a un paquete ya entregado.
  const trackingTouched = 'tracking' in patch || 'carrier' in patch;
  let uspsTrackingNew = false;
  if (orderHasUspsTracking(order)) {
    const tn = String(order.tracking).replace(/\s+/g, '');
    if (order.uspsTrackingFor !== tn) {
      order.uspsTrackingFor = tn;
      if (trackingTouched) { order.uspsTrackingAt = new Date().toISOString(); uspsTrackingNew = true; delete order.autoTrackOff; }
      else if (!order.uspsNotify) order.uspsNotify = { for: tn, status: 'omitido', at: new Date().toISOString(), msg: 'tracking anterior al 21 oct', tries: 0 };
    }
  } else if (trackingTouched) {
    delete order.uspsTrackingFor; delete order.uspsTrackingAt;
  }
  // 18 oct: las guías se compran en Click-N-Ship y el tracking se pega a mano. Al quedar el
  // pedido "Enviado" con un tracking de USPS, la clienta recibe el mismo correo de envío que
  // con las guías de la API — una sola vez por número (shipEmailSentFor).
  // Nov: cuándo quedó "Entregado" — lo usa el pedido de reseña (runReviewRequests, N días
  // después). Se marca una sola vez; si este cambio lo saca de Entregado, se quita (así
  // un Entregado por error y vuelto a Enviado no dispara el correo antes de tiempo).
  if ('estado' in patch) {
    if (order.estado === 'Entregado') { if (!order.entregadoAt) { order.entregadoAt = new Date().toISOString(); order.entregadoFuente = 'panel'; } }
    else {
      if (order.entregadoFuente === 'panel') { delete order.entregadoAt; delete order.entregadoFuente; }
      // Wave 2: alguien lo sacó a mano de un "Entregado automático (USPS)" → el cron ya no lo
      // vuelve a pasar a Entregado (respeta la decisión de la persona).
      if (order.entregadoAuto) { order.autoTrackOff = true; delete order.entregadoAuto; }
    }
  }
  const sendShipEmail = shouldSendManualShipEmail(order);
  if (sendShipEmail) order.shipEmailSentFor = String(order.tracking).trim();
  order.updatedAt = new Date().toISOString();
  order.updatedBy = session.user;

  // Cancelar devuelve TODO lo descontado, una sola vez: stockApplied pasa a stockRestored y
  // las líneas pierden su marca stockTaken (así quitar una pieza después no devuelve doble).
  // Reactivar un pedido cancelado NO vuelve a descontar — se documenta, se ajusta a mano.
  if (!wasCancelled && order.estado === 'Cancelado' && order.stockApplied && Object.keys(order.stockApplied).length) {
    for (const [sid, q] of Object.entries(order.stockApplied)) {
      const n = Number(q) || 0;
      if (n > 0) stockDeltas[sid] = (stockDeltas[sid] || 0) + n;
    }
    for (const p of order.productos || []) { if (p && p.id != null && !stockNames[String(p.id)]) stockNames[String(p.id)] = p.name; if (p) delete p.stockTaken; }
    order.stockRestored = { ...(order.stockRestored || {}), ...order.stockApplied };
    order.stockRestoredAt = new Date().toISOString();
    order.stockApplied = {};
  }
  const stockPlanUpd = Object.keys(stockDeltas).length ? await stockPlan(env, stockDeltas) : null;
  if (stockPlanUpd && Object.keys(stockPlanUpd.oversold).length) order.stockOversold = { ...(order.stockOversold || {}), ...stockPlanUpd.oversold };

  await env.CACUSA_KV.put(orderKey(id), JSON.stringify(order));
  if (stockPlanUpd) {
    const reason = !wasCancelled && order.estado === 'Cancelado' ? 'Pedido cancelado' : 'Pieza del pedido';
    await stockCommit(env, stockPlanUpd, stockNames, { by: session.user, reason, ref: orderStockRef(order), opId: 'ordupd:' + id + ':' + order.updatedAt })
      .catch((e) => console.error('stock commit (update):', e.message));
  }
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  if (sendShipEmail && ctx) ctx.waitUntil(sendShippingConfirmationEmail(order, env).catch(e => console.error('email de envío (tracking manual) falló:', e.message)));
  if (ctx && uspsTrackingNew && uspsNotifyDue(order)) ctx.waitUntil(registerUspsNotifications(env, order.id, { auto: true }).catch(e => console.error('avisos USPS falló:', e.message)));
  return ok({ ok: true, order: orderForPanel(order) }, origin);
}

function orderStockRef(o) { return 'Pedido ' + (o && (o.numero ? '#' + o.numero : o.id)); }

// Archivar (wave 1): oculta el pedido sin borrarlo (sigue en order:<id>, en orders_cache con
// archivado:true y en el respaldo diario). Devuelve el stock descontado una sola vez, igual que
// cancelar — salvo que ya estuviera Cancelado (ese stock ya volvió). Restaurar lo vuelve a descontar.
async function archiveOrder(order, env, origin, session, ctx) {
  if (order.archivado) return ok({ ok: true, archived: true, deleted: true, order: orderForPanel(order) }, origin);
  const now = new Date().toISOString();
  const deltas = {}, names = {};
  if (order.estado !== 'Cancelado' && order.stockApplied && Object.keys(order.stockApplied).length) {
    for (const [sid, q] of Object.entries(order.stockApplied)) { const n = Number(q) || 0; if (n > 0) deltas[sid] = (deltas[sid] || 0) + n; }
    for (const p of order.productos || []) if (p && p.id != null && !names[String(p.id)]) names[String(p.id)] = p.name;
    order.archiveStockReturned = { ...order.stockApplied };
    order.stockApplied = {};
  }
  order.archivado = true; order.archivedAt = now; order.archivedBy = session.user;
  order.updatedAt = now; order.updatedBy = session.user;
  const plan = Object.keys(deltas).length ? await stockPlan(env, deltas) : null;
  await env.CACUSA_KV.put(orderKey(order.id), JSON.stringify(order));
  if (plan) await stockCommit(env, plan, names, { by: session.user, reason: 'Pedido archivado', ref: orderStockRef(order), opId: 'ordarch:' + order.id + ':' + now })
    .catch((e) => console.error('stock commit (archivar):', e.message));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  return ok({ ok: true, archived: true, deleted: true, order: orderForPanel(order) }, origin);
}
async function restoreOrder(order, env, origin, session, ctx) {
  if (!order.archivado) return ok({ ok: true, restored: true, order: orderForPanel(order) }, origin);
  const now = new Date().toISOString();
  const deltas = {}, names = {};
  const back = order.archiveStockReturned || {};
  for (const [sid, q] of Object.entries(back)) { const n = Number(q) || 0; if (n > 0) deltas[sid] = (deltas[sid] || 0) - n; }
  for (const p of order.productos || []) if (p && p.id != null && !names[String(p.id)]) names[String(p.id)] = p.name;
  const plan = Object.keys(deltas).length ? await stockPlan(env, deltas) : null;
  if (plan) {
    order.stockApplied = { ...(order.stockApplied || {}), ...back };
    if (Object.keys(plan.oversold).length) order.stockOversold = { ...(order.stockOversold || {}), ...plan.oversold };
  }
  delete order.archivado; delete order.archivedAt; delete order.archivedBy; delete order.archiveStockReturned;
  order.restoredAt = now; order.restoredBy = session.user;
  order.updatedAt = now; order.updatedBy = session.user;
  await env.CACUSA_KV.put(orderKey(order.id), JSON.stringify(order));
  if (plan) await stockCommit(env, plan, names, { by: session.user, reason: 'Pedido restaurado', ref: orderStockRef(order), opId: 'ordrest:' + order.id + ':' + now })
    .catch((e) => console.error('stock commit (restaurar):', e.message));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  return ok({ ok: true, restored: true, order: orderForPanel(order) }, origin);
}

// POST /internal/order/refund {id, refundedCents, paidCents} — lo llama cacusa-square cuando
// Square avisa (payment.updated) que un pago de la tienda tiene reembolsos. Reembolso total →
// pagoEstado 'reembolsado'; parcial → queda 'recibido' con reembolsoCents. Idempotente.
async function handleOrderRefundIngest(body, env, origin, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.id;
  if (id == null || !/^\d{1,20}$/.test(String(id))) return err('Falta id', 400, origin);
  const refunded = Math.round(Number(body.refundedCents));
  const paid = Math.round(Number(body.paidCents));
  if (!Number.isFinite(refunded) || refunded <= 0 || !Number.isFinite(paid) || paid <= 0) return err('Montos inválidos', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);
  const full = refunded >= paid;
  if ((order.reembolsoCents || 0) === refunded && (!full || order.pagoEstado === 'reembolsado')) return ok({ ok: true, unchanged: true }, origin);
  const now = new Date().toISOString();
  order.reembolsoCents = refunded;
  order.reembolsoAt = now;
  if (full) { order.pagoEstado = 'reembolsado'; order.pagoAt = now; order.pagoBy = 'square'; }
  order.updatedAt = now; order.updatedBy = 'square';
  await env.CACUSA_KV.put(orderKey(order.id), JSON.stringify(order));
  if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
  const p = adminPush(env, 'CACUSA · Reembolso en Square',
    `Square reembolsó $${(refunded / 100).toFixed(2)}${full ? ' (total)' : ' (parcial)'} del pedido ${sanitizePushText(order.numero || order.id)}`, 'cacusa-order', 'normal');
  if (ctx) ctx.waitUntil(p); else await p;
  return ok({ ok: true, full }, origin);
}

// ── Piezas cargadas a mano en un pedido (18 nov) ─────────────────────────────────────
// Las cajas de Cacusa Lovers nacen con productos: [] a propósito (elegir las 2 piezas es
// curaduría humana). Desde el panel se agregan con "Agregar pieza con foto" (la IA sugiere,
// la persona elige) o buscándolas a mano. Solo en cajas de Lovers y en pedidos manuales del
// panel (createdBy = una cuenta del panel, ver handleOrderManual): un pedido de la tienda ya
// tiene sus productos cobrados y no se toca. El nombre/precio/foto salen SIEMPRE del
// catálogo real, nunca de lo que mande el navegador. order.total nunca cambia.
const ORDER_ADD_PIECES_MAX = 5;
function orderIsLovers(o) { return !!o && (o.pago === 'Lovers' || !!o.lote); }
function orderAllowsPieceLoad(o) { return orderIsLovers(o) || (!!o && VALID_USERS.has(o.createdBy)); }
async function applyOrderPiecePatch(order, patch, session) {
  const hasAdd = 'addProductIds' in patch && patch.addProductIds != null;
  const hasRemove = 'removeProductIndex' in patch && patch.removeProductIndex != null;
  if (!hasAdd && !hasRemove) return {};
  if (!orderAllowsPieceLoad(order)) return { error: 'Solo se pueden cargar piezas en cajas de Lovers o pedidos manuales' };
  const productos = Array.isArray(order.productos) ? order.productos.slice() : [];
  const stockDeltas = {}, stockNames = {};
  const applied = { ...(order.stockApplied || {}) };

  if (hasRemove) {
    const idx = patch.removeProductIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= productos.length) return { error: 'Pieza fuera de rango' };
    if (!productos[idx] || !productos[idx].addedBy) return { error: 'Solo se pueden quitar piezas cargadas desde el panel' };
    const [gone] = productos.splice(idx, 1);
    // Devuelve la unidad solo si esa línea la había descontado (stockTaken).
    if (gone.stockTaken && gone.id) {
      const sid = String(gone.id);
      stockDeltas[sid] = (stockDeltas[sid] || 0) + 1;
      stockNames[sid] = gone.name;
      applied[sid] = Math.max(0, (applied[sid] || 0) - 1);
      if (!applied[sid]) delete applied[sid];
    }
  }

  if (hasAdd) {
    const ids = patch.addProductIds;
    if (!Array.isArray(ids) || !ids.length) return { error: 'addProductIds debe ser una lista de ids' };
    if (ids.length > ORDER_ADD_PIECES_MAX) return { error: `Máximo ${ORDER_ADD_PIECES_MAX} piezas por vez` };
    if (productos.length + ids.length > ORDER_MAX_LINES) return { error: `El pedido no puede tener más de ${ORDER_MAX_LINES} líneas` };
    for (const id of ids) {
      if (!(typeof id === 'string' || typeof id === 'number') || !/^[A-Za-z0-9_-]{1,50}$/.test(String(id))) return { error: 'Id de producto inválido' };
    }
    const catalog = await fetchCatalogForOrderValidation();
    if (!catalog) return { error: 'No se pudo leer el catálogo. Intenta de nuevo en un momento.', status: 502 };
    const byId = new Map(catalog.products.map((p) => [String(p.id), p]));
    const lovers = orderIsLovers(order);
    const now = new Date().toISOString();
    for (const id of ids) {
      const prod = byId.get(String(id));
      if (!prod) return { error: 'Producto no encontrado en el catálogo: ' + String(id) };
      const price = lovers ? 0 : Number(resolveBasePrice(prod));
      productos.push({
        id: String(prod.id).slice(0, 50),
        name: String(prod.name || '').slice(0, 150),
        // Lovers: la pieza va incluida en la suscripción. Manual: precio del catálogo como
        // referencia — el total del pedido NO se recalcula (puede llevar precio pactado).
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        qty: 1,
        personalization: '',
        imageUrl: catalogImageUrl(prod),
        addedBy: session.user,
        addedAt: now,
        stockTaken: 1, // esta línea descontó 1 unidad (se devuelve al quitarla o cancelar)
      });
      const sid = String(prod.id);
      stockDeltas[sid] = (stockDeltas[sid] || 0) - 1;
      stockNames[sid] = prod.name;
      applied[sid] = (applied[sid] || 0) + 1;
    }
  }
  order.productos = productos;
  if (Object.keys(applied).length || order.stockApplied) order.stockApplied = applied;
  return { changed: true, stockDeltas, stockNames };
}

// ── Reconocimiento de piezas por foto — referencias aprendidas (19 nov) ──────────────
// El reconocimiento corre GRATIS en el navegador del panel (MobileNet v2 con TF.js): el
// panel compara la foto con las fotos del catálogo. Este Worker solo guarda "referencias"
// aprendidas: cada vez que alguien confirma qué pieza era, el panel manda el vector de esa
// foto y la próxima vez se reconoce mejor (fotos reales del taller, no solo las del sitio).
// Todo en UNA llave de KV (identify:refs) → el panel la lee con un solo get. Vectores
// normalizados (L2) y cuantizados a int8 (-127..127) en base64: IDENTIFY_REF_DIM bytes cada
// uno (~1,7 KB en base64). Máx. 10 por producto (se descartan los más viejos) y
// IDENTIFY_REFS_MAX_PRODUCTS productos (≈ 8,5 MB en el peor caso, debajo del límite de KV).
// Lectura-modificación-escritura sin lock: 2 confirmaciones simultáneas pueden perder una
// referencia — es solo un dato de mejora, no hay plata ni stock en juego.
const SITE_ORIGIN = 'https://cacusabytaitus.com';
const IDENTIFY_REF_DIM = 1280;            // tamaño del vector de MobileNet v2 (capa previa a logits)
const IDENTIFY_REFS_PER_PRODUCT = 10;
const IDENTIFY_REFS_MAX_PRODUCTS = 500;
const IDENTIFY_REFS_KEY = 'identify:refs';


function catalogImageUrl(p) {
  let u = (p && (p.imageUrl || (Array.isArray(p.images) ? p.images[0] : ''))) || '';
  u = typeof u === 'string' ? u.trim() : '';
  if (!u || /^(data|blob|javascript):/i.test(u)) return '';
  if (/^https:\/\//i.test(u)) return u;
  if (/^http:\/\//i.test(u)) return 'https://' + u.slice(7);
  if (u.startsWith('//')) return 'https:' + u;
  return SITE_ORIGIN + '/' + u.replace(/^\.?\//, '');
}
// Tamaño real (bytes) de un base64 sin decodificarlo; null si no es base64 válido.
function base64DecodedSize(s) {
  if (typeof s !== 'string' || !s.length || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

async function identifyRefsRead(env) {
  let data = null;
  try { data = JSON.parse(await env.CACUSA_KV.get(IDENTIFY_REFS_KEY)); } catch (_) { data = null; }
  if (!data || typeof data !== 'object' || !data.refs || typeof data.refs !== 'object') data = { refs: {} };
  // Si algún día cambia el modelo (otro tamaño de vector), las referencias viejas no sirven.
  if (data.dim && data.dim !== IDENTIFY_REF_DIM) data = { refs: {} };
  return data;
}
async function identifyRefsWrite(env, data) {
  data.dim = IDENTIFY_REF_DIM;
  data.updatedAt = new Date().toISOString();
  const body = JSON.stringify(data);
  try { await env.CACUSA_KV.put(IDENTIFY_REFS_KEY, body); }
  catch (e) { await new Promise((r) => setTimeout(r, 1100)); await env.CACUSA_KV.put(IDENTIFY_REFS_KEY, body); } // 1 escritura/s por llave
}
// POST /identify/refs (sesión) → { refs: {productId: [base64 int8, ...]}, dim }
async function handleIdentifyRefs(env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const data = await identifyRefsRead(env);
  return ok({ ok: true, refs: data.refs, dim: IDENTIFY_REF_DIM }, origin);
}
// POST /identify/ref/add (sesión) { id, vector: base64 de IDENTIFY_REF_DIM bytes int8 }
// ── Sugerir la ficha de un producto nuevo desde su foto (Claude Haiku 5.5, 24 nov) ──────
// POST /product/describe { token, image (base64 JPEG/PNG/WebP, el panel la achica a ~768 px),
//   mediaType, neighborIds?: [hasta 3 ids parecidos según el reconocimiento por foto del
//   panel], hints?: { category, material } }
// Devuelve { suggestion: { name, name_en, description, description_en, category, material } }.
// Lo más barato posible: modelo Haiku 5.5, effort low, sin thinking, una sola imagen chica y
// como ejemplos de estilo SOLO el texto (sin fotos) de las 3 fichas más parecidas. Costo
// típico ~2.400 tokens de entrada + ~500 de salida ≈ $0.0005 por ficha. Tope 40/día (DO).
// Nunca escribe nada: el panel llena solo los campos vacíos y la persona revisa.
const DESCRIBE_MODEL = 'claude-haiku-5-5';
const DESCRIBE_DAILY_MAX = 40;
const DESCRIBE_MAX_BYTES = 600 * 1024;
const DESCRIBE_TIMEOUT_MS = 30_000;
const DESCRIBE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DESCRIBE_SYSTEM = [
  'Eres quien escribe las fichas de producto de CACUSA by Taitus, joyería y bisutería artesanal (Ecuador y EE.UU.).',
  'Con la foto de una pieza nueva escribes su nombre y descripción en español (tuteo, cálido, breve) y en inglés, con el mismo estilo y largo que las fichas de ejemplo.',
  'Nombre: corto (2 a 6 palabras), describe la pieza (tipo + rasgo distintivo: dije, piedra, forma, color). Sin marcas ajenas.',
  'Descripción: 2 o 3 frases. Qué es, el material tal como aparece en los ejemplos, y cómo o cuándo usarla. No inventes medidas, quilates, piedras naturales ni garantías que no se vean o no estén en los ejemplos.',
  'Nunca uses emojis. Elige la categoría solo de la lista dada. Si dudas del material, usa el de las fichas parecidas.',
].join('\n');

function stripColorEmoji(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function handleProductDescribe(body, env, origin) {
  let image = typeof body.image === 'string' ? body.image.trim() : '';
  const m = /^data:([a-z/+-]+);base64,/i.exec(image);
  if (m) image = image.slice(m[0].length);
  image = image.replace(/\s+/g, '');
  const mediaType = String(body.mediaType || (m ? m[1] : '') || '').toLowerCase();
  if (!image) return err('Falta la foto', 400, origin);
  if (!DESCRIBE_MEDIA_TYPES.has(mediaType)) return err('Formato de foto no soportado (usa JPEG, PNG o WebP)', 400, origin);
  const size = base64DecodedSize(image);
  if (size == null) return err('La foto no es un base64 válido', 400, origin);
  if (size > DESCRIBE_MAX_BYTES) return err('La foto es demasiado grande para sugerir datos (máximo 600 KB)', 400, origin);

  if (!env.ANTHROPIC_API_KEY) return err('La sugerencia con IA no está activada (falta ANTHROPIC_API_KEY en el Worker).', 503, origin);

  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo leer el catálogo. Intenta de nuevo en un momento.', 502, origin);
  const products = catalog.products.filter((p) => p && p.id != null);
  const categories = [...new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))].slice(0, 40);
  if (!categories.length) return err('El catálogo no tiene categorías.', 502, origin);

  const hints = body.hints && typeof body.hints === 'object' ? body.hints : {};
  const hintCat = categories.includes(String(hints.category || '')) ? String(hints.category) : '';
  const hintMat = stripColorEmoji(hints.material, 60);
  const ids = Array.isArray(body.neighborIds) ? body.neighborIds.map((x) => String(x)).slice(0, 3) : [];
  const byId = new Map(products.map((p) => [String(p.id), p]));
  let examples = ids.map((id) => byId.get(id)).filter((p) => p && p.description);
  if (examples.length < 3) {
    const pool = products.filter((p) => p.description && !examples.includes(p) && (!hintCat || p.category === hintCat));
    examples = examples.concat(pool.slice(0, 3 - examples.length));
  }
  const exText = examples.map((p, i) => [
    `Ejemplo ${i + 1} (${String(p.category || '')}, material: ${String(p.material || '')}):`,
    `name: ${String(p.name || '').slice(0, 80)}`,
    `name_en: ${String(p.name_en || '').slice(0, 80)}`,
    `description: ${String(p.description || '').slice(0, 400)}`,
    `description_en: ${String(p.description_en || '').slice(0, 400)}`,
  ].join('\n')).join('\n\n');

  // Tope diario de gasto (DO, no KV). Se cuenta antes de llamar: un timeout también gasta.
  if (!(await rateLimit(env, 'describe', 'all', DESCRIBE_DAILY_MAX, 86400))) {
    return err(`Se alcanzó el límite de ${DESCRIBE_DAILY_MAX} sugerencias con IA de hoy. Mañana se reinicia; mientras tanto usa la sugerencia básica.`, 429, origin);
  }

  const prompt = [
    'Categorías posibles: ' + categories.join(', ') + '.',
    hintCat ? `Las piezas más parecidas del catálogo son de la categoría "${hintCat}".` : '',
    hintMat ? `Material más probable según las piezas parecidas: "${hintMat}".` : '',
    'Fichas parecidas del catálogo (copia su estilo y largo, no su contenido):',
    exText,
    'Escribe la ficha de la pieza de la foto.',
  ].filter(Boolean).join('\n');

  const payload = {
    model: DESCRIBE_MODEL,
    max_tokens: 700,
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            name_en: { type: 'string' },
            description: { type: 'string' },
            description_en: { type: 'string' },
            category: { type: 'string', enum: categories },
            material: { type: 'string' },
          },
          required: ['name', 'name_en', 'description', 'description_en', 'category', 'material'],
          additionalProperties: false,
        },
      },
    },
    system: DESCRIBE_SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
      { type: 'text', text: prompt },
    ] }],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DESCRIBE_TIMEOUT_MS);
  let data;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2026-10-21',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = String((j && j.error && j.error.type) || ''); } catch (_) {}
      console.error('describe: API de Claude respondió', r.status, detail);
      return err(`La IA respondió con un error (HTTP ${r.status}). Usa la sugerencia básica o intenta de nuevo.`, 502, origin);
    }
    data = await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') return err('La IA tardó demasiado en responder. Intenta de nuevo.', 504, origin);
    console.error('describe: fallo de red con la API de Claude:', e && e.message);
    return err('No se pudo contactar a la IA. Intenta de nuevo en un momento.', 502, origin);
  } finally {
    clearTimeout(timer);
  }

  if (data && data.stop_reason === 'refusal') return err('La IA no pudo describir esta foto. Usa la sugerencia básica.', 502, origin);
  if (data && data.stop_reason === 'max_tokens') return err('La respuesta de la IA quedó incompleta. Intenta de nuevo.', 502, origin);
  const textBlock = Array.isArray(data && data.content) ? data.content.find((b) => b && b.type === 'text') : null;
  let parsed;
  try { parsed = JSON.parse(textBlock ? textBlock.text : ''); } catch (_) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return err('La respuesta de la IA no se pudo leer. Intenta de nuevo.', 502, origin);

  const suggestion = {
    name: stripColorEmoji(parsed.name, 80),
    name_en: stripColorEmoji(parsed.name_en, 80),
    description: stripColorEmoji(parsed.description, 600),
    description_en: stripColorEmoji(parsed.description_en, 600),
    category: categories.includes(parsed.category) ? parsed.category : (hintCat || ''),
    material: stripColorEmoji(parsed.material, 60),
  };
  const u = (data && data.usage) || {};
  return ok({ ok: true, suggestion, model: DESCRIBE_MODEL,
    usage: { input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0 } }, origin);
}

// ── Segunda opinión cuando el identificador por foto duda (Claude Haiku 5.5, 24 nov) ────
// POST /identify/rerank { token, image (base64 de la foto del taller, ~512 px),
//   candidates: [{ id, image (base64 ~384 px de la foto del catálogo) }] (2 a 5) }
// El panel la llama SOLO cuando aparece "Duda entre 2 piezas"; nunca en los casos claros.
// Lo más barato posible: Haiku 5.5, sin thinking, effort low, imágenes chicas que manda el
// panel (ya las tiene cargadas) → ~1.500 tokens de entrada + ~60 de salida ≈ $0.0002.
// Devuelve { choice: id | null, confidence } con un id que SIEMPRE es uno de los candidatos
// y existe en el catálogo. Nunca escribe nada. Tope 150/día (DO).
const RERANK_MODEL = 'claude-haiku-5-5';
const RERANK_DAILY_MAX = 150;
const RERANK_MAX_BYTES = 300 * 1024;
const RERANK_TIMEOUT_MS = 20_000;
const RERANK_SYSTEM = [
  'Ayudas al taller de una joyería a reconocer qué pieza del catálogo aparece en una foto tomada con el teléfono (puede haber mano, mantel estampado, otras joyas al fondo, otra luz o ángulo).',
  'Te doy la foto del taller y varias fotos oficiales del catálogo, cada una con su ID. Compara solo la joya: forma, dijes, piedras (color, cantidad, corte), tipo de cadena o cordón, color del metal y detalles grabados. Ignora el fondo y la mano.',
  'Elige el ID que es la MISMA pieza. Si ninguna coincide con seguridad, devuelve choice null. confidence entre 0 y 1.',
].join('\n');

function rerankImage(b64) {
  let s = typeof b64 === 'string' ? b64.trim() : '';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,/i.exec(s);
  const mediaType = m ? m[1].toLowerCase() : 'image/jpeg';
  if (m) s = s.slice(m[0].length);
  s = s.replace(/\s+/g, '');
  const size = base64DecodedSize(s);
  if (size == null || size > RERANK_MAX_BYTES) return null;
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: s } };
}

async function handleIdentifyRerank(body, env, origin) {
  const query = rerankImage(body.image);
  if (!query) return err('Falta la foto o es demasiado grande (máximo 300 KB)', 400, origin);
  const list = Array.isArray(body.candidates) ? body.candidates.slice(0, 5) : [];
  if (list.length < 2) return err('Se necesitan al menos 2 candidatas', 400, origin);
  if (!env.ANTHROPIC_API_KEY) return err('La segunda opinión con IA no está activada (falta ANTHROPIC_API_KEY en el Worker).', 503, origin);

  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo leer el catálogo. Intenta de nuevo en un momento.', 502, origin);
  const byId = new Map(catalog.products.filter((p) => p && p.id != null).map((p) => [String(p.id), p]));
  const cands = [];
  const seen = new Set();
  for (const c of list) {
    const id = c && c.id != null ? String(c.id).trim() : '';
    if (!id || seen.has(id) || !byId.has(id)) continue;
    const img = rerankImage(c.image);
    if (!img) continue;
    seen.add(id);
    cands.push({ id, img, p: byId.get(id) });
  }
  if (cands.length < 2) return err('Las candidatas no son válidas', 400, origin);

  if (!(await rateLimit(env, 'rerank', 'all', RERANK_DAILY_MAX, 86400))) {
    return err(`Se alcanzó el límite de ${RERANK_DAILY_MAX} segundas opiniones de hoy. Elige la pieza a mano o toma otra foto.`, 429, origin);
  }

  const content = [{ type: 'text', text: 'Foto del taller:' }, query];
  for (const c of cands) {
    content.push({ type: 'text', text: `ID ${c.id} · ${String(c.p.category || '')} · ${String(c.p.name || '').slice(0, 60)}` });
    content.push(c.img);
  }
  content.push({ type: 'text', text: '¿Cuál ID es la misma pieza que la foto del taller?' });

  const ids = cands.map((c) => c.id);
  const payload = {
    model: RERANK_MODEL,
    max_tokens: 200,
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            choice: { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] },
            confidence: { type: 'number' },
          },
          required: ['choice', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    system: RERANK_SYSTEM,
    messages: [{ role: 'user', content }],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RERANK_TIMEOUT_MS);
  let data;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = String((j && j.error && j.error.type) || ''); } catch (_) {}
      console.error('rerank: API de Claude respondió', r.status, detail);
      return err(`La IA respondió con un error (HTTP ${r.status}).`, 502, origin);
    }
    data = await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') return err('La IA tardó demasiado en responder.', 504, origin);
    console.error('rerank: fallo de red con la API de Claude:', e && e.message);
    return err('No se pudo contactar a la IA.', 502, origin);
  } finally {
    clearTimeout(timer);
  }
  if (data && data.stop_reason === 'refusal') return err('La IA no pudo analizar esta foto.', 502, origin);
  const textBlock = Array.isArray(data && data.content) ? data.content.find((b) => b && b.type === 'text') : null;
  let parsed;
  try { parsed = JSON.parse(textBlock ? textBlock.text : ''); } catch (_) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return err('La respuesta de la IA no se pudo leer.', 502, origin);
  const choice = parsed.choice != null && ids.includes(String(parsed.choice)) ? String(parsed.choice) : null;
  const conf = Number(parsed.confidence);
  const u = (data && data.usage) || {};
  return ok({ ok: true, choice, confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    model: RERANK_MODEL, usage: { input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0 } }, origin);
}

// ── Traducir la ficha ES → EN con Claude Haiku 5.5 (25 nov) ──────────────────────────────
// POST /product/translate { token, name?, description? } → { ok, name_en?, description_en? }
// Reemplaza al traductor gratis (MyMemory) del panel; si esta ruta falla, el panel vuelve
// a MyMemory. Solo texto, sin imágenes: ~300 tokens de entrada + ~150 de salida ≈ $0.0001.
// Tope 200/día (DO). Nunca escribe nada: el panel llena los campos y la persona revisa.
const TRANSLATE_MODEL = 'claude-haiku-5-5';
const TRANSLATE_DAILY_MAX = 200;
const TRANSLATE_SYSTEM = [
  'Traduces fichas de producto de CACUSA by Taitus (joyería artesanal) del español al inglés de EE.UU.',
  'Tono cálido, natural y breve, como una tienda boutique; no traducción literal. Mantén el mismo largo aproximado.',
  'Términos fijos: "baño de oro 18K" = "18K gold plating"; "acero inoxidable" = "stainless steel"; "ajustable" = "adjustable"; "Cacusa Lovers" queda igual.',
  'No agregues información que no esté en el texto. Nunca uses emojis.',
].join('\n');

async function handleProductTranslate(body, env, origin) {
  const name = stripColorEmoji(body.name, 120);
  const description = stripColorEmoji(body.description, 1200);
  if (!name && !description) return err('No hay texto para traducir', 400, origin);
  if (!env.ANTHROPIC_API_KEY) return err('La traducción con IA no está activada (falta ANTHROPIC_API_KEY en el Worker).', 503, origin);
  if (!(await rateLimit(env, 'translate', 'all', TRANSLATE_DAILY_MAX, 86400))) {
    return err(`Se alcanzó el límite de ${TRANSLATE_DAILY_MAX} traducciones con IA de hoy.`, 429, origin);
  }
  const props = {}; const req = [];
  if (name) { props.name_en = { type: 'string' }; req.push('name_en'); }
  if (description) { props.description_en = { type: 'string' }; req.push('description_en'); }
  const payload = {
    model: TRANSLATE_MODEL,
    max_tokens: 800,
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object', properties: props, required: req, additionalProperties: false } },
    },
    system: TRANSLATE_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text:
      (name ? 'name: ' + name + '\n' : '') + (description ? 'description: ' + description + '\n' : '') + 'Tradúcelo al inglés.' }] }],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let data;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = String((j && j.error && j.error.type) || ''); } catch (_) {}
      console.error('translate: API de Claude respondió', r.status, detail);
      return err(`La IA respondió con un error (HTTP ${r.status}).`, 502, origin);
    }
    data = await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') return err('La IA tardó demasiado en responder.', 504, origin);
    return err('No se pudo contactar a la IA.', 502, origin);
  } finally {
    clearTimeout(timer);
  }
  if (data && (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens')) return err('La IA no pudo traducir este texto.', 502, origin);
  const textBlock = Array.isArray(data && data.content) ? data.content.find((b) => b && b.type === 'text') : null;
  let parsed;
  try { parsed = JSON.parse(textBlock ? textBlock.text : ''); } catch (_) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return err('La respuesta de la IA no se pudo leer.', 502, origin);
  const out = { ok: true };
  if (name) out.name_en = stripColorEmoji(parsed.name_en, 120);
  if (description) out.description_en = stripColorEmoji(parsed.description_en, 1200);
  return ok(out, origin);
}

// ── Ingreso de inventario con foto (27 nov): factura del proveedor y conteo de unidades ──
// Mismo patrón que /product/describe: Claude Haiku 5.5, sin thinking, effort low, salida
// json_schema, una sola imagen chica que achica el panel, tope diario en la DO (rateLimit,
// nunca KV) contado ANTES de llamar. Nunca escriben nada: el panel muestra el resultado y la
// persona confirma (costo y stock se guardan después por /cost/set y /stock/set).
// Precios Haiku 5.5: US$ 0,10 / 0,50 por millón de tokens de entrada / salida; imagen ≈
// ancho × alto / 750 tokens.
//   /product/invoice: foto ≤ 600 KB (~1.600 px → ~2.500 tokens) + ~250 de texto + ~600 de
//     salida (20 líneas) ≈ US$ 0,0006; peor caso (max_tokens 2.000) ≈ US$ 0,0013. Tope 30/día.
//   /product/count:   foto ≤ 300 KB (~1.000 px → ~1.300 tokens) + ~200 de texto + ~80 de
//     salida ≈ US$ 0,0002. Tope 100/día.
const INVENTORY_MODEL = 'claude-haiku-5-5';
const INVOICE_DAILY_MAX = 30;
const INVOICE_MAX_BYTES = 600 * 1024;
const INVOICE_MAX_LINES = 60;
const COUNT_DAILY_MAX = 100;
const COUNT_MAX_BYTES = 300 * 1024;
const INVOICE_SYSTEM = [
  'Lees facturas, notas de venta o listas de pedido de proveedores de una joyería artesanal (CACUSA by Taitus, Ecuador y EE.UU.). La foto puede estar torcida, con sombras o escrita a mano.',
  'Devuelve una línea por cada producto comprado: description (texto de la línea tal como aparece, corto), quantity (unidades, entero), unit_cost (costo por UNIDAD, número sin símbolo; si solo aparece el total de la línea, divídelo por la cantidad) y currency (código ISO de 3 letras; USD si no se indica).',
  'No incluyas subtotales, impuestos, envío, descuentos generales ni totales. Si una línea no se puede leer, omítela. No inventes líneas ni precios. Nunca uses emojis.',
].join('\n');
const COUNT_SYSTEM = [
  'Cuentas unidades de joyería en una foto tomada con el teléfono en el taller (aretes, anillos, dijes, cadenas, pulseras sobre una mesa o en bolsitas).',
  'Cuenta cuántas unidades vendibles hay. Un par de aretes cuenta como 1 unidad. Si te dicen qué pieza contar, cuenta solo esa. Agrupa por color o tono visible (por ejemplo dorado, plateado, rosado, verde) en by_color; la suma de by_color debe ser igual a count.',
  'Si no se puede contar con seguridad, da tu mejor estimación honesta. Nunca uses emojis.',
].join('\n');

// base64 (con o sin prefijo data:) → bloque de imagen para la API, o { error }.
function inventoryImage(raw, mediaTypeIn, maxBytes) {
  let image = typeof raw === 'string' ? raw.trim() : '';
  const m = /^data:([a-z/+-]+);base64,/i.exec(image);
  if (m) image = image.slice(m[0].length);
  image = image.replace(/\s+/g, '');
  const mediaType = String(mediaTypeIn || (m ? m[1] : '') || 'image/jpeg').toLowerCase();
  if (!image) return { error: 'Falta la foto' };
  if (!DESCRIBE_MEDIA_TYPES.has(mediaType)) return { error: 'Formato de foto no soportado (usa JPEG, PNG o WebP)' };
  const size = base64DecodedSize(image);
  if (size == null) return { error: 'La foto no es un base64 válido' };
  if (size > maxBytes) return { error: `La foto es demasiado grande (máximo ${Math.round(maxBytes / 1024)} KB)` };
  return { block: { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } } };
}

// Llama a Haiku con salida json_schema. → { parsed, usage } o { error, status }.
async function inventoryAsk(env, { system, content, schema, maxTokens, timeoutMs, tag }) {
  const payload = {
    model: INVENTORY_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let data;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = String((j && j.error && j.error.type) || ''); } catch (_) {}
      console.error(tag + ': API de Claude respondió', r.status, detail);
      return { error: `La IA respondió con un error (HTTP ${r.status}). Intenta de nuevo.`, status: 502 };
    }
    data = await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') return { error: 'La IA tardó demasiado en responder. Intenta de nuevo.', status: 504 };
    console.error(tag + ': fallo de red con la API de Claude:', e && e.message);
    return { error: 'No se pudo contactar a la IA. Intenta de nuevo en un momento.', status: 502 };
  } finally {
    clearTimeout(timer);
  }
  if (data && data.stop_reason === 'refusal') return { error: 'La IA no pudo leer esta foto.', status: 502 };
  if (data && data.stop_reason === 'max_tokens') return { error: 'La respuesta de la IA quedó incompleta. Prueba con una foto de menos líneas.', status: 502 };
  const textBlock = Array.isArray(data && data.content) ? data.content.find((b) => b && b.type === 'text') : null;
  let parsed;
  try { parsed = JSON.parse(textBlock ? textBlock.text : ''); } catch (_) { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return { error: 'La respuesta de la IA no se pudo leer. Intenta de nuevo.', status: 502 };
  const u = (data && data.usage) || {};
  return { parsed, usage: { input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0 } };
}

function clampInt(v, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; }
function cleanCurrency(v) { const c = String(v || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : 'USD'; }

// POST /product/invoice { token, image (base64, ≤ 600 KB), mediaType }
//   → { ok, lines: [{ description, quantity, unit_cost, currency }], usage }
async function handleProductInvoice(body, env, origin) {
  const img = inventoryImage(body.image, body.mediaType, INVOICE_MAX_BYTES);
  if (img.error) return err(img.error, 400, origin);
  if (!env.ANTHROPIC_API_KEY) return err('Leer facturas con IA no está activado (falta ANTHROPIC_API_KEY en el Worker).', 503, origin);
  if (!(await rateLimit(env, 'invoice', 'all', INVOICE_DAILY_MAX, 86400))) {
    return err(`Se alcanzó el límite de ${INVOICE_DAILY_MAX} facturas leídas con IA de hoy. Mañana se reinicia; mientras tanto escribe el costo a mano.`, 429, origin);
  }
  const res = await inventoryAsk(env, {
    system: INVOICE_SYSTEM, maxTokens: 2000, timeoutMs: 40_000, tag: 'invoice',
    content: [img.block, { type: 'text', text: 'Extrae las líneas de productos de esta factura.' }],
    schema: {
      type: 'object',
      properties: { lines: { type: 'array', items: { type: 'object', properties: {
        description: { type: 'string' }, quantity: { type: 'integer' }, unit_cost: { type: 'number' }, currency: { type: 'string' },
      }, required: ['description', 'quantity', 'unit_cost', 'currency'], additionalProperties: false } } },
      required: ['lines'], additionalProperties: false,
    },
  });
  if (res.error) return err(res.error, res.status, origin);
  const lines = (Array.isArray(res.parsed.lines) ? res.parsed.lines : []).slice(0, INVOICE_MAX_LINES).map((l) => ({
    description: stripColorEmoji(l && l.description, 120),
    quantity: clampInt(l && l.quantity, 0, 9999),
    unit_cost: Math.round(Math.min(100000, Math.max(0, Number(l && l.unit_cost) || 0)) * 100) / 100,
    currency: cleanCurrency(l && l.currency),
  })).filter((l) => l.description);
  return ok({ ok: true, lines, model: INVENTORY_MODEL, usage: res.usage }, origin);
}

// POST /product/count { token, image (base64, ≤ 300 KB), mediaType, hint? (qué pieza contar) }
//   → { ok, count, by_color: [{ color, count }], usage }
async function handleProductCount(body, env, origin) {
  const img = inventoryImage(body.image, body.mediaType, COUNT_MAX_BYTES);
  if (img.error) return err(img.error, 400, origin);
  if (!env.ANTHROPIC_API_KEY) return err('Contar con IA no está activado (falta ANTHROPIC_API_KEY en el Worker).', 503, origin);
  const hint = stripColorEmoji(body.hint, 80);
  if (!(await rateLimit(env, 'count', 'all', COUNT_DAILY_MAX, 86400))) {
    return err(`Se alcanzó el límite de ${COUNT_DAILY_MAX} conteos con IA de hoy. Mañana se reinicia; mientras tanto cuéntalas a mano.`, 429, origin);
  }
  const res = await inventoryAsk(env, {
    system: COUNT_SYSTEM, maxTokens: 300, timeoutMs: 25_000, tag: 'count',
    content: [img.block, { type: 'text', text: (hint ? `Pieza a contar: ${hint}.\n` : '') + 'Cuenta las unidades de la foto.' }],
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        by_color: { type: 'array', items: { type: 'object', properties: { color: { type: 'string' }, count: { type: 'integer' } }, required: ['color', 'count'], additionalProperties: false } },
      },
      required: ['count', 'by_color'], additionalProperties: false,
    },
  });
  if (res.error) return err(res.error, res.status, origin);
  const by_color = (Array.isArray(res.parsed.by_color) ? res.parsed.by_color : []).slice(0, 12)
    .map((c) => ({ color: stripColorEmoji(c && c.color, 30), count: clampInt(c && c.count, 0, 9999) }))
    .filter((c) => c.color && c.count > 0);
  return ok({ ok: true, count: clampInt(res.parsed.count, 0, 9999), by_color, model: INVENTORY_MODEL, usage: res.usage }, origin);
}

// ── Costo de cada pieza (27 nov): PRIVADO, en KV (una sola llave `admin_costs`), nunca en
// data/products.json (que es público). Como el stock, se guarda al instante sin "Publicar".
// { costs: { id: { c: número, cur: 'USD', at } }, margin: número, updatedAt }.
// Una sola llave = 1 lectura para todo el panel y 1 escritura por guardado (plan gratis).
// Acepta ids de productos todavía sin publicar (formato válido) a propósito: el costo se
// carga en el ingreso por lote antes de publicar. cacusa-backup respalda esta llave.
const COSTS_KEY = 'admin_costs';
const COSTS_MAX_ENTRIES = 5000;
const COST_MAX = 100000;
const MARGIN_DEFAULT = 3;
async function costsRead(env) {
  let d = null;
  try { d = JSON.parse(await env.CACUSA_KV.get(COSTS_KEY)); } catch (_) { d = null; }
  if (!d || typeof d !== 'object' || !d.costs || typeof d.costs !== 'object') d = { costs: {} };
  return d;
}
function costsPublic(d) {
  const costs = {};
  for (const [id, v] of Object.entries(d.costs || {})) if (v && Number.isFinite(v.c)) costs[id] = { cost: v.c, currency: v.cur || 'USD' };
  const margin = Number(d.margin);
  return { costs, margin: margin >= 1 && margin <= 20 ? margin : MARGIN_DEFAULT };
}
// POST /cost/list (sesión) → { ok, costs: { id: { cost, currency } }, margin }
async function handleCostList(env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  return ok({ ok: true, ...costsPublic(await costsRead(env)) }, origin);
}
// POST /cost/set (sesión) { items: [{ id, cost (número o null = borrar), currency? }] (máx. 100)
//   | id, cost, currency | margin } → { ok, costs, margin }
async function handleCostSet(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const items = Array.isArray(body.items) ? body.items : (body.id != null ? [{ id: body.id, cost: body.cost, currency: body.currency }] : []);
  if (items.length > 100) return err('Máximo 100 costos por vez', 400, origin);
  const hasMargin = body.margin !== undefined;
  if (!items.length && !hasMargin) return err('Nada para guardar', 400, origin);
  const clean = [];
  for (const it of items) {
    const id = it && it.id != null ? String(it.id) : '';
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err('Id de producto inválido', 400, origin);
    if (it.cost === null || it.cost === '') { clean.push({ id, del: true }); continue; }
    const c = Number(it.cost);
    if (!Number.isFinite(c) || c < 0 || c > COST_MAX) return err(`El costo debe ser un número entre 0 y ${COST_MAX}`, 400, origin);
    clean.push({ id, c: Math.round(c * 100) / 100, cur: cleanCurrency(it.currency) });
  }
  let margin;
  if (hasMargin) {
    margin = Number(body.margin);
    if (!Number.isFinite(margin) || margin < 1 || margin > 20) return err('El margen debe estar entre 1 y 20', 400, origin);
    margin = Math.round(margin * 100) / 100;
  }
  const d = await costsRead(env);
  for (const x of clean) {
    if (x.del) { delete d.costs[x.id]; continue; }
    if (!d.costs[x.id] && Object.keys(d.costs).length >= COSTS_MAX_ENTRIES) return err('Se alcanzó el máximo de costos guardados', 400, origin);
    d.costs[x.id] = { c: x.c, cur: x.cur, at: new Date().toISOString() };
  }
  if (hasMargin) d.margin = margin;
  d.updatedAt = new Date().toISOString();
  const txt = JSON.stringify(d);
  try { await env.CACUSA_KV.put(COSTS_KEY, txt); }
  catch (e) { await new Promise((r) => setTimeout(r, 1100)); await env.CACUSA_KV.put(COSTS_KEY, txt); } // 1 escritura/s por llave
  console.log('cost/set', clean.length, hasMargin ? 'margen ' + margin : '', 'por', session.user);
  return ok({ ok: true, ...costsPublic(d) }, origin);
}

async function handleIdentifyRefAdd(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.id != null ? String(body.id) : '';
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err('Id de producto inválido', 400, origin);
  const vector = typeof body.vector === 'string' ? body.vector.trim() : '';
  if (base64DecodedSize(vector) !== IDENTIFY_REF_DIM) return err(`Vector inválido (se esperan ${IDENTIFY_REF_DIM} bytes en base64)`, 400, origin);
  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo leer el catálogo. Intenta de nuevo en un momento.', 502, origin);
  if (!catalog.products.some((p) => p && String(p.id) === id)) return err('Producto no encontrado en el catálogo', 400, origin);
  const data = await identifyRefsRead(env);
  const list = Array.isArray(data.refs[id]) ? data.refs[id] : [];
  if (!list.length && Object.keys(data.refs).length >= IDENTIFY_REFS_MAX_PRODUCTS) {
    return err('Se alcanzó el máximo de productos con referencias guardadas', 400, origin);
  }
  list.push(vector);
  data.refs[id] = list.slice(-IDENTIFY_REFS_PER_PRODUCT); // se quedan las 10 más recientes
  await identifyRefsWrite(env, data);
  return ok({ ok: true, id, count: data.refs[id].length }, origin);
}
// POST /identify/ref/clear (sesión) { id } — borra las referencias aprendidas de un producto.
async function handleIdentifyRefClear(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.id != null ? String(body.id) : '';
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err('Id de producto inválido', 400, origin);
  const data = await identifyRefsRead(env);
  const had = Array.isArray(data.refs[id]) ? data.refs[id].length : 0;
  if (had) { delete data.refs[id]; await identifyRefsWrite(env, data); }
  return ok({ ok: true, id, removed: had }, origin);
}


// ── Inventario / stock (18 nov) ──────────────────────────────────────────────────────
// Vive en KV (stock:<id> = entero en texto), NO en data/products.json: el panel publica el
// catálogo entero y pisaría lo que escriba este Worker. Decisión del usuario: TODO producto
// tiene 1 unidad por defecto — una llave que no existe vale 1 (no hay "sin control").
// Descuentan: pedidos nuevos de la tienda (Square/Zelle/WhatsApp, solo la 1ra vez, nunca un
// reintento), pedidos manuales con ids del catálogo y piezas cargadas en cajas de Lovers.
// Cada pedido anota lo que descontó en stockApplied {id: cantidad}; cancelarlo lo devuelve
// UNA vez (pasa a stockRestored). Volver a activar un pedido cancelado NO vuelve a
// descontar (habría que ajustar el stock a mano en el panel).
// (Wave 1: ya no es leer→escribir sin lock — ver stockApply() y la ruta /stock de la DO.)
// stock_soldout = lista derivada de ids agotados (la lee /pub/stock con UN solo get; nunca
// se hace list() en una ruta pública: el plan gratis tiene 1.000 list/día). Se reescribe
// solo cuando cambia la lista, y /stock/list (panel) la repara si quedó desfasada.
const STOCK_DEFAULT = 1;
const STOCK_MAX = 9999;
const STOCK_SOLDOUT_KEY = 'stock_soldout';
function stockKey(id) { return 'stock:' + String(id); }
function stockParse(raw) {
  if (raw == null) return STOCK_DEFAULT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : STOCK_DEFAULT;
}
// Wave 1 — movimientos de stock atómicos + historial. Antes /stock/set escribía un valor absoluto
// (el que el panel tenía en pantalla) y una venta que descontaba al mismo tiempo se perdía; y las
// ventas/cancelaciones hacían leer→calcular→escribir sobre KV sin ningún lock. Ahora TODO cambio de
// stock (panel, ventas, cancelaciones, piezas de Lovers, archivar/restaurar) pasa por UNA instancia
// de la DO GiftCardLedger ("stock:ledger", ruta /stock): Cloudflare serializa sus requests y además
// una cola en memoria encadena cada operación completa (incluido el espejo en KV), así que dos
// movimientos nunca se pisan. La DO guarda el valor autoritativo (s:<id>) y el historial compacto
// (log:<id>, últimos STOCK_LOG_MAX movimientos) en su storage SQLite — 0 escrituras extra de KV.
// stock:<id> en KV sigue siendo el espejo que leen /pub/stock (vía stock_soldout), el respaldo
// diario y los Workers viejos. Sin el binding de la DO, cae al camino viejo (no atómico, sin log).
// OJO al restaurar stock:* desde un respaldo: la DO ya tiene su propio valor para cada pieza que
// tocó; después de restaurar KV, fijar cada cantidad desde el panel (pasa por la DO).
const STOCK_LEDGER_NAME = 'stock:ledger';
const STOCK_LOG_MAX = 40;
const STOCK_ADJUST_MAX_ITEMS = 50;
function stockLedgerStub(env) {
  if (!env || !env.GIFT_CARD_LEDGER) return null;
  return env.GIFT_CARD_LEDGER.get(env.GIFT_CARD_LEDGER.idFromName(STOCK_LEDGER_NAME));
}
async function stockLedgerCall(env, payload) {
  const stub = stockLedgerStub(env);
  if (!stub) return null;
  const r = await stub.fetch('https://gc/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || ('stock ledger ' + r.status));
  return d;
}
function stockReasonClean(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
// Lectura del stock efectivo (autoridad = DO; lo que la DO nunca tocó sale del espejo en KV).
async function stockGetMany(env, ids) {
  const uniq = [...new Set(ids.map(String))];
  const out = new Map();
  if (!uniq.length) return out;
  try {
    const d = await stockLedgerCall(env, { op: 'get', ids: uniq });
    if (d && d.stock) { for (const id of uniq) out.set(id, Number.isFinite(d.stock[id]) ? d.stock[id] : STOCK_DEFAULT); return out; }
  } catch (e) { console.error('stock get (DO):', e.message); }
  const raws = await kvGetMany(env, uniq.map(stockKey));
  for (const id of uniq) out.set(id, stockParse(raws.get(stockKey(id))));
  return out;
}
// Aplica movimientos [{id, delta} | {id, set}] de forma atómica. Devuelve
// {results:[{id, before, after, delta, oversold}], oversold:{id: n}, logged}.
// opId (opcional) hace la operación idempotente: un reintento con el mismo opId no la repite.
async function stockApply(env, items, { by = '', reason = '', ref = '', opId = '' } = {}) {
  const clean = items.map((it) => ({
    id: String(it.id),
    ...(it.set != null ? { set: Math.min(STOCK_MAX, Math.max(0, Math.round(it.set))) } : { delta: Math.round(Number(it.delta) || 0) }),
    reason: stockReasonClean(it.reason || reason),
  })).filter((it) => it.set != null || it.delta !== 0);
  if (!clean.length) return { results: [], oversold: {}, logged: false };
  try {
    const d = await stockLedgerCall(env, { op: 'adjust', items: clean, by: String(by || '').slice(0, 40), ref: String(ref || '').slice(0, 60), opId: String(opId || '').slice(0, 120) });
    if (d) return { results: d.results || [], oversold: d.oversold || {}, logged: true, replay: !!d.replay };
  } catch (e) {
    // Si la DO existe pero falló, no se cae a KV a ciegas: podría duplicar un movimiento que la DO
    // sí aplicó antes de fallar. Se propaga el error (el caller avisa / el panel reintenta con opId).
    if (stockLedgerStub(env)) throw e;
  }
  // Camino viejo (sin binding de DO): leer→calcular→escribir en KV, sin lock ni historial.
  const ids = [...new Set(clean.map((it) => it.id))];
  const raws = await kvGetMany(env, ids.map(stockKey));
  const cur = new Map(ids.map((id) => [id, stockParse(raws.get(stockKey(id)))]));
  const results = [], oversold = {};
  for (const it of clean) {
    const before = cur.get(it.id);
    const want = it.set != null ? it.set : before + it.delta;
    if (want < 0) oversold[it.id] = (oversold[it.id] || 0) - want;
    const after = Math.min(STOCK_MAX, Math.max(0, want));
    cur.set(it.id, after);
    results.push({ id: it.id, before, after, delta: after - before, oversold: want < 0 ? -want : 0 });
  }
  const finals = Object.fromEntries(cur);
  for (const [id, q] of Object.entries(finals)) await env.CACUSA_KV.put(stockKey(id), String(q));
  await stockSoldoutSync(env, finals).catch((e) => console.error('stock_soldout:', e.message));
  return { results, oversold, logged: false };
}
// Calcula (sin escribir) el resultado de aplicar deltas {id: ±n} — solo para anotar en el pedido
// stockApplied/stockOversold ANTES de guardarlo; el movimiento real lo hace stockCommit() después.
async function stockPlan(env, deltas) {
  const ids = Object.keys(deltas).filter((id) => Number.isFinite(deltas[id]) && deltas[id] !== 0);
  const before = ids.length ? await stockGetMany(env, ids) : new Map();
  const next = {}, oversold = {}, clean = {};
  for (const id of ids) {
    const cur = before.get(id), want = cur + deltas[id];
    if (want < 0) oversold[id] = -want;
    next[id] = Math.min(STOCK_MAX, Math.max(0, want));
    clean[id] = deltas[id];
  }
  return { before, next, oversold, deltas: clean };
}
async function stockSoldoutSync(env, changes) {
  // changes: {id: nuevoStock}. Solo escribe si cambia la pertenencia a la lista.
  const write = async () => {
    let cur = { ids: [] };
    try { cur = JSON.parse(await env.CACUSA_KV.get(STOCK_SOLDOUT_KEY)) || cur; } catch (_) {}
    const set = new Set((cur.ids || []).map(String));
    let changed = false;
    for (const [id, qty] of Object.entries(changes)) {
      if (qty <= 0 && !set.has(id)) { set.add(id); changed = true; }
      if (qty > 0 && set.has(id)) { set.delete(id); changed = true; }
    }
    if (changed) await env.CACUSA_KV.put(STOCK_SOLDOUT_KEY, JSON.stringify({ ids: [...set], updatedAt: new Date().toISOString() }));
  };
  try { await write(); }
  catch (e) { await new Promise((r) => setTimeout(r, 1100)); await write(); } // 1 escritura/s por llave
}
async function stockOversoldAlert(env, oversold, names = {}) {
  const over = Object.keys(oversold || {});
  if (!over.length) return;
  const label = over.map((id) => sanitizePushText(names[id] || ('id ' + id))).join(', ').slice(0, 120);
  console.warn('stock: vendido sin stock', over.join(','));
  await adminPush(env, 'CACUSA · Vendido sin stock', 'Vendido sin stock: ' + label, 'cacusa-stock', 'high');
  if (env.NTFY_TOPIC) {
    try {
      await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, { method: 'POST',
        headers: { 'Title': 'CACUSA · Vendido sin stock', 'Priority': 'high', 'Tags': 'warning', 'Click': ADMIN_URL, 'Content-Type': 'text/plain; charset=utf-8' },
        body: 'Vendido sin stock: ' + label });
    } catch (e) { console.error('ntfy stock:', e.message); }
  }
}
// Confirma un plan como MOVIMIENTOS (deltas), no como valores absolutos: así una venta, una
// cancelación y un ajuste del panel que llegan casi juntos se suman en vez de pisarse.
async function stockCommit(env, plan, names = {}, meta = {}) {
  const deltas = plan.deltas || Object.fromEntries(Object.entries(plan.next).map(([id, q]) => [id, q - (plan.before.get(id) || 0)]));
  const items = Object.entries(deltas).map(([id, delta]) => ({ id, delta }));
  const res = await stockApply(env, items, { reason: meta.reason || 'Pedido', by: meta.by || '', ref: meta.ref || '', opId: meta.opId || '' });
  if (!res.replay) await stockOversoldAlert(env, res.oversold, names);
  return res;
}
// Plan para un pedido nuevo: cuenta solo líneas cuyo id es un producto del catálogo
// (los combos y las líneas a mano sin id no tienen stock propio).
function stockDeltasForLines(productos, catalogProducts) {
  const known = new Set((catalogProducts || []).map((p) => String(p.id)));
  const applied = {}, names = {};
  for (const p of productos || []) {
    const id = p && p.id != null ? String(p.id) : '';
    if (!id || !known.has(id)) continue;
    const qty = Number.isFinite(p.qty) ? Math.max(1, Math.floor(p.qty)) : 1;
    applied[id] = (applied[id] || 0) + qty;
    names[id] = p.name || names[id];
  }
  return { applied, names };
}
// Antes de guardar un pedido nuevo: deja order.stockApplied (y stockOversold si aplica) y
// devuelve el plan para confirmarlo (stockCommit) DESPUÉS de que el pedido se guardó.
// Nunca bloquea el pedido: si el catálogo no responde, el pedido se guarda sin descontar
// y se avisa por push para ajustar a mano.
async function stockPrepareNewOrder(env, order, catalog) {
  try {
    const cat = catalog || await fetchCatalogForOrderValidation();
    if (!cat) { order.stockPending = true; return null; }
    const { applied, names } = stockDeltasForLines(order.productos, cat.products);
    if (!Object.keys(applied).length) return null;
    const deltas = {};
    for (const [id, q] of Object.entries(applied)) deltas[id] = -q;
    const plan = await stockPlan(env, deltas);
    order.stockApplied = applied;
    if (Object.keys(plan.oversold).length) order.stockOversold = plan.oversold;
    plan.names = names;
    return plan;
  } catch (e) {
    console.error('stock (pedido nuevo):', e.message);
    order.stockPending = true;
    return null;
  }
}
async function stockFinishNewOrder(env, order, plan) {
  if (order.stockPending) {
    await adminPush(env, 'CACUSA · Stock sin descontar', `No se pudo descontar el stock del pedido ${sanitizePushText(order.numero || order.id)} (catálogo no disponible). Ajústalo a mano.`, 'cacusa-stock', 'normal');
    return;
  }
  if (plan) await stockCommit(env, plan, plan.names, { reason: 'Venta', by: order.createdBy || 'tienda', ref: orderStockRef(order), opId: 'ordnew:' + order.id })
    .catch((e) => console.error('stock commit:', e.message));
}

// GET /pub/stock — para la tienda. Solo los ids agotados, nunca cantidades.
async function handlePubStock(env, origin) {
  let data = { ids: [], updatedAt: null };
  if (env.CACUSA_KV) { try { data = JSON.parse(await env.CACUSA_KV.get(STOCK_SOLDOUT_KEY)) || data; } catch (_) {} }
  return new Response(JSON.stringify({ soldOut: (data.ids || []).map(String), updatedAt: data.updatedAt || null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...cors(origin), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}
// POST /stock/list (sesión) — stock efectivo de TODOS los productos del catálogo (sin llave = 1).
async function handleStockList(env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo leer el catálogo. Intenta de nuevo en un momento.', 502, origin);
  const ids = catalog.products.filter((p) => p && p.id != null).map((p) => String(p.id));
  const map = ids.length ? await stockGetMany(env, ids) : new Map();
  const stock = {};
  for (const id of ids) stock[id] = map.get(id);
  // Repara stock_soldout si quedó desfasada (ej. una escritura que falló).
  await stockSoldoutSync(env, stock).catch(() => {});
  return ok({ ok: true, stock, default: STOCK_DEFAULT }, origin);
}
// POST /stock/set (sesión) { id, qty } — entero 0..9999, id del catálogo. Fija un valor absoluto
// (lo siguen usando "Sí, es el mismo", el ingreso por lote y los paneles viejos); queda en el historial.
async function handleStockSet(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const id = body.id != null ? String(body.id) : '';
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err('Id de producto inválido', 400, origin);
  const qty = body.qty;
  if (!Number.isInteger(qty) || qty < 0 || qty > STOCK_MAX) return err(`El stock debe ser un número entero entre 0 y ${STOCK_MAX}`, 400, origin);
  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo leer el catálogo. Intenta de nuevo en un momento.', 502, origin);
  if (!catalog.products.some((p) => p && String(p.id) === id)) return err('Producto no encontrado en el catálogo publicado (si es nuevo, publícalo primero)', 400, origin);
  const res = await stockApply(env, [{ id, set: qty }], { by: session.user, reason: stockReasonClean(body.reason) || 'Ajuste (cantidad fija)' });
  console.log('stock/set', id, qty, 'por', session.user);
  return ok({ ok: true, id, qty: res.results[0] ? res.results[0].after : qty }, origin);
}
// POST /stock/adjust (sesión) { items:[{id, delta, reason}], opId? } — movimientos relativos
// (+3 llegaron, −1 rota…) aplicados juntos y de forma atómica. opId (del panel) hace que un
// reintento por un corte de red no sume dos veces. Devuelve el stock resultante de cada pieza.
async function handleStockAdjust(body, env, origin, session) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) return err('Faltan los movimientos (items)', 400, origin);
  if (items.length > STOCK_ADJUST_MAX_ITEMS) return err(`Máximo ${STOCK_ADJUST_MAX_ITEMS} movimientos por vez`, 400, origin);
  const clean = [];
  for (const it of items) {
    const id = it && it.id != null ? String(it.id) : '';
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err('Id de producto inválido', 400, origin);
    const delta = it.delta;
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > STOCK_MAX) return err(`El movimiento debe ser un entero distinto de 0 (máx. ±${STOCK_MAX})`, 400, origin);
    clean.push({ id, delta, reason: stockReasonClean(it.reason) || (delta > 0 ? 'Ajuste (+)' : 'Ajuste (−)') });
  }
  const opId = typeof body.opId === 'string' && /^[A-Za-z0-9_:.-]{8,100}$/.test(body.opId) ? 'panel:' + body.opId : '';
  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo leer el catálogo. Intenta de nuevo en un momento.', 502, origin);
  const known = new Set(catalog.products.filter((p) => p && p.id != null).map((p) => String(p.id)));
  const missing = clean.find((it) => !known.has(it.id));
  if (missing) return err('Producto no encontrado en el catálogo publicado (si es nuevo, publícalo primero)', 400, origin);
  const res = await stockApply(env, clean, { by: session.user, opId });
  const stock = {};
  for (const r of res.results) stock[r.id] = r.after;
  return ok({ ok: true, stock, results: res.results, logged: res.logged, replay: !!res.replay }, origin);
}
// POST /stock/history (sesión) { id, limit? } — últimos movimientos de UNA pieza (más nuevo primero):
// [{t, by, d, r, q, ref}] = cuándo, quién, cuánto, motivo, stock resultante y pedido (si aplica).
async function handleStockHistory(body, env, origin) {
  const id = body.id != null ? String(body.id) : '';
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(id)) return err('Id de producto inválido', 400, origin);
  const limit = Math.min(STOCK_LOG_MAX, Math.max(1, Number.isInteger(body.limit) ? body.limit : STOCK_LOG_MAX));
  let d = null;
  try { d = await stockLedgerCall(env, { op: 'history', id, limit }); }
  catch (e) { console.error('stock history:', e.message); return err('No se pudo leer el historial', 502, origin); }
  if (!d) return ok({ ok: true, id, items: [], unavailable: true }, origin);
  return ok({ ok: true, id, items: d.items || [] }, origin);
}

// ── Reseñas de producto vía Worker (wave 1) ─────────────────────────────────────────────
// Antes la tienda escribía y leía cacusa_reviews DIRECTO en Firebase (regla pública: cualquiera
// leía TODAS las reseñas, también las no aprobadas, y creaba sin límite). Ahora:
//   POST /review/submit (pública, Origin + rateLimit) → crea la reseña con approved:false
//   GET|POST /pub/reviews (pública, caché 300 s)     → solo aprobadas, desde una copia en KV
//   POST /reviews/list y /reviews/moderate (sesión)  → lo que usa el panel para moderar
// Con esto la regla de Firebase de cacusa_reviews puede quedar en .read/.write false (el Worker
// usa FB_DB_SECRET, que la ignora por diseño). Variables nuevas en ESTE Worker: FB_DB_SECRET
// (secret, mismo valor que en cacusa-lovers-webhook y cacusa-backup) y FB_DB_URL (opcional).
// KV: una sola llave, reviews_pub, que se reescribe al moderar desde el panel y, como mucho, una
// vez por hora si alguien la pide vieja (por reseñas moderadas desde un panel viejo) — ~24
// escrituras/día en el peor caso, nunca una por visita.
const REVIEWS_PUB_KEY = 'reviews_pub';
const REVIEWS_PUB_MAX_AGE_MS = 60 * 60 * 1000;
const REVIEWS_PUB_ITEMS_MAX = 200; // el CI calcula reviewCount con items.length: no recortar de menos
const REVIEW_NAME_MAX = 60;
const REVIEW_COMMENT_MAX = 1000;
const REVIEW_IP_PER_HOUR = 3;
const REVIEW_GLOBAL_PER_DAY = 200;
const REVIEW_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function fbConf(env) {
  if (!env.FB_DB_SECRET) return null;
  return { url: String(env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com').replace(/\/+$/, ''), auth: env.FB_DB_SECRET };
}
function fbRef(c, path) { return `${c.url}/${path}.json?auth=${encodeURIComponent(c.auth)}`; }
function reviewText(v, max) {
  return stripColorEmoji(String(v == null ? '' : v).replace(/[\u0080-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069]+/g, ' '), max);
}
function reviewDateOk(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; }
// Lo que la tienda publica: aprobadas (approved !== false: las reseñas anteriores a la moderación,
// sin el campo, siempre fueron visibles — mismo criterio de los otros consumidores).
function reviewsPublicSnapshot(tree) {
  const byProduct = {};
  for (const [pid, revs] of Object.entries(tree && typeof tree === 'object' ? tree : {})) {
    if (!REVIEW_KEY_RE.test(pid) || !revs || typeof revs !== 'object') continue;
    const items = [];
    for (const v of Object.values(revs)) {
      if (!v || typeof v !== 'object' || v.approved === false || !v.comment) continue;
      const rating = Math.min(5, Math.max(1, Math.round(Number(v.rating) || 5)));
      items.push({
        name: reviewText(v.name, REVIEW_NAME_MAX) || 'Anónimo',
        rating,
        comment: reviewText(v.comment, REVIEW_COMMENT_MAX),
        date: reviewDateOk(v.date),
        lang: v.lang === 'en' ? 'en' : 'es',
      });
    }
    if (!items.length) continue;
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const avg = Math.round((items.reduce((s, x) => s + x.rating, 0) / items.length) * 100) / 100;
    byProduct[pid] = { avg, count: items.length, items: items.slice(0, REVIEWS_PUB_ITEMS_MAX) };
  }
  return byProduct;
}
async function reviewsFetchTree(env, productId) {
  const c = fbConf(env);
  if (!c) throw new Error('FB_DB_SECRET no configurado en cacusa-admin');
  const r = await fetch(fbRef(c, 'cacusa_reviews' + (productId ? '/' + productId : '')));
  if (!r.ok) throw new Error('Firebase ' + r.status);
  return (await r.json()) || {};
}
async function reviewsRebuild(env) {
  const byProduct = reviewsPublicSnapshot(await reviewsFetchTree(env));
  const data = { updatedAt: new Date().toISOString(), byProduct };
  const raw = JSON.stringify(data);
  try { await env.CACUSA_KV.put(REVIEWS_PUB_KEY, raw); }
  catch (_) { await new Promise((r) => setTimeout(r, 1100)); await env.CACUSA_KV.put(REVIEWS_PUB_KEY, raw); } // 1 escritura/s por llave
  return data;
}
async function handlePubReviews(env, origin) {
  let data = null;
  if (env.CACUSA_KV) { try { data = JSON.parse(await env.CACUSA_KV.get(REVIEWS_PUB_KEY)); } catch (_) { data = null; } }
  const stale = !data || !(Date.now() - Date.parse(data.updatedAt) < REVIEWS_PUB_MAX_AGE_MS);
  // Rehacer la copia como mucho 1 vez cada 2 min aunque lleguen muchas visitas a la vez (el
  // candado vive en la DO, no en KV); el resto sirve la copia vieja mientras tanto.
  if (stale && env.CACUSA_KV && fbConf(env) && (await rateLimit(env, 'revsnap', 'rebuild', 1, 120))) {
    try { data = await reviewsRebuild(env); } catch (e) { console.error('pub/reviews rebuild:', e.message); }
  }
  if (!data || !data.byProduct) return err('Reseñas no disponibles por ahora', 503, origin);
  return new Response(JSON.stringify({ ok: true, byProduct: data.byProduct, updatedAt: data.updatedAt || null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...cors(origin), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}
// POST /review/submit {productId, name, rating, comment, lang} — pública.
async function handleReviewSubmit(body, env, origin, request) {
  const productId = body.productId != null ? String(body.productId) : '';
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(productId)) return err('Producto inválido', 400, origin);
  const name = reviewText(body.name, REVIEW_NAME_MAX);
  const comment = reviewText(body.comment, REVIEW_COMMENT_MAX);
  const rating = body.rating;
  if (!name) return err('Falta tu nombre', 400, origin);
  if (!comment) return err('Falta el comentario', 400, origin);
  if (String(body.name || '').trim().length > REVIEW_NAME_MAX * 2 || String(body.comment || '').length > REVIEW_COMMENT_MAX * 2) return err('Texto demasiado largo', 400, origin);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err('La calificación debe ser de 1 a 5', 400, origin);
  const lang = body.lang === 'en' ? 'en' : 'es';
  const c = fbConf(env);
  if (!c) return err('Reseñas no disponibles por ahora', 503, origin);
  if (!(await rateLimit(env, 'review-ip', clientIp(request), REVIEW_IP_PER_HOUR, 3600))) return err('Demasiadas reseñas seguidas. Intenta más tarde.', 429, origin);
  if (!(await rateLimit(env, 'review-day', new Date().toISOString().slice(0, 10), REVIEW_GLOBAL_PER_DAY, 86400))) return err('Demasiadas reseñas hoy. Intenta mañana.', 429, origin);
  const catalog = await fetchCatalogForOrderValidation();
  if (!catalog) return err('No se pudo validar el producto. Intenta de nuevo en un momento.', 502, origin);
  const prod = catalog.products.find((p) => p && String(p.id) === productId);
  if (!prod) return err('Producto no encontrado', 400, origin);
  // Misma forma que escribía la tienda (name, rating, comment, approved:false, date YYYY-MM-DD)
  // + lang. approved:false: no se muestra hasta que Tita o Robin la aprueben en el panel.
  const review = { name, rating, comment, approved: false, date: new Date().toISOString().slice(0, 10), lang };
  const r = await fetch(fbRef(c, 'cacusa_reviews/' + productId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review) });
  if (!r.ok) { console.error('review submit Firebase', r.status); return err('No se pudo guardar la reseña. Intenta de nuevo.', 502, origin); }
  await adminPush(env, 'CACUSA · Reseña por aprobar', `${sanitizePushText(name)} · ${rating}/5 · ${sanitizePushText(prod.name)}`, 'cacusa-review', 'normal');
  return ok({ ok: true }, origin);
}
// POST /reviews/list (sesión) {productId?} — TODAS las reseñas (también las pendientes) de un
// producto, o de todo el catálogo si no viene productId.
async function handleReviewsList(body, env, origin) {
  const productId = body.productId != null && body.productId !== '' ? String(body.productId) : '';
  if (productId && !/^[A-Za-z0-9_-]{1,50}$/.test(productId)) return err('Producto inválido', 400, origin);
  if (!fbConf(env)) return err('FB_DB_SECRET no configurado en cacusa-admin', 503, origin);
  let tree;
  try { tree = await reviewsFetchTree(env, productId); } catch (e) { return err('No se pudieron leer las reseñas (' + e.message + ')', 502, origin); }
  const asList = (revs) => Object.entries(revs && typeof revs === 'object' ? revs : {})
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => ({ key, name: String(v.name || ''), rating: Number(v.rating) || 0, comment: String(v.comment || ''), date: String(v.date || ''), approved: v.approved, lang: v.lang === 'en' ? 'en' : 'es' }));
  if (productId) return ok({ ok: true, productId, reviews: asList(tree) }, origin);
  const byProduct = {};
  for (const [pid, revs] of Object.entries(tree || {})) if (REVIEW_KEY_RE.test(pid)) byProduct[pid] = asList(revs);
  return ok({ ok: true, byProduct }, origin);
}
// POST /reviews/moderate (sesión) {productId, reviewId, action:'approve'|'delete'} — y rehace la
// copia pública en el momento (la tienda la ve en ≤5 min por la caché del navegador/CDN).
async function handleReviewsModerate(body, env, origin, session) {
  const productId = body.productId != null ? String(body.productId) : '';
  const reviewId = body.reviewId != null ? String(body.reviewId) : '';
  if (!REVIEW_KEY_RE.test(productId) || !REVIEW_KEY_RE.test(reviewId)) return err('Reseña inválida', 400, origin);
  if (body.action !== 'approve' && body.action !== 'delete') return err('Acción inválida', 400, origin);
  const c = fbConf(env);
  if (!c) return err('FB_DB_SECRET no configurado en cacusa-admin', 503, origin);
  const url = fbRef(c, `cacusa_reviews/${productId}/${reviewId}`);
  if (body.action === 'approve') {
    const cur = await fetch(url);
    if (!cur.ok) return err('No se pudo leer la reseña', 502, origin);
    if (!(await cur.json())) return err('Reseña no encontrada', 404, origin);
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true }) });
    if (!r.ok) return err('No se pudo aprobar la reseña', 502, origin);
  } else {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) return err('No se pudo eliminar la reseña', 502, origin);
  }
  console.log('reseña', body.action, productId, reviewId, 'por', session.user);
  let refreshed = false;
  if (env.CACUSA_KV) { try { await reviewsRebuild(env); refreshed = true; } catch (e) { console.error('reviews rebuild (moderar):', e.message); } }
  return ok({ ok: true, refreshed }, origin);
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

  // ── Stock (wave 1) — solo en la instancia "stock:ledger" ─────────────────────────
  // s:<id> = stock autoritativo (entero); log:<id> = últimos movimientos; ops = opIds ya aplicados.
  async _stockGetMany(ids) {
    const out = {};
    const keys = ids.map((id) => 's:' + id);
    for (let i = 0; i < keys.length; i += 128) {
      const m = await this.state.storage.get(keys.slice(i, i + 128));
      for (const [k, v] of m) if (Number.isFinite(v)) out[k.slice(2)] = v;
    }
    const missing = ids.filter((id) => !(id in out));
    if (missing.length && this.env.CACUSA_KV) {
      // Primera vez que la DO ve estas piezas: migración perezosa desde el espejo en KV.
      for (let i = 0; i < missing.length; i += 100) {
        const part = missing.slice(i, i + 100);
        let res = null;
        if (part.length > 1) { try { res = await this.env.CACUSA_KV.get(part.map(stockKey)); } catch (_) { res = null; } }
        for (const id of part) {
          const raw = res instanceof Map ? res.get(stockKey(id)) : await this.env.CACUSA_KV.get(stockKey(id));
          out[id] = stockParse(raw == null ? null : raw);
        }
      }
    }
    for (const id of ids) if (!(id in out)) out[id] = STOCK_DEFAULT;
    return out;
  }

  async _stockOp(body) {
    const op = body.op;
    if (op === 'get') {
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String))].slice(0, 2000);
      return { ok: true, stock: await this._stockGetMany(ids) };
    }
    if (op === 'history') {
      const log = (await this.state.storage.get('log:' + String(body.id))) || [];
      const limit = Math.max(1, Math.min(STOCK_LOG_MAX, Number(body.limit) || STOCK_LOG_MAX));
      return { ok: true, items: log.slice(-limit).reverse() };
    }
    if (op !== 'adjust') return { ok: false, error: 'op desconocida' };
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200);
    const now = Date.now();
    const opId = String(body.opId || '');
    let ops = null;
    if (opId) {
      ops = (await this.state.storage.get('ops')) || {};
      if (ops[opId]) return { ok: true, replay: true, results: ops[opId].results || [], oversold: {} };
    }
    const ids = [...new Set(items.map((it) => String(it.id)))];
    const cur = await this._stockGetMany(ids);
    const results = [], oversold = {};
    for (const it of items) {
      const id = String(it.id);
      const before = cur[id];
      const want = it.set != null ? Math.round(Number(it.set)) : before + Math.round(Number(it.delta) || 0);
      if (!Number.isFinite(want)) continue;
      if (want < 0) oversold[id] = (oversold[id] || 0) - want;
      const after = Math.min(STOCK_MAX, Math.max(0, want));
      cur[id] = after;
      results.push({ id, before, after, delta: after - before, oversold: want < 0 ? -want : 0, reason: String(it.reason || '').slice(0, 60) });
    }
    // Storage de la DO (autoridad + historial) en una sola transacción.
    const by = String(body.by || '').slice(0, 40), ref = String(body.ref || '').slice(0, 60);
    const logs = await this.state.storage.get(ids.map((id) => 'log:' + id));
    const writes = {};
    for (const id of ids) writes['s:' + id] = cur[id];
    for (const r of results) {
      const k = 'log:' + r.id;
      const arr = writes[k] || (logs.get(k) || []).slice();
      arr.push({ t: new Date(now).toISOString(), by, d: r.delta, r: r.reason, q: r.after, ...(ref ? { ref } : {}), ...(r.oversold ? { over: r.oversold } : {}) });
      writes[k] = arr.slice(-STOCK_LOG_MAX);
    }
    if (ops) {
      for (const [k, v] of Object.entries(ops)) if (now - (v.t || 0) > 3 * 86400000) delete ops[k];
      const keys = Object.keys(ops);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete ops[k];
      ops[opId] = { t: now, results: results.map(({ reason, ...x }) => x) };
      writes.ops = ops;
    }
    const entries = Object.entries(writes);
    for (let i = 0; i < entries.length; i += 128) await this.state.storage.put(Object.fromEntries(entries.slice(i, i + 128)));
    // Espejo en KV (lo leen /pub/stock vía stock_soldout, el respaldo y Workers viejos). KV acepta
    // 1 escritura/s por llave: un reintento pasado ese segundo. Si igual falla, la DO ya tiene el
    // valor real y el próximo movimiento o /stock/list lo vuelve a sincronizar.
    if (this.env.CACUSA_KV) {
      const finals = {};
      for (const id of ids) finals[id] = cur[id];
      for (const id of ids) {
        try { await this.env.CACUSA_KV.put(stockKey(id), String(cur[id])); }
        catch (_) {
          await new Promise((r) => setTimeout(r, 1100));
          try { await this.env.CACUSA_KV.put(stockKey(id), String(cur[id])); } catch (e) { console.error('stock espejo KV', id, e.message); }
        }
      }
      await stockSoldoutSync(this.env, finals).catch((e) => console.error('stock_soldout:', e.message));
    }
    return { ok: true, results: results.map(({ reason, ...x }) => x), oversold };
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

    // Stock (wave 1): SOLO la instancia "stock:ledger" (ver stockApply()). Cada operación corre
    // entera dentro de una cola en memoria (incluido el espejo en KV), así que nunca se intercalan.
    if (url.pathname === '/stock') {
      const run = () => this._stockOp(body);
      const p = (this._stockChain || Promise.resolve()).then(run, run);
      this._stockChain = p.catch(() => {});
      try { return Response.json(await p); }
      catch (e) { console.error('stock DO:', e && e.message); return Response.json({ ok: false, error: 'stock: ' + (e && e.message) }, { status: 500 }); }
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
${order.descuento > 0 ? totalsRow(lang === 'en' ? 'Discount' : 'Descuento', -order.descuento).replace('$-', '−$') : ''}
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
  if (email) await clearPendingCart(email, env).catch(() => {});
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
  // Sin espacios: Click-N-Ship muestra el número en bloques ("9234 6900 …") y se pega así.
  const trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(String(order.tracking).replace(/\s+/g, ''))}`;
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
// client_credentials, siempre contra producción (apis.usps.com). Comprar guías exige además
// USPS_ENV = 'prod' (ver handleUspsLabel).
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
// 20 oct: solo producción. El servidor de pruebas de USPS (apis-tem) se quitó por completo
// para que ningún módulo de prueba comparta credenciales/tokens con producción.
function uspsBaseUrl() {
  return 'https://apis.usps.com';
}
// Caché de tokens (10 oct): USPS aprobó Shipping Suite 0 con un límite de 50 llamadas
// por día y pide expresamente NO regenerar el OAuth token ni el payment token en cada
// llamada (ambos valen 8 h). Se guardan en KV con un margen antes de que venzan. La
// clave incluye el ambiente (tem/prod) y un hash del Consumer Key, así un cambio de
// credenciales o de ambiente nunca reusa un token viejo. Sin KV, se piden cada vez.
async function uspsTokenKey(env, kind) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(env.USPS_CONSUMER_KEY || '')));
  const hex = [...new Uint8Array(h)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  return `uspstok:${kind}:prod:${hex}`;
}
async function uspsClearTokens(env) {
  if (!env.CACUSA_KV) return;
  await env.CACUSA_KV.delete(await uspsTokenKey(env, 'oauth'));
  await env.CACUSA_KV.delete(await uspsTokenKey(env, 'pay'));
}
// Corre fn(oauthToken, paymentToken) con el token guardado; si USPS responde 401 (token
// revocado antes de tiempo), limpia el caché y reintenta UNA vez con tokens nuevos.
// 20 oct: un 403 ya no borra el token guardado — solo se guardan tokens que traen la cuenta
// (ver uspsGetOAuth), así que un 403 con uno guardado es por otra cosa y se muestra tal cual
// (antes se borraba y se pedía otro, que podía venir vacío y dejar el panel sin cuenta).
async function uspsWithTokens(env, needPayment, fn, accion = 'guía') {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await uspsGetOAuth(env);
    try {
      const paymentToken = needPayment ? await uspsPaymentToken(env, tok.token) : null;
      const out = await fn(tok.token, paymentToken);
      await uspsLog(env, accion, tok, 'ok');
      return out;
    } catch (e) {
      await uspsLog(env, accion, tok, (e && e.status) ? String(e.status) : 'error');
      if (attempt === 0 && tok.cached && e && e.status === 401) { await uspsClearTokens(env); continue; }
      throw e;
    }
  }
}
// Registro de uso de tokens (21 oct, diagnóstico para USPS): los últimos 20 eventos con hora,
// acción, si el token fue recién pedido o reusado, si traía la cuenta y qué respondió USPS.
// Nunca guarda tokens ni secretos. 1 lectura + 1 escritura de KV por acción.
const USPS_LOG_KEY = 'uspslog:v1';
async function uspsLog(env, accion, tok, resultado) {
  if (!env.CACUSA_KV) return;
  try {
    let list = [];
    try { list = JSON.parse(await env.CACUSA_KV.get(USPS_LOG_KEY) || '[]'); } catch (_) {}
    if (!Array.isArray(list)) list = [];
    list.push({ t: Date.now(), a: String(accion).slice(0, 20), n: tok && !tok.cached ? 1 : 0, c: tok && tok.hasAccount ? 1 : 0, r: String(resultado).slice(0, 12) });
    await env.CACUSA_KV.put(USPS_LOG_KEY, JSON.stringify(list.slice(-20)));
  } catch (_) {}
}
async function uspsLogText(env) {
  if (!env.CACUSA_KV) return '';
  let list = [];
  try { list = JSON.parse(await env.CACUSA_KV.get(USPS_LOG_KEY) || '[]'); } catch (_) {}
  if (!Array.isArray(list) || !list.length) return '';
  const fmt = ms => new Intl.DateTimeFormat('es-US', { timeZone: 'America/New_York', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  return ' | Registro (hora del Este, lo más nuevo primero): ' + list.slice().reverse().slice(0, 10)
    .map(x => `${fmt(x.t)} ${x.a}: token ${x.n ? 'nuevo' : 'guardado'} ${x.c ? 'con cuenta' : 'SIN cuenta'} → ${x.r}`).join('; ');
}
function uspsError(msg, status) { const e = new Error(msg); e.status = status; return e; }

// Claims del OAuth token (JWT, parte del medio). null si no se puede leer.
function uspsTokenClaims(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0))));
  } catch (_) { return null; }
}
function uspsTokenHasAccount(token) {
  const c = uspsTokenClaims(token);
  return !!(c && String(c.crid || c.CRID || '').trim());
}
// UN solo token de producción para todo (cotizar, probar, guía, recolección) — 20 oct.
// USPS pidió no regenerar el token en cada llamada, y los datos de la cuenta (CRID, cuentas de
// pago) quedan fijos dentro del token al emitirlo: uno emitido después de "Refresh Claims" los
// conserva hasta vencer (~8 h) aunque USPS los pierda después (pasaba a los pocos minutos).
// - Solo se GUARDA un token que trae la cuenta; uno vacío se usa en esa llamada y no se guarda,
//   así después de un Refresh Claims la próxima consulta toma uno bueno.
// - Un token bueno guardado nunca se reemplaza por uno vacío: se usa hasta que vence.
// Devuelve { token, at, exp, cached, hasAccount } (at/exp en ms).
async function uspsGetOAuth(env) {
  if (!env.USPS_CONSUMER_KEY || !env.USPS_CONSUMER_SECRET) throw new Error('USPS_CONSUMER_KEY/USPS_CONSUMER_SECRET no configurados');
  const cacheKey = env.CACUSA_KV ? await uspsTokenKey(env, 'oauth') : null;
  if (cacheKey) {
    const raw = await env.CACUSA_KV.get(cacheKey);
    if (raw) {
      let c = null;
      try { c = JSON.parse(raw); } catch (_) {}
      if (c && c.t && uspsTokenHasAccount(c.t) && (!c.exp || c.exp > Date.now() + 60000)) {
        return { token: c.t, at: c.at || null, exp: c.exp || null, cached: true, hasAccount: true };
      }
      await uspsClearTokens(env); // formato viejo o sin cuenta: no sirve
    }
  }
  const r = await fetch(`${uspsBaseUrl(env)}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.USPS_CONSUMER_KEY,
      client_secret: env.USPS_CONSUMER_SECRET,
    }),
  });
  if (!r.ok) throw uspsError(`USPS OAuth falló (${r.status}): ${(await r.text()).slice(0, 200)}`, r.status);
  const d = await r.json();
  const token = d.access_token;
  const at = Date.now();
  const claims = uspsTokenClaims(token);
  const lifeSec = Math.min(Number(d.expires_in) || 28800, 28800);
  const exp = claims && Number(claims.exp) ? Number(claims.exp) * 1000 : at + lifeSec * 1000;
  const hasAccount = uspsTokenHasAccount(token);
  if (cacheKey && token && hasAccount) {
    const ttl = Math.max(60, Math.floor((exp - at) / 1000) - 600);
    await env.CACUSA_KV.put(cacheKey, JSON.stringify({ t: token, at, exp }), { expirationTtl: ttl });
    await env.CACUSA_KV.delete(await uspsTokenKey(env, 'pay')); // el payment token va con el OAuth nuevo
  }
  return { token, at, exp, cached: false, hasAccount };
}
// Línea legible del token en uso, para el panel (horas en hora del Este).
function uspsTokenLine(tok) {
  const hhmm = ms => ms ? new Intl.DateTimeFormat('es-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)) : '—';
  return ` | Token en uso: obtenido ${hhmm(tok.at)} (hora del Este, ${tok.cached ? 'guardado' : 'recién pedido'}), trae tu cuenta: ${tok.hasAccount ? 'sí' : 'no'}, vence ${hhmm(tok.exp)}` +
    (tok.hasAccount ? '' : '. No se guarda: haz Refresh Claims en cop.usps.com y vuelve a cotizar.');
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
    // 20 oct: en producción `payment_accounts` llega como objeto (no lista) — antes salía
    // "[object Object]". Los objetos se muestran como JSON corto (solo números de cuenta).
    const list = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.accountNumber || x.account || x.CRID || x.crid || JSON.stringify(x)) : x).join(',') : (v == null ? '—' : (typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v)));
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
      `pedimos: crid=${env.USPS_CRID} eps=${env.USPS_EPS_ACCOUNT} env=${envLabel || 'prod'}`,
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
    const info = r.status === 403 ? uspsTokenClaimsSummary(oauthToken, env) : '';
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
// nunca se llama. Usa el token guardado (uspsGetOAuth, 20 oct). Devuelve si pasó y, si no, el
// error completo y lo que trae el token de producción (CRID, cuentas de pago), sin el token.
async function handleUspsProdPaymentCheck(env, origin) {
  const required = ['USPS_CONSUMER_KEY', 'USPS_CONSUMER_SECRET', 'USPS_CRID', 'USPS_MID', 'USPS_EPS_ACCOUNT'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) return err(`Faltan variables de USPS: ${missing.join(', ')}`, 500, origin);
  const base = 'https://apis.usps.com';
  let tok;
  try { tok = await uspsGetOAuth(env); }
  catch (e) { return ok({ ok: false, paso: 'oauth', error: String(e.message || e).slice(0, 800) }, origin); }
  const token = tok.token;
  const claims = uspsTokenClaimsSummary(token, env, 'Token de producción', 'prod') + uspsTokenLine(tok);
  const pr = await fetch(`${base}/payments/v3/payment-authorization`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles: [
      { roleName: 'LABEL_OWNER', CRID: env.USPS_CRID, MID: env.USPS_MID, manifestMID: env.USPS_MANIFEST_MID || env.USPS_MID },
      { roleName: 'PAYER', CRID: env.USPS_CRID, accountType: 'EPS', accountNumber: env.USPS_EPS_ACCOUNT },
    ] }),
  });
  const text = await pr.text();
  await uspsLog(env, 'prueba', tok, pr.ok ? 'ok' : String(pr.status));
  if (!pr.ok) return ok({ ok: false, paso: 'pago', status: pr.status, error: text.slice(0, 1000), claims }, origin);
  let autorizado = false;
  try { autorizado = !!JSON.parse(text).paymentAuthorizationToken; } catch (_) {}
  return ok({ ok: autorizado, paso: 'pago', claims, eps: env.USPS_EPS_ACCOUNT }, origin);
}

// POST /usps/rate-check — cotiza en PRODUCCIÓN, sin comprar ni cobrar, cuánto costaría la guía de
// un pedido: precio COMERCIAL para nuestra cuenta EPS y RETAIL para comparar (16 oct: en TEM la
// guía salía $8.41 y Click-N-Ship cotizaba $5.65 comercial para el mismo envío). Usa la API de
// Precios (Domestic Prices v3, cuerpo igual al ejemplo oficial de USPS/api-examples): no toca
// Payments ni Labels. Usa el token guardado (uspsGetOAuth, 20 oct).
// Gasta 3-4 llamadas de precios (+1 OAuth solo si no hay token guardado).
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
  let tok;
  try { tok = await uspsGetOAuth(env); }
  catch (e) { return err(`USPS OAuth (producción): ${String(e.message || e).slice(0, 500)}`, 502, origin); }
  const token = tok.token;
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
  // Comercial: primero el precio comercial PUBLICADO (sin datos de cuenta) y después SIEMPRE
  // con nuestra EPS, para ver si USPS le aplica a la cuenta un precio propio (ej. el Business
  // Rate Card de Click-N-Ship). 16 oct: con la EPS daba 403 "requested contract information is
  // not authorized" — el token de producción venía sin claims; 20 oct ya los trae. Antes el
  // intento con cuenta solo se hacía si el publicado fallaba, así que nunca se veía el precio
  // de la cuenta. Cada intento queda listado con su etiqueta.
  const claims = uspsTokenClaimsSummary(token, env, 'Token de producción', 'prod') + uspsTokenLine(tok);
  let claimAccounts = [];
  try {
    const part = String(token || '').split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), ch => ch.charCodeAt(0))));
    // Lista u objeto: se toman los números de cuenta (10 dígitos) que aparezcan.
    claimAccounts = [...new Set((JSON.stringify(c.payment_accounts || '').match(/\d{10}/g) || []))];
  } catch (_) {}
  const accounts = [...new Set([String(env.USPS_EPS_ACCOUNT || '').replace(/\D/g, ''), ...claimAccounts].filter(Boolean))].slice(0, 2);
  const intentos = [];
  const commercialPublished = await quote({ priceType: 'COMMERCIAL' });
  intentos.push({ como: 'comercial publicado, sin cuenta', ...commercialPublished });
  let commercialAccount = null;
  for (const acct of accounts) {
    const q = await quote({ priceType: 'COMMERCIAL', accountType: 'EPS', accountNumber: acct });
    intentos.push({ como: `comercial con tu cuenta EPS ${acct}`, ...q });
    commercialAccount = { ...q, account: acct };
    if (q.price != null) break;
  }
  // `commercial` se mantiene para paneles viejos: el de la cuenta si USPS lo dio, si no el publicado.
  const commercial = commercialAccount && commercialAccount.price != null ? commercialAccount : commercialPublished;
  const retail = await quote({ priceType: 'RETAIL' });
  // Resultado de la consulta CON la cuenta (es la que usa los datos del token).
  const acctRes = commercialAccount ? (commercialAccount.price != null ? 'ok' : ((String(commercialAccount.error || '').match(/^\((\d+)\)/) || [])[1] || 'error')) : 'sin cuenta';
  await uspsLog(env, 'cotizar', tok, acctRes);
  const claimsConRegistro = claims + await uspsLogText(env);
  return ok({ ok: true, version: 'rate-check-6', commercial, commercialPublished, commercialAccount, retail, intentos, claims: claimsConRegistro, ingredients }, origin);
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
  const { firstName, lastName } = orderRecipientName(cliente);
  // Teléfono: 10 dígitos de EE.UU., o no se manda (un formato raro no debe tumbar la guía).
  const phone10 = phone10Of(cliente.telefono);

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
  // 20 oct: el panel solo cotiza; las guías reales se compran en Click-N-Ship. Comprar por la
  // API exige USPS_ENV = 'prod' a propósito (cobra franqueo real). No hay modo de pruebas.
  if (env.USPS_ENV !== 'prod') {
    return err('La compra de guías desde el panel está desactivada: las guías se compran en Click-N-Ship. Usa "Cotizar precio" para comparar.', 409, origin);
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
    // Desglose de lo que cobra USPS (16 oct): franqueo, cada servicio extra con su precio y la
    // zona — para comparar con Click-N-Ship y ver si el seguro se cobra aparte.
    const costo = uspsLabelCost(label);
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
    order.uspsTrackingFor = String(order.tracking || '').replace(/\s+/g, '');
    order.uspsTrackingAt = order.labelGeneratedAt;
    order.labelWeightOz = weightOz;
    order.labelEnv = 'prod';
    if (costo) order.labelCost = costo;
    // En reimpresión solo se avisa a la clienta si cambió el número de guía. shipEmailSentFor:
    // al pasar después el pedido a "Enviado" no se le vuelve a mandar (ver handleOrderUpdate).
    const avisar = !!ctx && (!wasReprint || order.tracking !== prevTracking);
    if (avisar) order.shipEmailSentFor = order.tracking;
    await env.CACUSA_KV.put(orderKey(order.id), JSON.stringify(order));
    if (ctx) ctx.waitUntil(refreshOrdersCache(env).catch(() => {}));
    if (avisar) ctx.waitUntil(sendShippingConfirmationEmail(order, env).catch(e => console.error('email de tracking falló:', e.message)));
    if (ctx && uspsNotifyDue(order)) ctx.waitUntil(registerUspsNotifications(env, order.id, { auto: true }).catch(e => console.error('avisos USPS falló:', e.message)));
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

// ── Avisos de USPS a la clienta (22 oct) ─────────────────────────────────────────
// Tracking 3.2 (tracking-v3r2_15.yaml, v3.2.8): POST /tracking/{tn}/notifications registra hasta
// 3 correos para que USPS MISMO le mande a la clienta los avisos de su paquete (los mismos que
// ofrece Click-N-Ship). La API solo admite correo (no celular). Requiere el uniqueTrackingID que
// devuelve POST /tracking. Se hace automático al quedar un pedido con tracking de USPS (guía del
// panel o pegado de Click-N-Ship) y una sola vez por número (order.uspsNotify.for).
// Avisos elegidos: fecha estimada de entrega + actividad de entrega (entregado, retraso, acción
// necesaria) — sin "ALL_UPDATES" para no llenarle el correo de escaneos.
const USPS_NOTIFY_EVENTS = ['EXPECTED_DELIVERY', 'DELIVERY_ACTIVITY'];
function uspsNotifyDue(order) {
  if (!order || !orderHasUspsTracking(order)) return false;
  if (!isValidEmail((order.cliente && order.cliente.email) || '')) return false;
  const tn = String(order.tracking).replace(/\s+/g, '');
  const n = order.uspsNotify;
  if (!n || n.for !== tn) return true;
  return n.status === 'pendiente' && (Number(n.tries) || 0) < 5;
}
// Cuota (22 oct, auditoría): la cuenta de USPS tiene un tope diario de llamadas (Shipping Suite 0 =
// 50/día) y cada registro de avisos gasta 2. Los automáticos se cortan a USPS_NOTIFY_AUTO_MAX por día
// (hora del Este) para dejar margen a guías, recolección y cotizaciones; el botón manual no se corta.
const USPS_NOTIFY_AUTO_MAX = 12;
async function uspsNotifyBudgetTake(env) {
  const key = `uspsnotifyday:${easternDate()}`;
  const n = Number(await env.CACUSA_KV.get(key)) || 0;
  if (n >= USPS_NOTIFY_AUTO_MAX) return false;
  await env.CACUSA_KV.put(key, String(n + 1), { expirationTtl: 172800 });
  return true;
}
// POST /tracking/v3r2/tracking con un número → el detalle de ese paquete (o 404 si USPS aún no lo tiene).
async function uspsTrackingLookup(oauthToken, tn) {
  const tr = await fetch('https://apis.usps.com/tracking/v3r2/tracking', {
    method: 'POST',
    headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify([{ trackingNumber: tn }]),
  });
  const ttext = await tr.text();
  if (!tr.ok && tr.status !== 207) throw uspsError(`USPS tracking (${tr.status}): ${ttext.slice(0, 300)}`, tr.status);
  let list = []; try { list = JSON.parse(ttext); } catch (_) {}
  if (!Array.isArray(list)) list = [list];
  const item = list.find(x => x && x.uniqueTrackingID && (!x.statusCode || String(x.statusCode) === '200'));
  if (!item) throw uspsError(`USPS todavía no tiene ese número (${ttext.slice(0, 200)})`, 404);
  return item;
}
async function uspsNotifyRequest(env, oauthToken, { tn, email, firstName, lastName }) {
  const base = 'https://apis.usps.com/tracking/v3r2';
  const item = await uspsTrackingLookup(oauthToken, tn);
  const body = { uniqueTrackingID: item.uniqueTrackingID, notifyEventTypes: USPS_NOTIFY_EVENTS,
    recipients: [{ email, ...(firstName ? { firstName: firstName.slice(0, 50) } : {}), ...(lastName ? { lastName: lastName.slice(0, 50) } : {}) }] };
  if (item.mailingDate) body.mailingDate = item.mailingDate;
  const nr = await fetch(`${base}/tracking/${encodeURIComponent(tn)}/notifications`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const ntext = await nr.text();
  if (!nr.ok) throw uspsError(`USPS avisos (${nr.status}): ${ntext.slice(0, 300)}`, nr.status);
  let ack = {}; try { ack = JSON.parse(ntext); } catch (_) {}
  return String(ack.transactionMessage || 'ok').slice(0, 200);
}
// Registra los avisos de UN pedido (relee el pedido para no pisar otros cambios) y guarda el
// resultado en order.uspsNotify = { for, status: 'activo'|'pendiente'|'error', at, msg, tries }.
async function registerUspsNotifications(env, orderId, { auto = false } = {}) {
  if (!env.CACUSA_KV) return null;
  const order = await orderGet(env, orderId);
  if (!uspsNotifyDue(order)) return order && order.uspsNotify || null;
  const tn = String(order.tracking).replace(/\s+/g, '');
  // Evita 2 registros simultáneos del mismo número (2 guardados seguidos del panel).
  const claimKey = `uspsnotifyclaim:${tn}`;
  if (await env.CACUSA_KV.get(claimKey)) return order.uspsNotify || null;
  await env.CACUSA_KV.put(claimKey, '1', { expirationTtl: 120 });
  if (auto && !(await uspsNotifyBudgetTake(env))) {
    const fresh0 = await orderGet(env, orderId);
    if (fresh0 && String(fresh0.tracking || '').replace(/\s+/g, '') === tn) {
      fresh0.uspsNotify = { for: tn, status: 'pendiente', at: new Date().toISOString(), msg: 'tope diario de avisos automáticos (cuota de USPS) — usar "Activar ahora"', tries: 0 };
      await env.CACUSA_KV.put(orderKey(orderId), JSON.stringify(fresh0));
    }
    return null;
  }
  const c = order.cliente || {};
  let firstName = String(c.nombre || '').trim(), lastName = String(c.apellido || '').trim();
  if (!lastName && firstName.includes(' ')) { const i = firstName.lastIndexOf(' '); lastName = firstName.slice(i + 1); firstName = firstName.slice(0, i); }
  const prev = order.uspsNotify && order.uspsNotify.for === tn ? order.uspsNotify : null;
  const tries = (prev ? Number(prev.tries) || 0 : 0) + 1;
  let result;
  try {
    const msg = await uspsWithTokens(env, false, (oauthToken) =>
      uspsNotifyRequest(env, oauthToken, { tn, email: String(c.email).trim(), firstName, lastName }), 'avisos USPS');
    result = { for: tn, status: 'activo', at: new Date().toISOString(), msg, tries };
  } catch (e) {
    // 404 = USPS aún no tiene el número (guía recién creada): se reintenta más tarde.
    const pend = e && (e.status === 404 || e.status === 429 || e.status === 503);
    result = { for: tn, status: pend ? 'pendiente' : 'error', at: new Date().toISOString(), msg: String(e.message || e).slice(0, 300), tries };
  }
  const fresh = await orderGet(env, orderId);
  if (!fresh || String(fresh.tracking || '').replace(/\s+/g, '') !== tn) return result; // cambió mientras tanto
  fresh.uspsNotify = result;
  await env.CACUSA_KV.put(orderKey(orderId), JSON.stringify(fresh));
  await refreshOrdersCache(env).catch(() => {});
  return result;
}
// POST /order/usps-notify — reintento manual desde el panel ("Activar avisos de USPS").
async function handleUspsNotifyRetry(body, env, origin, ctx) {
  const id = body.orderId;
  if (id == null) return err('Falta orderId', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);
  if (!orderHasUspsTracking(order)) return err('El pedido no tiene tracking de USPS.', 400, origin);
  if (!isValidEmail((order.cliente && order.cliente.email) || '')) return err('El pedido no tiene un correo válido de la clienta.', 400, origin);
  const tn = String(order.tracking).replace(/\s+/g, '');
  if (order.uspsNotify && order.uspsNotify.for === tn && ['error', 'pendiente', 'omitido'].includes(order.uspsNotify.status)) {
    order.uspsNotify.status = 'pendiente'; order.uspsNotify.tries = 0;
    await env.CACUSA_KV.put(orderKey(id), JSON.stringify(order));
  }
  await env.CACUSA_KV.delete(`uspsnotifyclaim:${tn}`);
  const r = await registerUspsNotifications(env, id);
  return ok({ ok: !!r && r.status === 'activo', uspsNotify: r }, origin);
}

// POST /order/usps-status (22 oct) — estado actual del paquete en USPS para el mensaje de WhatsApp
// del panel ("Notificar"): categoría, resumen, fecha estimada de entrega y último evento. Solo
// lectura; 1 llamada a Tracking 3.2 con el token guardado.
async function handleUspsStatus(body, env, origin) {
  const id = body.orderId;
  if (id == null) return err('Falta orderId', 400, origin);
  const order = await orderGet(env, id);
  if (!order) return err('Pedido no encontrado', 404, origin);
  if (!orderHasUspsTracking(order)) return err('El pedido no tiene tracking de USPS.', 400, origin);
  const tn = String(order.tracking).replace(/\s+/g, '');
  try {
    const item = await uspsWithTokens(env, false, (oauthToken) => uspsTrackingLookup(oauthToken, tn), 'estado USPS');
    // Nov: si USPS ya lo da por entregado, se anota la fecha (señal para el pedido de reseña),
    // una sola vez y releyendo el pedido para no pisar otro cambio. No toca order.estado.
    // Wave 2: si sigue "Enviado", además lo pasa a "Entregado" (mismo camino que el cron).
    let delivered = false;
    if (uspsItemDelivered(item)) {
      delivered = await markOrderDeliveredByUsps(env, id, tn, item).catch((e) => { console.error('entregadoAt (USPS):', e.message); return false; });
    }
    const dde = item.deliveryDateExpectation || {};
    const ev = Array.isArray(item.trackingEvents) && item.trackingEvents[0] || null;
    return ok({ ok: true, tracking: tn,
      status: String(item.status || '').slice(0, 200),
      statusCategory: String(item.statusCategory || '').slice(0, 80),
      statusSummary: String(item.statusSummary || '').slice(0, 400),
      expectedDeliveryDate: dde.expectedDeliveryDate || dde.predictedDeliveryDate || '',
      lastEvent: ev ? { type: String(ev.eventType || '').slice(0, 120), city: ev.eventCity || '', state: ev.eventState || '', at: ev.eventTimestamp || ev.GMTTimestamp || '' } : null,
      ...(delivered ? { markedDelivered: true } : {}),
    }, origin);
  } catch (e) {
    return ok({ ok: false, tracking: tn, notFound: !!(e && e.status === 404), error: String(e.message || e).slice(0, 300) }, origin);
  }
}

// Botón "Pedir recolección de hoy" del panel — no está atado a un pedido puntual (el
// cartero pasa una vez por la dirección y se lleva TODO lo que esté listo ese día), así
// que la idempotencia es por FECHA, no por pedido: apretar el botón 2 veces el mismo
// día devuelve la misma confirmación en vez de pedir 2 recolecciones reales.
// Fecha YYYY-MM-DD en hora del Este (donde está el remitente): en UTC, desde las 8 p.m. ET ya
// era "mañana" y el botón buscaba las guías de otro día (18 oct).
function easternDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// 21 oct (pickup-2): funciona con las guías de Click-N-Ship. Cuenta los pedidos no cancelados
// que hoy (hora del Este) quedaron con un tracking de USPS — pegado a mano (uspsTrackingAt) o
// de una guía de la API (labelGeneratedAt). Pedir recolección es gratis: ya no depende de
// USPS_ENV. `preview: true` devuelve el conteo sin llamar a USPS. pickup-3 (21 oct): solo
// cuenta pedidos del panel (tienda web + manuales, incluidas cajas de Lovers); no se acepta una
// cantidad escrita a mano (decisión del usuario).
async function handleUspsSchedulePickup(body, env, origin, ctx) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const today = easternDate();
  const kvKey = `uspspickup:${today}`;
  const existingRaw = await env.CACUSA_KV.get(kvKey);
  if (existingRaw) {
    let existing;
    try { existing = JSON.parse(existingRaw); } catch { existing = null; }
    if (existing) return ok({ ok: true, alreadyRequested: true, ...existing }, origin);
  }

  const orders = await listAllOrders(env);
  const isToday = v => { if (!v) return false; const d = new Date(v); return !Number.isNaN(d.getTime()) && easternDate(d) === today; };
  const todays = orders.filter(o => o && o.estado !== 'Cancelado' && !o.archivado && orderHasUspsTracking(o) && (isToday(o.uspsTrackingAt) || isToday(o.labelGeneratedAt)));
  const detected = todays.length;
  const clientas = todays.map(o => [o.cliente && o.cliente.nombre, o.cliente && o.cliente.apellido].filter(Boolean).join(' ').trim() || `#${o.id}`).slice(0, 50);
  if (body.preview === true) {
    return ok({ ok: true, preview: true, date: today, detected, clientas }, origin);
  }

  const packageCount = detected;
  if (!packageCount) {
    return err('No hay pedidos de hoy con tracking de USPS en el panel (pega el tracking en los pedidos primero).', 400, origin);
  }
  // Libras enteras (el ejemplo oficial de USPS usa enteros), mínimo 1.
  const estimatedWeight = Math.max(1, Math.ceil(todays.reduce((sum, o) => sum + (Number(o.labelWeightOz) || 4), 0) / 16));

  if (!env.USPS_FROM_ADDRESS) return err('USPS_FROM_ADDRESS no configurado', 500, origin);
  let fromAddress;
  try { fromAddress = JSON.parse(env.USPS_FROM_ADDRESS); }
  catch { return err('USPS_FROM_ADDRESS no es JSON válido', 500, origin); }

  // Candado corto: 2 toques casi simultáneos no piden 2 recolecciones reales.
  const lockKey = `uspspickuplock:${today}`;
  if (await env.CACUSA_KV.get(lockKey)) return err('La recolección de hoy se está pidiendo en este momento. Espera unos segundos y vuelve a tocar.', 409, origin);
  await env.CACUSA_KV.put(lockKey, '1', { expirationTtl: 120 });
  try {
    const pickup = await uspsWithTokens(env, false, (oauthToken) =>
      uspsSchedulePickup(env, oauthToken, { fromAddress, packageCount, estimatedWeight, pickupDate: today }), 'recolección');
    const result = { confirmationNumber: pickup.confirmationNumber, pickupDate: pickup.pickupDate || today, packageCount };
    // Si USPS ya confirmó, no se devuelve error aunque falle guardar la confirmación.
    try { await env.CACUSA_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 172800 }); } catch (e) { console.error('no se guardó la confirmación de recolección:', e.message); }
    await env.CACUSA_KV.delete(lockKey).catch(() => {});
    return ok({ ok: true, alreadyRequested: false, version: 'pickup-3', ...result }, origin);
  } catch (e) {
    await env.CACUSA_KV.delete(lockKey).catch(() => {});
    console.error('USPS schedule pickup falló:', e.message);
    return err('No se pudo pedir la recolección: ' + e.message, 502, origin);
  }
}

// ── Exportar envíos para Click-N-Ship (26 oct) ───────────────────────────────────────
// Si la API sale más cara que Click-N-Ship, el panel baja un CSV con el formato EXACTO de la
// plantilla "Import Batch of Labels" (Label_Template.csv, guía CNS v2 oct 2026) y Robin lo sube
// ahí: Click-N-Ship crea las guías en lote a su precio. Reference ID = id del pedido (es lo que
// se usa después para pegar el tracking de vuelta), Reference ID 2 = número visible. El
// remitente sale de USPS_FROM_ADDRESS (secreto): el panel no lo puede leer.
const CNS_HEADER = ['Reference ID', 'Reference ID 2', 'Shipping Date', 'Item Description', 'Item Quantity', 'Item Weight (lb)', 'Item Weight (oz)', 'Item Value', 'HS Tariff #', 'Country of Origin', 'Sender First Name', 'Sender Middle Initial', 'Sender Last Name', 'Sender Company/Org Name', 'Sender Address Line 1', 'Sender Address Line 2', 'Sender Address Line 3', 'Sender Address Town/City', 'Sender State', 'Sender Country', 'Sender ZIP Code', 'Sender Urbanization Code', 'Ship From Another ZIP Code', 'Sender Email', 'Sender Cell Phone', 'Recipient Country', 'Recipient First Name', 'Recipient Middle Initial', 'Recipient Last Name', 'Recipient Company/Org Name', 'Recipient Address Line 1', 'Recipient Address Line 2', 'Recipient Address Line 3', 'Recipient Address Town/City', 'Recipient Province', 'Recipient State', 'Recipient ZIP Code', 'Recipient Urbanization Code', 'Recipient Phone', 'Recipient Email', 'Service Type', 'Package Type', 'Package Weight (lb)', 'Package Weight (oz)', 'Length', 'Width', 'Height', 'Girth', 'Insured Value', 'Contents', 'Contents Description', 'Package Comments', 'Customs Form Reference #', 'License #', 'Certificate #', 'Invoice #', 'Customs Form Reference # Type', 'HAZMAT Type', 'Live Animals and Perishable Goods Indicator'];
// Un campo de CSV: sin saltos de línea, sin =/+/@ al inicio (Excel lo tomaría como fórmula),
// entre comillas si lleva coma o comillas.
function cnsCell(v) {
  let s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().replace(/^[=+@]+/, '');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Nombre y apellido (los pedidos de la tienda los guardan juntos en `nombre`).
function orderRecipientName(cliente) {
  let firstName = String((cliente && cliente.nombre) || '').trim();
  let lastName = String((cliente && cliente.apellido) || '').trim();
  if (!lastName && firstName.includes(' ')) {
    const i = firstName.lastIndexOf(' ');
    lastName = firstName.slice(i + 1);
    firstName = firstName.slice(0, i);
  }
  return { firstName, lastName };
}
// Teléfono de EE.UU. de 10 dígitos (sin el 1). Un celular de Ecuador (09…) no pasa: los
// números de EE.UU. nunca empiezan con 0 ni 1.
function phone10Of(v) {
  const d = String(v || '').replace(/\D/g, '');
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return /^[2-9]\d{9}$/.test(n) ? n : '';
}
// Pedidos que todavía necesitan guía: a EE.UU., no cancelados ni enviados, sin tracking ni
// guía de la API. `issues` = lo que Click-N-Ship rechazaría (o una caja de Lovers sin piezas).
function cnsCandidates(orders) {
  const out = [];
  for (const o of orders) {
    if (!o || o.archivado || ['Cancelado', 'Enviado', 'Entregado'].includes(o.estado)) continue;
    if (String(o.tracking || '').trim() || o.labelGeneratedAt || o.labelStored || o.labelBase64) continue;
    const cliente = o.cliente || {};
    const { pais, ciudad } = orderCountryParts(cliente);
    if (!US_COUNTRY_VALUES.includes(pais)) continue;
    const { firstName, lastName } = orderRecipientName(cliente);
    const state = usStateCode(cliente.estado);
    const zip = String(cliente.zip || '').trim();
    const issues = [];
    if (!firstName || !lastName) issues.push('falta nombre y apellido');
    if (!String(cliente.direccion || '').trim()) issues.push('falta dirección');
    if (!ciudad) issues.push('falta ciudad');
    if (!state) issues.push('estado no reconocido');
    if (!/^\d{5}(-\d{4})?$/.test(zip)) issues.push('ZIP no válido');
    if (!(Array.isArray(o.productos) && o.productos.length)) issues.push('sin piezas cargadas');
    out.push({ o, cliente, ciudad, state, zip, firstName, lastName, issues });
  }
  return out;
}
async function handleCnsExport(body, env, origin) {
  if (!env.CACUSA_KV) return err('KV no configurado en el Worker', 500, origin);
  const cands = cnsCandidates(await listAllOrders(env));
  if (body.preview === true) {
    return ok({ ok: true, preview: true, orders: cands.map(c => ({
      id: c.o.id, numero: c.o.numero || '', cliente: [c.firstName, c.lastName].filter(Boolean).join(' ') || `#${c.o.id}`,
      ciudad: c.ciudad, estado: c.state || String(c.cliente.estado || ''), issues: c.issues,
    })) }, origin);
  }

  const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
  if (!ids.size) return err('Elige al menos un pedido.', 400, origin);
  if (ids.size > 1000) return err('Click-N-Ship acepta hasta 1000 envíos por archivo.', 400, origin);
  const weightOz = Number(body.weightOz), lengthIn = Number(body.lengthIn), widthIn = Number(body.widthIn), heightIn = Number(body.heightIn);
  if (!(weightOz > 0 && weightOz <= 1120 && lengthIn > 0 && widthIn > 0 && heightIn > 0)) {
    return err('Faltan el peso (oz) y las 3 medidas del paquete (pulgadas).', 400, origin);
  }
  const insured = Number(body.insuredValue);
  const insuredValue = insured > 0 ? Math.min(5000, Math.round(insured)) : '';

  if (!env.USPS_FROM_ADDRESS) return err('USPS_FROM_ADDRESS no configurado', 500, origin);
  let from;
  try { from = JSON.parse(env.USPS_FROM_ADDRESS); }
  catch { return err('USPS_FROM_ADDRESS no es JSON válido', 500, origin); }
  const fromPhone = phone10Of(from.phone);
  if (!from.firstName || !from.lastName || !from.streetAddress || !from.city || !from.state || !from.ZIPCode || !fromPhone) {
    return err('USPS_FROM_ADDRESS está incompleto (nombre, apellido, dirección, ciudad, estado, ZIP y teléfono de 10 dígitos).', 500, origin);
  }

  const chosen = cands.filter(c => ids.has(String(c.o.id)));
  const bad = chosen.filter(c => c.issues.some(i => i !== 'sin piezas cargadas'));
  if (bad.length) {
    return err('Corrige antes estos pedidos: ' + bad.map(c => `#${c.o.numero || c.o.id} (${c.issues.join(', ')})`).join('; '), 400, origin);
  }
  if (!chosen.length) return err('Ninguno de esos pedidos sigue pendiente de guía.', 400, origin);

  // Fecha de envío = hoy en hora del Este (Click-N-Ship acepta hasta 7 días adelante).
  const [y, m, d] = easternDate().split('-');
  const shipDate = `${m}/${d}/${y}`;
  const lb = Math.floor(weightOz / 16);
  const oz = Math.round((weightOz - lb * 16) * 10) / 10;
  const fromZip = String(from.ZIPCode).trim();
  const rows = chosen.map(c => {
    const email = String(c.cliente.email || '').trim();
    const r = {
      'Reference ID': String(c.o.id).slice(0, 30),
      'Reference ID 2': String(c.o.numero || '').slice(0, 30),
      'Shipping Date': shipDate,
      'Item Description': 'Jewelry',
      'Item Quantity': 1,
      'Item Weight (lb)': lb,
      'Item Weight (oz)': oz,
      'Country of Origin': 'US',
      'Sender First Name': from.firstName,
      'Sender Last Name': from.lastName,
      'Sender Company/Org Name': String(from.firm || 'CACUSA BY TAITUS LLC').slice(0, 50),
      'Sender Address Line 1': from.streetAddress,
      'Sender Address Line 2': from.secondaryAddress || '',
      'Sender Address Town/City': from.city,
      'Sender State': String(from.state).trim().toUpperCase(),
      'Sender Country': 'US',
      'Sender ZIP Code': fromZip,
      'Sender Email': from.email || 'facturacioncacusa@gmail.com',
      'Sender Cell Phone': fromPhone,
      'Recipient Country': 'US',
      'Recipient First Name': c.firstName,
      'Recipient Last Name': c.lastName,
      'Recipient Address Line 1': c.cliente.direccion,
      'Recipient Address Line 2': c.cliente.apto || '',
      'Recipient Address Town/City': c.ciudad,
      'Recipient State': c.state,
      'Recipient ZIP Code': c.zip,
      'Recipient Phone': phone10Of(c.cliente.telefono),
      'Recipient Email': isValidEmail(email) ? email : '',
      'Service Type': 'USPS Ground Advantage',
      'Package Type': 'Choose Your Own Box',
      'Package Weight (lb)': lb,
      'Package Weight (oz)': oz,
      'Length': lengthIn,
      'Width': widthIn,
      'Height': heightIn,
      'Insured Value': insuredValue,
    };
    return CNS_HEADER.map(h => cnsCell(r[h])).join(',');
  });
  const csv = CNS_HEADER.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';
  return ok({ ok: true, count: rows.length, filename: `click-n-ship-${easternDate()}.csv`, csv }, origin);
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
  // La caja de Lovers no tiene nada que cobrar (la suscripción se cobra con factura de Square).
  setInitialPagoEstado(newOrder, 'recibido', 'lovers');

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
  // usuario lo pide (limpiar:true), nunca solos. Se protegen los de suscriptoras a las que solo
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

// ── Correos automáticos a clientas (nov): pedido de reseña + recordatorio de carrito ──
// Los corre el Cron Trigger de ESTE Worker (scheduled() → runAutoEmails), no el de
// cacusa-lovers-webhook: esa tarea diaria ya usa ~45 de las ~50 llamadas externas por
// ejecución del plan Free, y Gmail/los pedidos/los carritos viven acá. También se puede
// correr a mano (o en vista previa) desde /mail-auto/run con sesión del panel.
//
// Los 2 se tratan como correo de PROMOCIÓN (criterio conservador ante CAN-SPAM): llevan
// el mismo link de baja firmado que el marketing (/m/baja → mktunsub:<email>, una sola
// baja para todo lo promocional) + List-Unsubscribe one-click, y la dirección postal
// MKT_POSTAL_ADDRESS. Sin esa variable NO sale ninguno (la vista previa sí funciona).
// Nunca a quien se dio de baja. Comparten el tope diario de Gmail del marketing
// (mktsent:<fecha>, MKT_DAILY_CAP) para no dejar sin cupo los correos de pedidos.
//
// Topes: máx. 1 correo automático por destinataria cada 24 h (rateLimit en la DO, nunca
// contadores en KV), 1 recordatorio de carrito por email cada 7 días (cartremsent:<email>,
// se escribe solo al mandar), tandas chicas (AUTO_REVIEW_BATCH + AUTO_CART_BATCH) y un
// presupuesto de llamadas externas por corrida (AUTO_MAIL_SUBREQ_MAX). Lo que no entra
// hoy sale en la próxima corrida: todo es idempotente.
//
// Idempotencia de cada envío: DO OrderIdempotency (reviewreq:<id> / cartrem:<email>:<ts>)
// → se manda → marca en KV (order.reviewReqAt / acart.remindedAt) → finalize. Si la marca
// de KV fallara, la DO ya dice 'done' y la próxima corrida solo repara la marca.
const REVIEW_REQUEST_DELAY_DAYS = 3;      // días después de la entrega
const REVIEW_REQUEST_MAX_AGE_DAYS = 30;   // entregas más viejas que esto ya no se piden
const CART_REMINDER_DELAY_HOURS = 24;     // horas después de dejar el carrito
const CART_REMINDER_MAX_AGE_HOURS = 72;   // carritos más viejos ya no se recuerdan
const CART_PENDING_TTL_SECONDS = 7 * 24 * 3600;
const CART_REMINDER_EVERY_DAYS = 7;       // máx. 1 recordatorio por email en este lapso
// Cupón opcional en el recordatorio — APAGADO (0). Robin decide el % después; con un valor
// > 0 se crea (una vez por email, mismo patrón HMAC que welcome10) un cupón de 1 uso, atado
// al email (restrictToEmail, que también respeta cacusa-square) y que vence en 7 días.
const CART_REMINDER_COUPON_PCT = 0;
const AUTO_REVIEW_BATCH = 5;              // correos de reseña por corrida
const AUTO_CART_BATCH = 4;                // recordatorios de carrito por corrida
const AUTO_MAIL_SUBREQ_MAX = 40;          // de ~50 del plan Free (margen para reintentos)
const AUTO_MAIL_COST_PER_EMAIL = 4;       // claim (DO) + rateLimit (DO) + Gmail + finalize/release (DO)
const AUTO_MAIL_RECIPIENT_WINDOW = 24 * 3600;
const AUTO_ITEM_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
// Base pública de este Worker para los links de baja que salen desde el cron (no hay
// request de donde sacarla). Mismo valor que ADMIN_WORKER_URL de la tienda.
const ADMIN_WORKER_PUBLIC_URL = 'https://cacusa-admin.facturacioncacusa.workers.dev';

function acartKey(email) { return 'acart:' + String(email || '').toLowerCase().trim(); }

// Valida los items del carrito pendiente: solo id + cantidad, ids con formato de catálogo,
// cantidades 1–10, ids repetidos se suman (tope 10), máx. 20 líneas.
function cleanPendingItems(raw) {
  if (!Array.isArray(raw)) return [];
  const byId = new Map();
  for (const it of raw.slice(0, 40)) {
    if (!it || typeof it !== 'object') continue;
    const id = (typeof it.id === 'string' || typeof it.id === 'number') ? String(it.id) : '';
    if (!AUTO_ITEM_ID_RE.test(id)) continue;
    const q = Number.isInteger(it.qty) ? it.qty : 1;
    if (q < 1 || q > 10) continue;
    byId.set(id, Math.min(10, (byId.get(id) || 0) + q));
    if (byId.size >= 20) break;
  }
  return [...byId].map(([id, qty]) => ({ id, qty }));
}

// POST /cart/pending — pública, origin-restringida. Guarda SOLO email, idioma, items
// (id + cantidad) y fecha, en acart:<email> con TTL de 7 días. Respuesta siempre igual
// (sin oráculo de si el email existe o se dio de baja). Topes en la DO: 6/h por IP y
// 3/día por email (la tienda manda 1 por sesión de checkout; esto acota un abuso).
async function handleCartPending(body, env, origin, request) {
  if (!env.CACUSA_KV) return ok({ ok: true }, origin);
  if (!(await rateLimit(env, 'cart-pending-ip', clientIp(request), 6, 3600))) return ok({ ok: true }, origin);
  const email = String(body.email || '').toLowerCase().trim().slice(0, 100);
  if (!isValidEmail(email)) return ok({ ok: true }, origin);
  if (!(await rateLimit(env, 'cart-pending-em', email, 3, 86400))) return ok({ ok: true }, origin);
  // Desmarcó el permiso después de mandarlo: se borra lo guardado.
  if (body.remind !== true) { await clearPendingCart(email, env).catch(() => {}); return ok({ ok: true }, origin); }
  const items = cleanPendingItems(body.items);
  if (!items.length) return ok({ ok: true }, origin);
  if (await env.CACUSA_KV.get('mktunsub:' + email)) return ok({ ok: true }, origin);
  const rec = { email, lang: body.lang === 'en' ? 'en' : 'es', items, ts: new Date().toISOString() };
  await env.CACUSA_KV.put(acartKey(email), JSON.stringify(rec), { expirationTtl: CART_PENDING_TTL_SECONDS });
  return ok({ ok: true }, origin);
}

// Compró (pedido creado con ese email) o vació el carrito: el carrito pendiente deja de
// existir. Lee antes de borrar para no gastar borrados de KV (1.000/día) en cada pedido.
async function clearPendingCart(email, env) {
  if (!env.CACUSA_KV || !email) return;
  const k = acartKey(email);
  if (await env.CACUSA_KV.get(k)) await env.CACUSA_KV.delete(k);
}

// USPS dice "Delivered" (consulta del panel, /order/usps-status): anota entregadoAt una vez y,
// desde wave 2, si el pedido sigue "Enviado" lo pasa a "Entregado" (mismo camino que el cron).
async function markOrderDeliveredByUsps(env, id, tn, item) {
  const fresh = await orderGet(env, id);
  if (!applyUspsDelivered(fresh, tn, uspsDeliveredAt(item))) return false;
  await env.CACUSA_KV.put(orderKey(id), JSON.stringify(fresh));
  await refreshOrdersCache(env).catch(() => {});
  return true;
}

// ── "Entregado" automático por USPS (wave 2) ─────────────────────────────────────────────
// Antes un pedido pasaba a Entregado solo si alguien lo marcaba a mano (o anotaba entregadoAt al
// consultar USPS desde "Notificar"); el pedido de reseña dependía de eso. Ahora el cron diario
// consulta Tracking 3.2 para los pedidos "Enviado" con tracking de USPS despachados hace más de
// USPS_AUTOTRACK_MIN_AGE_DAYS días. Cuidados:
// - Cuota de USPS (~50 llamadas/día para TODO: guías, avisos, recolección, cotizaciones): tope de
//   USPS_AUTOTRACK_MAX consultas por día (hora del Este), contado en la misma llave de estado.
// - Rotación: primero los que hace más tiempo no se revisan (checks[id] = última revisión, ms =
//   el lastTrackCheckAt de cada pedido). Uno revisado hace menos de USPS_AUTOTRACK_RECHECK_HOURS
//   no se vuelve a consultar. Vive en la llave de estado y no en el pedido: anotarlo en cada
//   order:<id> serían hasta 10 escrituras más + rehacer orders_cache todos los días.
// - KV (1.000 escrituras/día): UNA sola llave de estado (uspsautotrack:v1) que se escribe una vez
//   por corrida y solo si se consultó algo; cada pedido entregado se escribe una vez; orders_cache
//   se rehace una sola vez al final y solo si cambió algún pedido. Sin candidatos: 0 escrituras.
// - Versión (wave 1): se relee cada pedido justo antes de escribir y solo se toca si sigue
//   "Enviado" con el mismo tracking; queda con updatedAt nuevo, así un panel con la versión vieja
//   recibe 409 en vez de devolverlo a "Enviado".
// - Mismo camino que dispara el correo de reseña: estado Entregado + entregadoAt (fecha real del
//   escaneo de entrega si USPS la da) + entregadoFuente 'usps'. entregadoAuto marca que lo hizo el
//   sistema (el panel lo muestra como "Entregado automático (USPS)").
const USPS_AUTOTRACK_KEY = 'uspsautotrack:v1';
const USPS_AUTOTRACK_MAX = 10;              // consultas a USPS por día
const USPS_AUTOTRACK_MIN_AGE_DAYS = 2;      // despachado hace más de esto
const USPS_AUTOTRACK_MAX_AGE_DAYS = 45;     // más viejo: se deja de consultar (revisar a mano)
const USPS_AUTOTRACK_RECHECK_HOURS = 20;
const CRON_SUBREQ_TOTAL = 46;               // de ~50 llamadas externas por ejecución (plan Free)

async function runCron(env) {
  let used = 0;
  try {
    const r = await runAutoDelivered(env);
    used = r.llamadas || 0;
    console.log('entregado automático (USPS):', JSON.stringify(r));
  } catch (e) { used = USPS_AUTOTRACK_MAX + 2; console.error('entregado automático falló:', e && e.message); }
  const subreqMax = Math.max(0, Math.min(AUTO_MAIL_SUBREQ_MAX, CRON_SUBREQ_TOTAL - used));
  try {
    const r2 = await runAutoEmails(env, { subreqMax });
    console.log('correos automáticos:', JSON.stringify(r2));
  } catch (e) { console.error('correos automáticos fallaron:', e && e.message); }
}

function uspsItemDelivered(item) {
  const cat = String((item && item.statusCategory) || '');
  return /deliver/i.test(cat) && !/out for|attempt/i.test(cat);
}
// Fecha real del escaneo de entrega (si USPS la manda y es razonable), si no null.
function uspsDeliveredAt(item) {
  if (!item || !uspsItemDelivered(item)) return null;
  const evs = Array.isArray(item.trackingEvents) ? item.trackingEvents : [];
  const ev = evs.find((e) => e && /deliver/i.test(String(e.eventType || '')) && !/out for|attempt/i.test(String(e.eventType || ''))) || null;
  const raw = ev && (ev.eventTimestamp || ev.GMTTimestamp);
  const t = raw ? new Date(raw).getTime() : NaN;
  if (!Number.isFinite(t) || t > Date.now() + 3600000 || t < Date.now() - 120 * 86400000) return null;
  return new Date(t).toISOString();
}
// Aplica "entregado por USPS" sobre un pedido ya leído. Devuelve true si cambió algo.
function applyUspsDelivered(o, tn, deliveredAtIso) {
  if (!o || o.estado === 'Cancelado' || o.archivado) return false;
  if (String(o.tracking || '').replace(/\s+/g, '') !== tn) return false;
  let changed = false;
  const now = new Date().toISOString();
  if (!o.entregadoAt) { o.entregadoAt = deliveredAtIso || now; o.entregadoFuente = 'usps'; changed = true; }
  if (o.estado === 'Enviado' && !o.autoTrackOff) {
    o.estado = 'Entregado';
    o.entregadoAuto = true;
    if (o.entregadoFuente !== 'usps') { o.entregadoFuente = 'usps'; if (deliveredAtIso) o.entregadoAt = deliveredAtIso; }
    changed = true;
  }
  if (changed) { o.updatedAt = now; o.updatedBy = 'usps'; }
  return changed;
}
function orderShippedAtMs(o) {
  for (const v of [o.uspsTrackingAt, o.labelGeneratedAt, o.updatedAt, o.fecha]) {
    const t = v ? new Date(v).getTime() : NaN;
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}
// Candidatos en orden de rotación (puro, lo usan el cron y las pruebas).
function autoTrackCandidates(orders, checks, now) {
  const min = USPS_AUTOTRACK_MIN_AGE_DAYS * 86400000, max = USPS_AUTOTRACK_MAX_AGE_DAYS * 86400000;
  const recheck = USPS_AUTOTRACK_RECHECK_HOURS * 3600000;
  return (orders || []).filter((o) => {
    if (!o || o.estado !== 'Enviado' || o.archivado || o.autoTrackOff || !orderHasUspsTracking(o)) return false;
    const age = now - orderShippedAtMs(o);
    if (!(age >= min && age <= max)) return false;
    const last = Number(checks[String(o.id)]) || 0;
    return now - last >= recheck;
  }).sort((a, b) => ((Number(checks[String(a.id)]) || 0) - (Number(checks[String(b.id)]) || 0)) || (orderShippedAtMs(a) - orderShippedAtMs(b)));
}
async function runAutoDelivered(env, { dryRun = false, max = USPS_AUTOTRACK_MAX } = {}) {
  const out = { dryRun, candidatos: 0, consultados: 0, entregados: [], noEncontrados: 0, errores: 0, llamadas: 0, escrituras: 0 };
  if (!env.CACUSA_KV) { out.error = 'KV no configurado'; return out; }
  if (!env.USPS_CONSUMER_KEY || !env.USPS_CONSUMER_SECRET) { out.pausado = 'USPS no configurado'; return out; }
  const now = Date.now();
  const today = easternDate();
  let orders = [];
  try { const od = JSON.parse((await env.CACUSA_KV.get('orders_cache')) || '{}'); if (Array.isArray(od.orders)) orders = od.orders; } catch (_) {}
  let st = null;
  try { st = JSON.parse((await env.CACUSA_KV.get(USPS_AUTOTRACK_KEY)) || 'null'); } catch (_) {}
  if (!st || typeof st !== 'object') st = {};
  const checks = st.checks && typeof st.checks === 'object' ? { ...st.checks } : {};
  const usedToday = st.day === today ? (Number(st.used) || 0) : 0;
  const cands = autoTrackCandidates(orders, checks, now);
  out.candidatos = cands.length;
  const room = Math.max(0, Math.min(USPS_AUTOTRACK_MAX, Number(max) || 0) - usedToday);
  const pick = cands.slice(0, room);
  out.usadosHoy = usedToday;
  if (dryRun) { out.lista = pick.map((o) => o.numero || o.id); return out; }
  if (!pick.length) { if (cands.length && !room) out.topeDiario = true; return out; }

  let tok = null, stop = '';
  const getTok = async (fresh) => {
    if (fresh) await uspsClearTokens(env);
    tok = await uspsGetOAuth(env);
    if (!tok.cached) out.llamadas++;
    return tok;
  };
  const delivered = [];
  for (const o of pick) {
    if (stop) break;
    const tn = String(o.tracking).replace(/\s+/g, '');
    let item = null;
    try {
      if (!tok) await getTok(false);
      try { out.llamadas++; item = await uspsTrackingLookup(tok.token, tn); }
      catch (e) {
        if (e && e.status === 401 && tok.cached) { await getTok(true); out.llamadas++; item = await uspsTrackingLookup(tok.token, tn); }
        else throw e;
      }
    } catch (e) {
      if (e && e.status === 404) out.noEncontrados++;
      else {
        out.errores++;
        // Cuota agotada, credenciales o USPS caído: no se siguen gastando llamadas hoy.
        if (!e || !e.status || e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500) stop = String((e && e.message) || e).slice(0, 200);
      }
    }
    out.consultados++;
    checks[String(o.id)] = now;
    if (item && uspsItemDelivered(item)) delivered.push({ id: o.id, tn, at: uspsDeliveredAt(item) });
  }
  // Escrituras en bloque al final: cada pedido entregado (relectura → aplicar → put), una sola
  // reconstrucción de orders_cache y una sola escritura del estado de rotación.
  const doneIds = new Set();
  for (const d of delivered) {
    const fresh = await orderGet(env, d.id);
    if (!applyUspsDelivered(fresh, d.tn, d.at)) continue;
    try { await env.CACUSA_KV.put(orderKey(d.id), JSON.stringify(fresh)); out.escrituras++; out.entregados.push(fresh.numero || fresh.id); doneIds.add(String(d.id)); }
    catch (e) { console.error('entregado automático (put):', e.message); }
  }
  if (doneIds.size) { try { await refreshOrdersCache(env); out.escrituras++; } catch (_) {} }
  // Poda: solo quedan los pedidos que siguen "Enviado" con USPS (los demás ya no se consultan).
  const keep = new Set(orders.filter((o) => o && o.estado === 'Enviado' && orderHasUspsTracking(o)).map((o) => String(o.id)));
  const pruned = {};
  for (const [id, t] of Object.entries(checks)) if (keep.has(id) && !doneIds.has(id)) pruned[id] = t;
  try {
    await env.CACUSA_KV.put(USPS_AUTOTRACK_KEY, JSON.stringify({ day: today, used: usedToday + out.consultados, at: new Date(now).toISOString(), checks: pruned,
      last: { consultados: out.consultados, entregados: doneIds.size, ...(stop ? { frenado: stop } : {}) } }), { expirationTtl: 90 * 86400 });
    out.escrituras++;
  } catch (e) { console.error('uspsautotrack (put):', e.message); }
  if (tok) await uspsLog(env, 'auto-entrega', tok, stop ? 'error' : 'ok');
  if (stop) out.frenado = stop;
  return out;
}

// Reclamo de un solo intento en la DO (sin los reintentos de orderIdemClaim: en el cron un
// 'in_progress' significa que otra corrida lo está mandando ahora — se salta).
async function autoMailClaim(env, key) {
  const stub = orderIdemStub(env, key);
  if (!stub) return 'claimed'; // sin binding: la marca en KV queda como única defensa
  const r = await stub.fetch('https://order-idempotency.internal/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
  });
  const d = await r.json();
  return d.status === 'claimed' ? 'claimed' : d.status === 'done' ? 'done' : 'busy';
}

function autoMailLegalHtml(lang, unsubUrl, postal, kind) {
  const en = lang === 'en';
  const why = kind === 'cart'
    ? (en ? 'You are receiving this reminder because you entered your email at checkout on cacusabytaitus.com and agreed to it.'
          : 'Recibes este recordatorio porque dejaste tu correo en el checkout de cacusabytaitus.com y lo aceptaste.')
    : (en ? 'You are receiving this email because you placed an order at cacusabytaitus.com.'
          : 'Recibes este correo porque hiciste un pedido en cacusabytaitus.com.');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#A07090;margin-top:12px;">${why}<br><a href="${escAttr(unsubUrl)}" style="color:#C0336E;">${en ? 'Unsubscribe' : 'Darme de baja'}</a> · <a href="${MKT_SITE}/privacidad.html" style="color:#C0336E;">${en ? 'Privacy policy' : 'Política de privacidad'}</a>${postal ? `<br>CACUSA by Taitus · ${esc(postal)}` : ''}</div>`;
}

// Producto del catálogo → datos para el correo (todo armado en el servidor; nunca links ni
// fotos que vengan del navegador). Foto con catalogImageUrl + filtro https de mktUrl.
function autoMailProduct(p, lang) {
  const en = lang === 'en';
  const name = String((en && p.name_en) ? p.name_en : (p.name || '')).replace(/\s+/g, ' ').trim().slice(0, 120);
  const url = en
    ? `${MKT_SITE}/en/ui_kits/store/producto/${encodeURIComponent(mktProductParam(p, 'en'))}/`
    : `${MKT_SITE}/ui_kits/store/producto/${encodeURIComponent(mktProductParam(p, 'es'))}/`;
  const price = Number(resolveBasePrice(p));
  return { id: String(p.id), name, url, image: mktUrl(catalogImageUrl(p)), price: Number.isFinite(price) && price > 0 ? price : null, available: p.available !== false };
}

function autoMailItemRow(it, lang, rightHtml) {
  const img = it.image
    ? `<img src="${escAttr(it.image)}" alt="${escAttr(it.name)}" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:10px;border:0;">`
    : `<div style="width:64px;height:64px;border-radius:10px;background:#F3E4EE;"></div>`;
  return `<tr>
<td width="76" valign="middle" style="padding:8px 12px 8px 0;border-bottom:1px solid #F3E4EE;">${img}</td>
<td valign="middle" style="padding:8px 0;border-bottom:1px solid #F3E4EE;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8B2A5A;">${esc(it.name)}${it.qty > 1 ? ` × ${it.qty}` : ''}${rightHtml}</td>
</tr>`;
}

// Pedido de reseña. items: [{ name, image, url }] (url de la ficha; se le agrega #resena).
function reviewRequestEmailContent({ nombre, items, lang, unsubUrl, postal }) {
  const en = lang === 'en';
  const link = (it) => `<div style="margin-top:6px;"><a href="${escAttr(it.url + '#resena')}" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#C0336E;text-decoration:none;">${en ? 'Leave my review ✦' : 'Dejar mi reseña ✦'}</a></div>`;
  const rows = items.map((it) => autoMailItemRow(it, lang, link(it))).join('');
  const intro = en
    ? 'We hope you are loving your pieces. Your review helps other customers choose — and it means a lot to our small workshop.'
    : 'Esperamos que estés disfrutando tus piezas. Tu reseña ayuda a otras clientas a elegir — y para nuestro pequeño taller significa muchísimo.';
  const bodyHtml = `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#6B3A55;text-align:left;">${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">${rows}</table>`;
  const who = nombre ? ', ' + esc(nombre) : '';
  return {
    subject: en ? 'How did your order go? — CACUSA by Taitus' : '¿Cómo te fue con tu pedido? — CACUSA by Taitus',
    html: emailShellGeneric({
      lang,
      preheader: en ? 'Tell us what you think of your pieces — it takes one minute.' : 'Cuéntanos qué te parecieron tus piezas — toma un minuto.',
      eyebrow: en ? 'Your opinion matters' : 'Tu opinión nos importa',
      title: en ? `How did your order go${who}?` : `¿Cómo te fue con tu pedido${who}?`,
      bodyHtml, ctaText: '', ctaUrl: '',
      footerExtraHtml: autoMailLegalHtml(lang, unsubUrl, postal, 'review'),
    }),
  };
}

// Recordatorio de carrito. items: [{ name, image, url, qty }]; restoreUrl rellena el
// carrito en la tienda (?cart=id:qty,...). couponCode solo si CART_REMINDER_COUPON_PCT > 0.
function cartReminderEmailContent({ items, restoreUrl, lang, unsubUrl, postal, couponCode, couponPct }) {
  const en = lang === 'en';
  // Sin precios a propósito: la tienda puede sumar recargo o promo distintos según el día y
  // el método de pago — el precio real lo ve al volver al carrito.
  const rows = items.map((it) => autoMailItemRow(it, lang, '')).join('');
  const intro = en
    ? 'You left these pieces in your cart. We saved them for you — just tap the button to pick up where you left off.'
    : 'Dejaste estas piezas en tu carrito. Te las guardamos — toca el botón para seguir donde te quedaste.';
  const coupon = couponCode ? `<div style="margin:14px 0 4px;padding:12px;border:1.5px dashed #EE6FA8;border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#8B2A5A;">${en ? `Use code <strong>${esc(couponCode)}</strong> for ${couponPct}% off (valid for 7 days).` : `Usa el código <strong>${esc(couponCode)}</strong> y llévate ${couponPct}% de descuento (válido por 7 días).`}</div>` : '';
  const bodyHtml = `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#6B3A55;text-align:left;">${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">${rows}</table>${coupon}`;
  return {
    subject: en ? 'Your cart is waiting — CACUSA by Taitus' : 'Tu carrito te espera — CACUSA by Taitus',
    html: emailShellGeneric({
      lang,
      preheader: en ? 'Your pieces are still in your cart.' : 'Tus piezas siguen en tu carrito.',
      eyebrow: en ? 'Your cart' : 'Tu carrito',
      title: en ? 'Did you forget something?' : '¿Se te quedó algo?',
      bodyHtml,
      ctaText: en ? 'Back to my cart →' : 'Volver a mi carrito →',
      ctaUrl: escAttr(restoreUrl),
      footerExtraHtml: autoMailLegalHtml(lang, unsubUrl, postal, 'cart'),
    }),
  };
}

function cartRestoreUrl(items, lang) {
  const base = lang === 'en' ? `${MKT_SITE}/en/ui_kits/store/` : `${MKT_SITE}/ui_kits/store/`;
  const cart = items.map((it) => `${it.id}:${it.qty}`).join(',');
  return `${base}?cart=${encodeURIComponent(cart)}&utm_source=email&utm_medium=email&utm_campaign=cart_reminder`;
}

async function cartReminderCouponCode(email, env) {
  const sig = await hmac('cartrem:' + email, env.SESSION_SECRET);
  return 'VUELVE' + sig.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
async function ensureCartReminderCoupon(email, env) {
  const code = await cartReminderCouponCode(email, env);
  if (!(await couponGet(env, code))) {
    const expires = new Date(Date.now() + 7 * 86400000);
    await env.CACUSA_KV.put(couponKey(code), JSON.stringify({
      code, type: 'percent', amount: CART_REMINDER_COUPON_PCT, kind: 'cart-reminder',
      maxUses: 1, usedCount: 0, active: true, expiresAt: expires.toISOString().slice(0, 10),
      restrictToEmail: email, note: `Recordatorio de carrito ${CART_REMINDER_COUPON_PCT}% — ${email}`,
      createdAt: new Date().toISOString(), createdBy: 'cart-reminder-system',
    }));
  }
  return code;
}

// Email → fecha (ms) del pedido más reciente, desde orders_cache (1 lectura).
function latestOrderTimeByEmail(orders) {
  const m = new Map();
  for (const o of orders) {
    const em = String((o && o.cliente && o.cliente.email) || '').toLowerCase().trim();
    if (!em) continue;
    const t = o.fecha ? new Date(o.fecha).getTime() : 0;
    if (!m.has(em) || t > m.get(em)) m.set(em, t);
  }
  return m;
}

// ¿Este pedido califica para el pedido de reseña? (puro — lo usan el filtro y la relectura)
function reviewRequestEligible(o, now) {
  if (!o || typeof o !== 'object') return false;
  if (o.reviewReqAt) return false;                      // una sola vez por pedido
  if (o.estado === 'Cancelado') return false;
  if (o.archivado) return false;                        // archivado (wave 1): no se le pide nada
  if (!o.entregadoAt) return false;                     // sin señal de entrega, nada
  const email = String((o.cliente && o.cliente.email) || '').trim();
  if (!isValidEmail(email)) return false;
  const items = (Array.isArray(o.productos) ? o.productos : []).filter((p) => p && AUTO_ITEM_ID_RE.test(String(p.id || '')));
  if (!items.length) return false;                      // ej. caja de Lovers sin piezas cargadas
  const t = new Date(o.entregadoAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t >= REVIEW_REQUEST_DELAY_DAYS * 86400000 && now - t <= REVIEW_REQUEST_MAX_AGE_DAYS * 86400000;
}

// Error de Gmail que debe frenar toda la corrida (cupo o credenciales), como el marketing.
function autoMailStopError(e) { return /\((429|401|403)\)|token refresh|GMAIL_REFRESH_TOKEN/i.test(String(e && e.message || e)); }

async function runAutoEmails(env, { dryRun = false, subreqMax = AUTO_MAIL_SUBREQ_MAX } = {}) {
  const out = { dryRun, review: { candidatos: 0, enviados: 0, saltados: [] }, cart: { candidatos: 0, enviados: 0, convertidos: 0, saltados: [] }, llamadas: 0 };
  if (!env.CACUSA_KV) { out.error = 'KV no configurado'; return out; }
  const postal = String(env.MKT_POSTAL_ADDRESS || '').trim();
  if (!postal && !dryRun) { out.pausado = 'Falta MKT_POSTAL_ADDRESS (CAN-SPAM): no se manda nada'; return out; }
  const now = Date.now();
  const budget = { n: 0, max: Math.max(0, Math.min(AUTO_MAIL_SUBREQ_MAX, Number(subreqMax) || 0)) };
  const canSpend = (k) => budget.n + k <= budget.max;
  const base = String(env.PUBLIC_WORKER_URL || ADMIN_WORKER_PUBLIC_URL).replace(/\/+$/, '');

  let orders = [];
  try { const od = JSON.parse((await env.CACUSA_KV.get('orders_cache')) || '{}'); if (Array.isArray(od.orders)) orders = od.orders; } catch (_) {}
  const latestOrder = latestOrderTimeByEmail(orders);

  // Candidatas de reseña: agrupadas por email (1 correo con hasta 3 pedidos), la entrega más vieja primero.
  const revByEmail = new Map();
  for (const o of orders.filter((o) => reviewRequestEligible(o, now)).sort((a, b) => new Date(a.entregadoAt) - new Date(b.entregadoAt))) {
    const em = String(o.cliente.email).toLowerCase().trim();
    if (!revByEmail.has(em)) revByEmail.set(em, []);
    if (revByEmail.get(em).length < 3) revByEmail.get(em).push(o);
  }
  const revGroups = [...revByEmail].slice(0, AUTO_REVIEW_BATCH);
  out.review.candidatos = revByEmail.size;

  // Carritos pendientes: entre CART_REMINDER_DELAY_HOURS y CART_REMINDER_MAX_AGE_HOURS, sin recordar.
  const cartRecs = [];
  try {
    const vals = await kvGetMany(env, await kvListKeys(env, 'acart:'));
    for (const [k, raw] of vals) {
      let r; try { r = JSON.parse(raw || 'null'); } catch (_) { r = null; }
      if (!r || r.remindedAt || !isValidEmail(r.email || '') || acartKey(r.email) !== k) continue;
      const age = now - new Date(r.ts).getTime();
      if (!(age >= CART_REMINDER_DELAY_HOURS * 3600000 && age <= CART_REMINDER_MAX_AGE_HOURS * 3600000)) continue;
      cartRecs.push({ key: k, r });
    }
  } catch (e) { console.error('carritos pendientes:', e.message); }
  cartRecs.sort((a, b) => new Date(a.r.ts) - new Date(b.r.ts));
  out.cart.candidatos = cartRecs.length;

  // Bajas y recordatorios recientes: una sola lectura en bloque.
  const revEmails = revGroups.map(([em]) => em);
  const cartEmails = cartRecs.map((x) => x.r.email);
  const flags = await kvGetMany(env, [...new Set([...revEmails, ...cartEmails])].flatMap((e) => ['mktunsub:' + e, 'cartremsent:' + e]));
  const unsub = (e) => !!flags.get('mktunsub:' + e);

  if (dryRun) {
    out.review.lista = revGroups.map(([em, os]) => ({ pedidos: os.map((o) => o.numero || o.id), baja: unsub(em) }));
    out.cart.lista = cartRecs.slice(0, AUTO_CART_BATCH).map((x) => ({ items: x.r.items.length, desde: x.r.ts, baja: unsub(x.r.email), compro: (latestOrder.get(x.r.email) || -1) >= new Date(x.r.ts).getTime() }));
    out.postal = !!postal;
    return out;
  }
  if (!revGroups.length && !cartRecs.length) return out;

  const usadosHoy = await mktSentToday(env);
  let cupo = MKT_DAILY_CAP - usadosHoy;
  let catalog = null, accessToken = null, stop = '';
  const getCatalog = async () => {
    if (catalog) return catalog;
    if (!canSpend(2)) return null;
    budget.n += 2; // hasta 2 intentos
    const c = await fetchCatalogForOrderValidation();
    catalog = c ? new Map(c.products.map((p) => [String(p.id), p])) : null;
    return catalog;
  };
  const getToken = async () => {
    if (accessToken) return accessToken;
    budget.n += 1;
    accessToken = await gmailAccessToken(env);
    return accessToken;
  };
  let ordersChanged = false, enviadosTotal = 0;

  // ── A) Pedido de reseña ──
  for (const [em, os] of revGroups) {
    if (stop || cupo <= 0) break;
    if (unsub(em)) { out.review.saltados.push('baja'); continue; }
    if (!canSpend(AUTO_MAIL_COST_PER_EMAIL + (accessToken ? 0 : 1) + (catalog ? 0 : 2))) { out.review.saltados.push('presupuesto'); break; }
    // Relectura real de cada pedido (orders_cache puede estar atrasada).
    const fresh = [];
    for (const o of os) { const f = await orderGet(env, o.id); if (reviewRequestEligible(f, now) && String(f.cliente.email).toLowerCase().trim() === em) fresh.push(f); }
    if (!fresh.length) { out.review.saltados.push('ya no califica'); continue; }
    const cat = await getCatalog();
    if (!cat) { stop = 'catálogo no disponible'; break; }
    const lang = fresh[0].cliente.idioma === 'en' ? 'en' : 'es';
    const seen = new Set(), items = [];
    for (const f of fresh) for (const p of f.productos) {
      const prod = cat.get(String(p.id));
      if (!prod || seen.has(String(prod.id))) continue;
      seen.add(String(prod.id)); items.push(autoMailProduct(prod, lang));
    }
    const claimKey = 'reviewreq:' + fresh[0].id;
    budget.n += 1;
    const claim = await autoMailClaim(env, claimKey);
    if (claim === 'busy') { out.review.saltados.push('en curso'); continue; }
    // Ya se mandó (la marca de KV no llegó a escribirse): solo se repara la marca, sin tope.
    if (claim === 'claimed') {
      budget.n += 1;
      if (!(await rateLimit(env, 'mailauto', em, 1, AUTO_MAIL_RECIPIENT_WINDOW))) {
        budget.n += 1; await orderIdemRelease(env, claimKey).catch(() => {});
        out.review.saltados.push('tope por destinataria'); continue;
      }
    }
    let sentOk = claim === 'done';
    if (claim === 'claimed') {
      if (!items.length) {
        // Ninguna pieza sigue en el catálogo: se marca sin mandar (no hay ficha a la cual llevarla).
        sentOk = true;
      } else {
        try {
          const unsubUrl = await mktUnsubUrl(em, env, base);
          const content = reviewRequestEmailContent({ nombre: String(fresh[0].cliente.nombre || '').trim().slice(0, 60), items: items.slice(0, 8), lang, unsubUrl, postal });
          const token = await getToken();
          budget.n += 1;
          await sendGmail(env, { to: em, ...content, accessToken: token, headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
          sentOk = true; out.review.enviados++; enviadosTotal++; cupo--;
        } catch (e) {
          console.error('pedido de reseña falló:', e.message);
          if (autoMailStopError(e)) stop = String(e.message).slice(0, 200);
        }
      }
    }
    if (sentOk) {
      // Primero la DO queda en 'done' (defensa principal), después la marca en KV — si
      // esta falla, la próxima corrida ve 'done' y solo la repara, nunca reenvía.
      if (claim === 'claimed') { budget.n += 1; await orderIdemFinalize(env, claimKey, fresh[0].id).catch(() => {}); }
      const at = new Date().toISOString();
      for (const f of fresh) {
        f.reviewReqAt = at; f.reviewReqStatus = items.length ? 'enviado' : 'sin piezas en el catálogo';
        try { await env.CACUSA_KV.put(orderKey(f.id), JSON.stringify(f)); ordersChanged = true; }
        catch (e) { console.error('marca reviewReqAt falló (la DO ya evita el reenvío):', e.message); }
      }
    } else if (claim === 'claimed') {
      budget.n += 1; await orderIdemRelease(env, claimKey).catch(() => {});
    }
  }

  // ── B) Recordatorio de carrito ──
  for (const { key, r } of cartRecs.slice(0, AUTO_CART_BATCH)) {
    if (stop || cupo <= 0) break;
    const em = r.email;
    const tsMs = new Date(r.ts).getTime();
    // Ya compró (pedido con ese email después del carrito): convertido, se borra.
    if ((latestOrder.get(em) || -1) >= tsMs) { await env.CACUSA_KV.delete(key).catch(() => {}); out.cart.convertidos++; continue; }
    if (unsub(em)) { await env.CACUSA_KV.delete(key).catch(() => {}); out.cart.saltados.push('baja'); continue; }
    if (flags.get('cartremsent:' + em)) { out.cart.saltados.push('ya recordado esta semana'); continue; }
    if (!canSpend(AUTO_MAIL_COST_PER_EMAIL + (accessToken ? 0 : 1) + (catalog ? 0 : 2))) { out.cart.saltados.push('presupuesto'); break; }
    const cat = await getCatalog();
    if (!cat) { stop = 'catálogo no disponible'; break; }
    const lang = r.lang === 'en' ? 'en' : 'es';
    const items = [];
    for (const it of cleanPendingItems(r.items)) {
      const prod = cat.get(it.id);
      if (!prod) continue;
      const p = autoMailProduct(prod, lang);
      if (!p.available) continue; // agotada o pausada: no se recuerda
      items.push({ ...p, qty: it.qty });
    }
    const ttlLeft = Math.max(60, Math.floor((tsMs + CART_PENDING_TTL_SECONDS * 1000 - now) / 1000));
    if (!items.length) {
      await env.CACUSA_KV.put(key, JSON.stringify({ ...r, remindedAt: new Date().toISOString(), remindStatus: 'sin piezas disponibles' }), { expirationTtl: ttlLeft }).catch(() => {});
      out.cart.saltados.push('sin piezas disponibles'); continue;
    }
    const claimKey = `cartrem:${em}:${r.ts}`;
    budget.n += 1;
    const claim = await autoMailClaim(env, claimKey);
    if (claim === 'busy') { out.cart.saltados.push('en curso'); continue; }
    if (claim === 'claimed') {
      budget.n += 1;
      if (!(await rateLimit(env, 'mailauto', em, 1, AUTO_MAIL_RECIPIENT_WINDOW))) {
        budget.n += 1; await orderIdemRelease(env, claimKey).catch(() => {});
        out.cart.saltados.push('tope por destinataria'); continue;
      }
    }
    let sentOk = claim === 'done';
    if (claim === 'claimed') {
      try {
        const couponCode = CART_REMINDER_COUPON_PCT > 0 && env.SESSION_SECRET ? await ensureCartReminderCoupon(em, env) : '';
        const unsubUrl = await mktUnsubUrl(em, env, base);
        const content = cartReminderEmailContent({ items, restoreUrl: cartRestoreUrl(items, lang), lang, unsubUrl, postal, couponCode, couponPct: CART_REMINDER_COUPON_PCT });
        const token = await getToken();
        budget.n += 1;
        await sendGmail(env, { to: em, ...content, accessToken: token, headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
        sentOk = true; out.cart.enviados++; enviadosTotal++; cupo--;
      } catch (e) {
        console.error('recordatorio de carrito falló:', e.message);
        if (autoMailStopError(e)) stop = String(e.message).slice(0, 200);
      }
    }
    if (sentOk) {
      if (claim === 'claimed') { budget.n += 1; await orderIdemFinalize(env, claimKey, 'sent').catch(() => {}); }
      await env.CACUSA_KV.put(key, JSON.stringify({ ...r, remindedAt: new Date().toISOString() }), { expirationTtl: ttlLeft }).catch(() => {});
      await env.CACUSA_KV.put('cartremsent:' + em, '1', { expirationTtl: CART_REMINDER_EVERY_DAYS * 86400 }).catch(() => {});
    } else if (claim === 'claimed') {
      budget.n += 1; await orderIdemRelease(env, claimKey).catch(() => {});
    }
  }

  if (enviadosTotal) await mktAddSent(env, enviadosTotal).catch(() => {});
  if (ordersChanged) await refreshOrdersCache(env).catch(() => {});
  if (stop) out.frenado = stop;
  if (cupo <= 0) out.topeDiario = true;
  out.llamadas = budget.n;
  return out;
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
// Respuesta JSON con status arbitrario (ej. 409 con datos para resolver el conflicto).
function jsonResp(obj, status, origin) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}
