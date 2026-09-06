/**
 * Cacusa Lovers — Square Webhook Worker
 * Deploy to Cloudflare Workers as: cacusa-lovers-webhook.facturacioncacusa.workers.dev
 *
 * Environment variables (Secrets in CF Dashboard):
 *   SQUARE_WEBHOOK_SIGNATURE_KEY  — from Square Dashboard → Webhooks → signature key
 *   SQUARE_ACCESS_TOKEN           — Square API access token (from Square Developer Dashboard)
 *   FB_API_KEY                    — AIzaSyDwEVeHU0mwSekHbrKM8EjBgn4HSM3zZfM
 *   FB_DB_URL                     — https://cacusa-pos-default-rtdb.firebaseio.com
 *   ADMIN_ACTION_KEY              — clave compartida con el admin para poder cancelar
 *                                   suscripciones desde el panel (ver POST /admin/cancel-subscription)
 *
 * Square events subscribed (in Square Dashboard → Webhooks):
 *   subscription.created            → crea registro en Firebase cuando nace la suscripción
 *   invoice.payment_made            → marca suscriptora como "activo"
 *   invoice.scheduled_charge_failed → marca suscriptora como "pago_fallido"
 *   subscription.updated            → si status=CANCELED, marca "cancelado"
 *
 * Rutas:
 *   POST /webhook                    → recibe webhooks de Square (firmados)
 *   POST /admin/cancel-subscription  → llamado por el admin panel para cancelar una
 *                                       suscripción en Square (autenticado con ADMIN_ACTION_KEY,
 *                                       no con la firma de Square)
 *
 * Setup:
 *   1. Deploy this worker (wrangler deploy)
 *   2. Set the 5 secrets above
 *   3. Square Dashboard → Developers → Webhooks → Add endpoint
 *      URL: https://cacusa-lovers-webhook.facturacioncacusa.workers.dev/webhook
 *      Events: invoice.payment_made, invoice.scheduled_charge_failed, subscription.updated
 *   4. Copy the "Signature key" from the webhook detail page → set as SQUARE_WEBHOOK_SIGNATURE_KEY
 */

const SQUARE_API = 'https://connect.squareup.com/v2';
const ADMIN_ORIGIN = 'https://cacusabytaitus.com';
const ADMIN_CORS = {
  'Access-Control-Allow-Origin': ADMIN_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// ── Firebase anonymous auth ───────────────────────────────────────────────────
async function fbSignIn(apiKey) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }) }
  );
  if (!r.ok) return null;
  const d = await r.json();
  return d.idToken || null;
}

// ── Find Firebase subscriber key by email ────────────────────────────────────
async function findSubscriberByEmail(email, dbUrl, token) {
  const url = `${dbUrl}/cacusa_lovers.json?auth=${token}&orderBy="email"&equalTo="${encodeURIComponent(email)}"`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  if (!data) return null;
  const keys = Object.keys(data);
  return keys.length > 0 ? keys[0] : null;
}

// ── Update subscriber in Firebase. estadoPago=null deja el estado como está ──
async function updateSubscriber(key, estadoPago, extras, dbUrl, token) {
  const url = `${dbUrl}/cacusa_lovers/${key}.json?auth=${token}`;
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
}

// ── Create new subscriber record in Firebase ───────────────────────────────────
async function createSubscriber(data, dbUrl, token) {
  const url = `${dbUrl}/cacusa_lovers.json?auth=${token}`;
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

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Acción de admin: cancelar una suscripción directo desde el panel ──────
    if (url.pathname === '/admin/cancel-subscription') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: ADMIN_CORS });
      }
      if (request.method !== 'POST') {
        return adminJson({ error: 'Method not allowed' }, 405);
      }
      if (!env.ADMIN_ACTION_KEY || request.headers.get('x-admin-key') !== env.ADMIN_ACTION_KEY) {
        return adminJson({ error: 'Unauthorized' }, 401);
      }

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
        const fbToken = await fbSignIn(env.FB_API_KEY);
        const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';
        if (fbToken) {
          await updateSubscriber(firebaseKey, 'cancelado', {
            fecha_cancelacion: new Date().toISOString().slice(0, 10),
          }, dbUrl, fbToken);
        }
      } catch (e) { console.error('Firebase update after cancel failed:', e.message); }

      return adminJson({ ok: true }, 200);
    }

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

    // Authenticate with Firebase
    const fbToken = await fbSignIn(env.FB_API_KEY);
    if (!fbToken) {
      console.error('Firebase auth failed');
      return new Response('Internal Error', { status: 500 });
    }

    const dbUrl = env.FB_DB_URL || 'https://cacusa-pos-default-rtdb.firebaseio.com';

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
          const existingKey = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbToken);
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
            }, dbUrl, fbToken);
            console.log('Created subscriber record (subscription.created):', email, '→', newKey);
          } else {
            // Ya existe (vino del formulario): solo adjuntar la referencia de Square,
            // sin tocar sus datos ni su estado_pago actual.
            await updateSubscriber(existingKey, null, {
              square_subscription_id: sub.id || '',
            }, dbUrl, fbToken);
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
          const key = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbToken);
          if (key) {
            // Ya existe (vino del formulario o de subscription.created): solo confirmar el pago,
            // NO pisar sus datos con lo que tenga Square (suele venir incompleto o vacio).
            await updateSubscriber(key, 'activo', {
              ultimo_pago: today,
              square_invoice_id: invoice?.id || '',
            }, dbUrl, fbToken);
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
            }, dbUrl, fbToken);
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
          const key = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbToken);
          if (key) {
            await updateSubscriber(key, 'pago_fallido', {}, dbUrl, fbToken);
            console.log('Marked pago_fallido:', email);
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
            const key = await findSubscriberByEmail(email.toLowerCase(), dbUrl, fbToken);
            if (key) {
              await updateSubscriber(key, 'cancelado', {
                fecha_cancelacion: new Date().toISOString().slice(0, 10),
              }, dbUrl, fbToken);
              console.log('Marked cancelado:', email);
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
