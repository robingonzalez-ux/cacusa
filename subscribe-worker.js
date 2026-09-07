/**
 * Cacusa Lovers — Subscription Worker
 * Deploy to Cloudflare Workers as: cacusa-subscribe.facturacioncacusa.workers.dev
 *
 * Environment variables (set as Secrets in CF Dashboard):
 *   SQUARE_ACCESS_TOKEN      — Production access token from Square Developer
 *   SQUARE_LOCATION_ID       — Your Square location ID
 *   SQUARE_PLAN_VARIATION_ID — Subscription plan variation ID (from Square Dashboard)
 *
 * KV Namespace (Cloudflare → Settings → Bindings), OPCIONAL pero recomendado:
 *   CACUSA_KV — el mismo namespace que ya usan cacusa-admin y cacusa-lovers-webhook.
 *               Si está enlazado, este worker limita a 10 solicitudes/hora por IP para
 *               que el formulario público no se pueda usar para gastar cuota de la API
 *               de Square sin límite. Si no está enlazado, el worker sigue funcionando
 *               normal, simplemente sin ese límite.
 *
 * Setup steps:
 *   1. In Square Dashboard → Subscriptions → Create plan "Cacusa Lovers" $20/month
 *   2. Copy the plan variation ID and set it as SQUARE_PLAN_VARIATION_ID secret
 *   3. Deploy this worker and set the 3 secrets above
 */

const SQUARE_API  = 'https://connect.squareup.com/v2';
const RETURN_URL  = 'https://cacusabytaitus.com/cacusa-lovers.html?subscribed=1';
const ALLOWED_ORIGIN = 'https://cacusabytaitus.com';

const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { name, lastname = '', email, phone, address, apto = '', city, state = '', country } = body;

    if (!name || !email || !phone || !address || !city || !country) {
      return json({ error: 'Faltan datos requeridos (nombre, email, teléfono, dirección, ciudad, país).' }, 400);
    }

    // Rate limit por IP (10/hr) — evita que el formulario público se use sin límite para
    // generar payment links de Square (gasta cuota/costo de la API). Solo aplica si el
    // namespace CACUSA_KV está enlazado a este worker; si no, no bloquea nada.
    if (env.CACUSA_KV) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rlKey = `sub-rl:${ip}`;
      const rlCount = parseInt((await env.CACUSA_KV.get(rlKey)) || '0', 10);
      if (rlCount >= 10) return json({ error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429);
      await env.CACUSA_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
    }

    const idempotencyKey = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Normalize phone to E.164 format
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;

    const addressLine1 = address + (apto ? `, ${apto}` : '');

    const squarePayload = {
      idempotency_key: idempotencyKey,
      subscription_plan_variation_id: env.SQUARE_PLAN_VARIATION_ID,
      pre_populated_data: {
        buyer_email:        email,
        buyer_phone_number: normalizedPhone,
        buyer_address: {
          first_name:                   name,
          last_name:                    lastname,
          address_line_1:               addressLine1,
          locality:                     city,
          country:                      country === 'EC' ? 'EC' : 'US',
          ...(state                 ? { administrative_district_level_1: state } : {}),
        },
      },
      checkout_options: {
        redirect_url:             RETURN_URL,
        merchant_support_email:   'facturacioncacusa@gmail.com',
        allow_tipping:            false,
      },
    };

    let squareResp, squareData;
    try {
      squareResp = await fetch(`${SQUARE_API}/online-checkout/payment-links`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          'Content-Type':  'application/json',
          'Square-Version': '2024-11-20',
        },
        body: JSON.stringify(squarePayload),
      });
      squareData = await squareResp.json();
    } catch (err) {
      return json({ error: 'Error de red al contactar Square.' }, 502);
    }

    if (!squareResp.ok || !squareData.payment_link?.url) {
      const detail = squareData.errors?.[0]?.detail || 'Error desconocido de Square';
      console.error('Square error:', JSON.stringify(squareData));
      return json({ error: detail }, 500);
    }

    return json({ checkoutUrl: squareData.payment_link.url });
  },
};
