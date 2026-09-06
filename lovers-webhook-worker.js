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
 *   ADMIN_ACTION_KEY              — clave compartida con el admin panel para las rutas /admin/*
 *                                   (no confundir con FB_DB_SECRET: esta autentica al admin
 *                                   contra ESTE worker; FB_DB_SECRET autentica a ESTE worker
 *                                   contra Firebase)
 *
 * Square events subscribed (in Square Dashboard → Webhooks):
 *   subscription.created            → crea registro en Firebase cuando nace la suscripción
 *   invoice.payment_made            → marca suscriptora como "activo"
 *   invoice.scheduled_charge_failed → marca suscriptora como "pago_fallido"
 *   subscription.updated            → si status=CANCELED, marca "cancelado"
 *
 * Rutas:
 *   POST   /webhook                    → recibe webhooks de Square (firmados)
 *   POST   /admin/cancel-subscription  → cancela una suscripción en Square
 *   GET    /admin/lovers                → lista suscriptoras + fotos destacadas
 *   PATCH  /admin/lovers/{id}           → actualiza campos de una suscriptora
 *   DELETE /admin/lovers/{id}           → elimina una suscriptora
 *   PUT    /admin/lovers-photos         → guarda las fotos destacadas de la página pública
 *   Todas las rutas /admin/* se autentican con el header X-Admin-Key (no con la firma de Square).
 *
 * Por qué existe este worker en el medio (en vez de que el admin hable directo con Firebase):
 *   Las reglas de Firebase para cacusa_lovers / cacusa_lovers_photos solo permiten CREAR un
 *   registro nuevo con auth anónimo (lo que necesita el formulario público de suscripción) —
 *   leer, editar o borrar un registro existente requiere el FB_DB_SECRET, que nunca se expone
 *   al navegador. El admin panel pasa esas acciones por acá.
 *
 * Setup:
 *   1. Deploy this worker (pegar en Cloudflare Dashboard → Edit code → Save and deploy)
 *   2. Set the 4 secrets above
 *   3. Square Dashboard → Developers → Webhooks → Add endpoint
 *      URL: https://cacusa-lovers-webhook.facturacioncacusa.workers.dev/webhook
 *      Events: subscription.created, invoice.payment_made, invoice.scheduled_charge_failed, subscription.updated
 *   4. Copy the "Signature key" from the webhook detail page → set as SQUARE_WEBHOOK_SIGNATURE_KEY
 */

const SQUARE_API = 'https://connect.squareup.com/v2';
const ADMIN_ORIGIN = 'https://cacusabytaitus.com';
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
  return expected === sigHeader;
}

// ── Find Firebase subscriber key by email ────────────────────────────────────
async function findSubscriberByEmail(email, dbUrl, fbAuth) {
  const url = `${dbUrl}/cacusa_lovers.json?auth=${fbAuth}&orderBy="email"&equalTo="${encodeURIComponent(email)}"`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  if (!data) return null;
  const keys = Object.keys(data);
  return keys.length > 0 ? keys[0] : null;
}

// ── Update subscriber in Firebase. estadoPago=null deja el estado como está ──
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

// ── Create new subscriber record in Firebase ───────────────────────────────────
async function createSubscriber(data, dbUrl, fbAuth) {
  const url = `${dbUrl}/cacusa_lovers.json?auth=${fbAuth}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => r.status);
    console.error(`Firebase POST failed (${r.status}):`, errText);
    return null;
  }
  const d = await r.json();
  return d?.name || null; // Firebase returns { name: "<key>" }
}

// ── Get customer from Square ──────────────────────────────────────────────────
async function getSquareCustomer(customerId, squareToken) {
  if (!customerId) return null;
  const r = await fetch(`${SQUARE_API}/customers/${customerId}`, {
    headers: { 'Authorization': `Bearer ${squareToken}`, 'Square-Version': '2024-11-20' }
  });
  if (!r.ok) return null;
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

// ── Autenticación de las rutas /admin/* ───────────────────────────────────────
function isAuthorizedAdmin(request, env) {
  return !!env.ADMIN_ACTION_KEY && request.headers.get('x-admin-key') === env.ADMIN_ACTION_KEY;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
    const fbAuth = env.FB_DB_SECRET;

    // ── Rutas de administración (todas usan X-Admin-Key, no la firma de Square) ──
    if (url.pathname === '/admin/cancel-subscription' || url.pathname === '/admin/lovers' ||
        url.pathname === '/admin/lovers-photos' || url.pathname.startsWith('/admin/lovers/')) {

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: ADMIN_CORS });
      }
      if (!isAuthorizedAdmin(request, env)) {
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
        if (request.method !== 'GET') return adminJson({ error: 'Method not allowed' }, 405);
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
          const r = await fetch(`${dbUrl}/cacusa_lovers/${id}.json?auth=${fbAuth}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
          });
          if (!r.ok) {
            const errText = await r.text().catch(() => r.status);
            return adminJson({ error: 'No se pudo actualizar', detail: errText }, 502);
          }
          return adminJson({ ok: true }, 200);
        }

        if (request.method === 'DELETE') {
          const r = await fetch(`${dbUrl}/cacusa_lovers/${id}.json?auth=${fbAuth}`, { method: 'DELETE' });
          if (!r.ok) {
            const errText = await r.text().catch(() => r.status);
            return adminJson({ error: 'No se pudo eliminar', detail: errText }, 502);
          }
          return adminJson({ ok: true }, 200);
        }

        return adminJson({ error: 'Method not allowed' }, 405);
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
          const existingKey = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbAuth);
          if (!existingKey) {
            const newKey = await createSubscriber({
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
              estado_pago: 'pendiente',
              square_subscription_id: sub.id || '',
            }, dbUrl, fbAuth);
            console.log('Created subscriber record (subscription.created):', email, '→', newKey);
          } else {
            // Ya existe (vino del formulario): solo adjuntar la referencia de Square,
            // sin tocar sus datos ni su estado_pago actual.
            await updateSubscriber(existingKey, null, {
              square_subscription_id: sub.id || '',
            }, dbUrl, fbAuth);
            console.log('Attached square_subscription_id to existing record (subscription.created):', email);
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
          const key = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbAuth);
          if (key) {
            // Ya existe (vino del formulario o de subscription.created): solo confirmar el pago,
            // NO pisar sus datos con lo que tenga Square (suele venir incompleto o vacio).
            await updateSubscriber(key, 'activo', {
              ultimo_pago: today,
              square_invoice_id: invoice?.id || '',
            }, dbUrl, fbAuth);
            console.log('Marked activo:', email);
          } else {
            // Subscriber not in Firebase yet — create minimal record
            // Detect annual vs monthly from invoice amount (annual = ~$219.89 = 21989 cents)
            const amountCents = invoice?.payment_requests?.[0]?.computed_amount_money?.amount || 0;
            const isAnnual = amountCents > 5000;
            const newKey = await createSubscriber({
              email: email.toLowerCase(),
              ...customerFields,
              plan: isAnnual ? 'Cacusa Lovers Anual' : 'Cacusa Lovers',
              monto: isAnnual ? '$219.89/año' : '$19.99/mes',
              fecha: today,
              estado_pago: 'activo',
              ultimo_pago: today,
              square_invoice_id: invoice?.id || '',
            }, dbUrl, fbAuth);
            console.log('Created activo record for:', email, '→', newKey);
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
          const key = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbAuth);
          if (key) {
            await updateSubscriber(key, 'pago_fallido', {}, dbUrl, fbAuth);
            console.log('Marked pago_fallido:', email);
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
            const key = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbAuth);
            if (key) {
              await updateSubscriber(key, 'cancelado', {
                fecha_cancelacion: new Date().toISOString().slice(0, 10),
              }, dbUrl, fbAuth);
              console.log('Marked cancelado:', email);
            } else {
              console.warn('subscription.updated CANCELED: no matching subscriber for', email);
            }
          }
        }
      }

    } catch (err) {
      console.error('Handler error:', err.message);
    }

    // Always return 200 to Square (prevents retries)
    return new Response('OK', { status: 200 });
  },
};
