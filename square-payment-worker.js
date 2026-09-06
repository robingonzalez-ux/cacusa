/**
 * CACUSA Square Payment Worker
 * Cloudflare Worker — creates Square Payment Links securely, and verifies real
 * payment completion via webhook (en vez de confiar en el navegador del cliente).
 *
 * Environment variables (Secrets in CF Dashboard):
 *   SQUARE_ACCESS_TOKEN          — Production Access Token from Square Developer Portal
 *   SQUARE_LOCATION_ID           — Location ID from Square Dashboard → Settings → Locations
 *   SQUARE_WEBHOOK_SIGNATURE_KEY — Square Dashboard → Webhooks → tu endpoint → Signature key
 *   ORDER_INGEST_KEY             — secret compartido con cacusa-admin: le prueba a ese Worker
 *                                   que este pedido viene de un pago YA confirmado por Square,
 *                                   no de una petición del navegador del cliente.
 *
 * KV Namespace (Bindings) — el mismo CACUSA_KV que usa cacusa-admin:
 *   CACUSA_KV — guarda el pedido pendiente mientras el cliente paga, y las tarjetas
 *               de regalo / cupones (solo lectura desde acá).
 *
 * Rutas:
 *   POST /              → crea el Payment Link (flujo existente, sin cambios para el cliente)
 *   POST /webhook        → recibe la confirmación de pago de Square (firmada con HMAC).
 *                          Este es el ÚNICO lugar que crea el pedido "de verdad" en el admin,
 *                          quema el cupón y redime la tarjeta de regalo — el regreso del
 *                          navegador a ?paid=1 ya NO hace nada de eso, solo muestra un mensaje.
 *
 * Por qué existe este cambio:
 *   Antes, Square redirigía siempre a la misma URL fija (?paid=1) sin importar si el pago
 *   se completó o no, y el propio navegador del cliente decidía crear el pedido y quemar el
 *   cupón/tarjeta de regalo con solo ver ese parámetro en la URL — cualquiera podía escribir
 *   esa URL directamente sin haber pagado. Ahora Square le avisa a este Worker por webhook
 *   (firmado, no falsificable) cuándo el pago se completó de verdad, y solo entonces se
 *   registra el pedido.
 *
 * Setup del webhook:
 *   1. Square Dashboard → Developers → Webhooks → Add endpoint
 *      URL: https://cacusa-square.<tu-subdominio>.workers.dev/webhook
 *      Evento: payment.updated
 *   2. Copiar el "Signature key" de esa pantalla → guardar como SQUARE_WEBHOOK_SIGNATURE_KEY
 *   3. Generar un valor random largo para ORDER_INGEST_KEY y ponerlo también en cacusa-admin
 *      (mismo nombre de secret, mismo valor en los dos Workers)
 */

// Tasas de impuesto estatal base USA (AK, DE, MT, NH, OR = 0%, no incluidos)
const US_STATE_TAX = {
  AL:0.04,  AZ:0.056,  AR:0.065,  CA:0.0725, CO:0.029,  CT:0.0635,
  FL:0.07,  GA:0.04,   HI:0.04,   ID:0.06,   IL:0.0625, IN:0.07,
  IA:0.06,  KS:0.065,  KY:0.06,   LA:0.0445, ME:0.055,  MD:0.06,
  MA:0.0625,MI:0.06,   MN:0.06875,MS:0.07,   MO:0.04225,NE:0.055,
  NV:0.0685,NJ:0.06625,NM:0.05,   NY:0.04,   NC:0.0475, ND:0.05,
  OH:0.0575,OK:0.045,  PA:0.06,   RI:0.07,   SC:0.06,   SD:0.045,
  TN:0.07,  TX:0.0625, UT:0.0485, VT:0.06,   VA:0.053,  WA:0.065,
  WV:0.06,  WI:0.05,   WY:0.04,   DC:0.06
};
// Tasa combinada (estado+local) por prefijo ZIP — principales metros de USA
const ZIP_TAX = {
  // FLORIDA (base 6% + surtax condado)
  '320':0.075,'321':0.070,'322':0.075,'323':0.075,'324':0.075,'325':0.075,
  '326':0.065,'327':0.065,'328':0.065,'329':0.070,
  '330':0.070,'331':0.070,'332':0.070,'333':0.070,'334':0.070,
  '335':0.075,'336':0.075,'337':0.070,'338':0.070,'339':0.065,
  '340':0.075,'341':0.070,'342':0.070,
  '344':0.065,'345':0.070,'346':0.070,'347':0.070,'348':0.070,'349':0.070,
  // NEW YORK
  '100':0.08875,'101':0.08875,'102':0.08875,'103':0.08875,'104':0.08875,
  '110':0.08875,'111':0.08875,'113':0.08875,'114':0.08875,'116':0.08875,
  '105':0.08375,'106':0.08375,'107':0.08750,'108':0.08625,'109':0.08625,
  '115':0.08625,'117':0.08625,'118':0.08625,'119':0.08625,
  '120':0.080,'121':0.080,'122':0.080,'123':0.080,'124':0.080,'125':0.080,
  '126':0.080,'127':0.080,'128':0.080,'129':0.080,'130':0.080,'131':0.080,
  '132':0.080,'133':0.080,'134':0.080,'135':0.080,'136':0.080,'137':0.080,
  '138':0.080,'139':0.080,'140':0.080,'141':0.080,'142':0.080,'143':0.080,
  '144':0.080,'145':0.080,'146':0.080,'147':0.080,'148':0.080,'149':0.080,
  // CALIFORNIA
  '900':0.0950,'901':0.1025,'902':0.1000,'903':0.1025,'904':0.1025,
  '905':0.1025,'906':0.1025,'907':0.1025,'908':0.1025,
  '910':0.0950,'911':0.1025,'912':0.1025,'913':0.0975,'914':0.0975,
  '915':0.0950,'916':0.0875,'917':0.0950,'918':0.0825,
  '919':0.0775,'920':0.0775,'921':0.0775,'922':0.0775,'923':0.0775,'924':0.0775,
  '925':0.0975,'926':0.0775,'927':0.0775,'928':0.0775,
  '930':0.0775,'931':0.0775,'932':0.0775,'933':0.0775,'934':0.0775,'935':0.0775,
  '940':0.0863,'941':0.0863,'942':0.0863,'943':0.0913,
  '944':0.0925,'945':0.1025,'946':0.1025,'947':0.1025,'948':0.0925,'949':0.0875,
  '950':0.0925,'951':0.0925,'952':0.0925,
  '953':0.0725,'954':0.0725,'955':0.0725,'956':0.0725,'957':0.0725,
  '958':0.0725,'959':0.0725,'960':0.0725,'961':0.0725,
  // ILLINOIS
  '606':0.1025,'607':0.1025,'608':0.1025,
  '600':0.0800,'601':0.0800,'602':0.0800,'603':0.0800,'604':0.0800,'605':0.0875,
  '609':0.0725,'610':0.0725,'611':0.0725,'612':0.0725,'613':0.0725,'614':0.0725,
  '615':0.0725,'616':0.0725,'617':0.0725,'618':0.0725,'619':0.0725,
  '620':0.0725,'621':0.0725,'622':0.0725,'623':0.0725,'624':0.0725,
  '625':0.0725,'626':0.0725,'627':0.0725,'628':0.0725,'629':0.0725,
  // TEXAS
  '750':0.0825,'751':0.0825,'752':0.0825,'753':0.0825,'754':0.0825,
  '755':0.0825,'756':0.0825,'757':0.0825,'758':0.0825,'759':0.0825,
  '760':0.0825,'761':0.0825,'762':0.0825,'763':0.0825,'764':0.0825,
  '765':0.0825,'766':0.0825,'767':0.0825,'768':0.0825,'769':0.0825,
  '770':0.0825,'771':0.0825,'772':0.0825,'773':0.0825,'774':0.0825,
  '775':0.0825,'776':0.0825,'777':0.0825,'778':0.0825,'779':0.0825,
  '780':0.0825,'781':0.0825,'782':0.0825,'783':0.0825,'784':0.0825,
  '785':0.0825,'786':0.0825,'787':0.0825,'788':0.0825,'789':0.0825,
  '790':0.0825,'791':0.0825,'792':0.0825,'793':0.0825,'794':0.0825,
  '795':0.0825,'796':0.0825,'797':0.0825,'798':0.0825,'799':0.0825,
  // WASHINGTON
  '980':0.1025,'981':0.1025,'982':0.1025,
  '983':0.0890,'984':0.0890,'985':0.0890,'986':0.0890,
  '988':0.0890,'989':0.0890,'990':0.0890,'991':0.0890,'992':0.0890,
  '993':0.0860,'994':0.0860,
  // COLORADO
  '800':0.0888,'801':0.0861,'802':0.0881,'803':0.0630,'804':0.0630,'805':0.0815,
  // LOUISIANA
  '700':0.0995,'701':0.0995,'702':0.0995,'703':0.0995,'704':0.0995,
  '705':0.0945,'706':0.0945,'707':0.0945,'708':0.0945,
  '710':0.0945,'711':0.0945,'712':0.0945,'713':0.0945,'714':0.0945,
  // TENNESSEE
  '370':0.0975,'371':0.0975,'372':0.0975,'373':0.0975,'374':0.0975,
  '375':0.0975,'376':0.0975,'377':0.0975,'378':0.0975,'379':0.0975,
  '380':0.0975,'381':0.0975,'382':0.0975,'383':0.0975,'384':0.0975,'385':0.0975,
  // GEORGIA
  '300':0.0875,'301':0.0875,'302':0.0875,'303':0.0875,'304':0.0875,'305':0.0875,
  '306':0.0800,'307':0.0800,'308':0.0800,'309':0.0800,'310':0.0800,'311':0.0800,
  '312':0.0800,'313':0.0800,'314':0.0800,'315':0.0800,'316':0.0800,'317':0.0800,
  '318':0.0800,'319':0.0800,
  // NEVADA
  '889':0.08375,'890':0.08375,'891':0.08375,
  '893':0.0773,'894':0.0773,'895':0.0773,'896':0.0773,'897':0.0773,'898':0.0773,
  // ARIZONA
  '850':0.0860,'851':0.0860,'852':0.0860,'853':0.0860,'854':0.0860,'855':0.0860,
  '856':0.0870,'857':0.0870,'859':0.0560,'860':0.0560,'865':0.0861,
  // ALABAMA
  '350':0.100,'351':0.100,'352':0.100,'353':0.100,'354':0.100,'355':0.100,
  '356':0.080,'357':0.090,'358':0.080,'359':0.090,
  '360':0.100,'361':0.100,'362':0.080,'363':0.080,'364':0.080,
  '365':0.090,'366':0.090,'367':0.080,'368':0.080,'369':0.080,
  // OKLAHOMA
  '730':0.085,'731':0.085,'734':0.085,'735':0.085,'736':0.085,
  '737':0.085,'738':0.085,'739':0.085,
  '740':0.0865,'741':0.0865,'743':0.0865,
  '744':0.085,'745':0.085,'746':0.085,'747':0.085,'748':0.085,'749':0.085,
  // MISSOURI
  '630':0.0924,'631':0.0924,'632':0.0924,
  '633':0.0575,'634':0.0575,'635':0.0575,'636':0.0575,'637':0.0575,'638':0.0575,'639':0.0575,
  '640':0.0860,'641':0.0860,
  '644':0.0575,'645':0.0575,'646':0.0575,'647':0.0575,'648':0.0575,'649':0.0575,
  '650':0.0723,'651':0.0723,
  '652':0.0575,'653':0.0575,'654':0.0575,'655':0.0575,'656':0.0575,'657':0.0575,'658':0.0575
};
function getTaxRate(state, zip) {
  if (!state) return null;
  if (zip && zip.length >= 3) {
    const r = ZIP_TAX[zip.substring(0, 3)];
    if (r != null) return r;
  }
  return US_STATE_TAX[state] || null;
}

const SQUARE_API      = 'https://connect.squareup.com/v2/online-checkout/payment-links';
const SQUARE_ORDERS_API = 'https://connect.squareup.com/v2/orders';
const SQUARE_VERSION  = '2025-05-21';
const REDIRECT_URL    = 'https://cacusabytaitus.com/ui_kits/store/?paid=1';
const CATALOG_URL     = 'https://cacusabytaitus.com/data/products.json';
const ADMIN_WORKER_URL = 'https://cacusa-admin.facturacioncacusa.workers.dev';
const PENDING_TTL_SECONDS = 2 * 60 * 60; // 2 horas — tiempo de sobra para completar el pago

// ── Catalog fetch & price validation ─────────────────────────────────────────
async function fetchCatalog() {
  const r = await fetch(CATALOG_URL, { cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error('No se pudo obtener el catálogo de productos');
  const data = await r.json();
  const products = Array.isArray(data) ? data : (data.products || []);
  const shipping  = data.config?.shipping || { freeThreshold: 150, cost: 10 };
  const combos    = Array.isArray(data.combos) ? data.combos : [];
  return { products, shipping, combos };
}

// Validates and returns the canonical price for each cart item.
// Returns { validatedItems, serverShipping } or throws on invalid items.
function validateItems(items, products, combos, shipping) {
  const productMap = new Map(products.map(p => [String(p.id), p]));
  const comboMap   = new Map(combos.map(c => [String(c.id), c]));

  const validatedItems = items.map((item, idx) => {
    if (item.isCombo) {
      // Validate combo: look up by id, use catalog price
      const combo = comboMap.get(String(item.id));
      if (!combo) {
        throw new Error(`Combo no encontrado en el catálogo (id: ${item.id})`);
      }
      return { ...item, price: combo.price };
    }

    // Regular product: look up by id
    const prod = productMap.get(String(item.id));
    if (!prod) {
      throw new Error(`Producto no encontrado en el catálogo (id: ${item.id}, pos: ${idx})`);
    }
    if (prod.available === false) {
      throw new Error(`Producto no disponible: ${prod.name || item.id}`);
    }
    // Always use the catalog price (with surcharge included in prod.price)
    return { ...item, price: prod.price };
  });

  // Recalculate shipping from canonical subtotal — ignore client-sent value
  const subtotal      = validatedItems.reduce((s, i) => s + i.price, 0);
  const serverShipping = subtotal >= shipping.freeThreshold ? 0 : shipping.cost;

  return { validatedItems, serverShipping };
}

// ── Gift cards / cupones (KV compartido con cacusa-admin) ────────────────────
// Acá solo se "espía" el saldo/descuento para calcular el precio en Square.
// La deducción real (burn/redeem) ya NO ocurre hasta que el webhook confirme el pago.
function gcKey(code) { return 'gc:' + String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''); }
async function gcPeekCents(env, code) {
  if (!env.CACUSA_KV) return 0;
  const raw = await env.CACUSA_KV.get(gcKey(code));
  if (!raw) return 0;
  let card; try { card = JSON.parse(raw); } catch { return 0; }
  if (!card || card.active === false || !(card.balance > 0)) return 0;
  return Math.round(card.balance * 100);
}

function couponKey(code) { return 'coupon:' + String(code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, ''); }
async function couponPeekCents(env, code, totalCents) {
  if (!env.CACUSA_KV) return 0;
  const raw = await env.CACUSA_KV.get(couponKey(code));
  if (!raw) return 0;
  let c; try { c = JSON.parse(raw); } catch { return 0; }
  if (!c || !c.active) return 0;
  if (c.expiresAt && new Date(c.expiresAt + 'T23:59:59') < new Date()) return 0;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return 0;
  if (c.type === 'percent') return Math.round(totalCents * c.amount / 100);
  return Math.min(Math.round(c.amount * 100), totalCents);
}

// ── Firma de webhooks de Square (idéntico al de lovers-webhook-worker.js) ────
async function verifySquareSignature(request, rawBody, sigKey) {
  const sigHeader = request.headers.get('x-square-hmacsha256-signature');
  if (!sigHeader || !sigKey) return false;
  const url = new URL(request.url).href;
  const payload = url + rawBody;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(sigKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === sigHeader;
}

async function fetchSquareOrder(orderId, token) {
  const r = await fetch(`${SQUARE_ORDERS_API}/${orderId}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Square-Version': SQUARE_VERSION }
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.order || null;
}

// Reenvía el pedido ya confirmado a cacusa-admin — llamada servidor-a-servidor,
// autenticada con ORDER_INGEST_KEY (no con el Origin del navegador, que acá no aplica).
async function forwardOrderToAdmin(order, env) {
  const r = await fetch(`${ADMIN_WORKER_URL}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
    body: JSON.stringify({ order })
  });
  if (!r.ok) throw new Error('admin /order respondió ' + r.status);
}

async function burnCouponViaAdmin(code, phone, email, env) {
  if (!code) return;
  await fetch(`${ADMIN_WORKER_URL}/coupon/burn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
    body: JSON.stringify({ code, phone, email })
  }).catch(e => console.error('coupon/burn failed:', e.message));
}

async function redeemGiftCardViaAdmin(code, amountCents, env) {
  if (!code || !(amountCents > 0)) return;
  await fetch(`${ADMIN_WORKER_URL}/giftcard/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
    body: JSON.stringify({ code, amount: amountCents / 100 })
  }).catch(e => console.error('giftcard/redeem failed:', e.message));
}

// ── Webhook: Square confirma que el pago se completó ─────────────────────────
async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const valid = await verifySquareSignature(request, rawBody, env.SQUARE_WEBHOOK_SIGNATURE_KEY);
  if (!valid) {
    console.warn('Invalid Square webhook signature');
    return new Response('Unauthorized', { status: 401 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('Bad Request', { status: 400 }); }

  if (event.type !== 'payment.updated') return new Response('OK', { status: 200 });

  const payment = event.data?.object?.payment;
  if (!payment || payment.status !== 'COMPLETED' || !payment.order_id) {
    return new Response('OK', { status: 200 }); // otros estados (APPROVED, FAILED, etc.) — nada que hacer
  }

  if (!env.CACUSA_KV) {
    console.error('CACUSA_KV no configurado en cacusa-square');
    return new Response('Internal Error', { status: 500 });
  }

  try {
    const squareOrder = await fetchSquareOrder(payment.order_id, env.SQUARE_ACCESS_TOKEN);
    const referenceId = squareOrder?.reference_id;
    if (!referenceId) {
      console.warn('payment.updated sin reference_id recuperable, order_id:', payment.order_id);
      return new Response('OK', { status: 200 });
    }

    const kvKey = `pending_order:${referenceId}`;
    const raw = await env.CACUSA_KV.get(kvKey);
    if (!raw) {
      console.warn('No se encontró pedido pendiente para reference_id:', referenceId);
      return new Response('OK', { status: 200 });
    }
    const pending = JSON.parse(raw);
    if (pending.processed) {
      return new Response('OK', { status: 200 }); // ya procesado — reintento de Square, ignorar
    }

    await forwardOrderToAdmin(pending.order, env);
    if (pending.coupon) await burnCouponViaAdmin(pending.coupon.code, pending.coupon.phone, pending.coupon.email, env);
    if (pending.giftCard) await redeemGiftCardViaAdmin(pending.giftCard.code, pending.giftCard.amountCents, env);

    pending.processed = true;
    await env.CACUSA_KV.put(kvKey, JSON.stringify(pending), { expirationTtl: PENDING_TTL_SECONDS });

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Webhook handling error:', e.message);
    // 500 para que Square reintente — el pedido real todavía no se creó
    return new Response('Internal Error', { status: 500 });
  }
}

// ── Crear el Payment Link ─────────────────────────────────────────────────────
async function handleCreatePaymentLink(body, env, allowed) {
  const { items, customer } = body;
  const isEcuador = (customer?.country || '') === 'EC';

  if (!items || items.length === 0) {
    return jsonError('El carrito está vacío', 400, allowed);
  }
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return jsonError('Worker no configurado — faltan credenciales Square', 500, allowed);
  }

  // ── Server-side price validation ────────────────────────────────────────
  let validatedItems, serverShipping;
  try {
    const { products, shipping, combos } = await fetchCatalog();
    ({ validatedItems, serverShipping } = validateItems(items, products, combos, shipping));
  } catch (e) {
    console.error('Catalog/validation error:', e.message);
    return jsonError('No se pudo validar el carrito: ' + e.message, 400, allowed);
  }

  // ── Build Square line items (using server-validated prices) ──
  const lineItems = validatedItems.map(item => {
    const name = item.personalization
      ? `${item.name} — "${item.personalization}"`
      : item.name;
    return {
      name: name.substring(0, 500),
      quantity: '1',
      note: item.material || undefined,
      base_price_money: {
        amount: Math.round(item.price * 100), // cents — canonical price from catalog
        currency: 'USD'
      }
    };
  });

  // ── Shipping line item (server-calculated) ────────────────────────────
  if (serverShipping > 0) {
    lineItems.push({
      name: 'Envío',
      quantity: '1',
      base_price_money: {
        amount: Math.round(serverShipping * 100),
        currency: 'USD'
      }
    });
  }

  // ── Ecuador IVA 15% ────────────────────────────────────────────────────
  if (isEcuador) {
    const baseCents = lineItems.reduce((s, i) => s + i.base_price_money.amount, 0);
    lineItems.push({
      name: 'IVA Ecuador (15%)',
      quantity: '1',
      base_price_money: { amount: Math.round(baseCents * 0.15), currency: 'USD' }
    });
  }

  // ── US State Sales Tax ─────────────────────────────────────────────────
  if (!isEcuador && customer?.state) {
    const st   = customer.state.toUpperCase();
    const rate = getTaxRate(st, customer.zip || '');
    if (rate) {
      const baseCents = lineItems.reduce((s, i) => s + i.base_price_money.amount, 0);
      const pct = (rate * 100).toFixed(2).replace(/\.?0+$/, '');
      lineItems.push({
        name: `Sales Tax ${st} (${pct}%)`,
        quantity: '1',
        base_price_money: { amount: Math.round(baseCents * rate), currency: 'USD' }
      });
    }
  }

  // ── Gift card (solo descuento en Square — el burn real ocurre en el webhook) ──
  let gcDiscountCents = 0;
  const gcCode = (body.giftCardCode || '').toString().trim().toUpperCase();
  if (gcCode) {
    const totalCents = lineItems.reduce((s, i) => s + i.base_price_money.amount, 0);
    const balCents   = await gcPeekCents(env, gcCode);
    if (balCents > 0) {
      if (balCents >= totalCents) {
        // La tarjeta cubre todo — no hay cargo con tarjeta, no pasa por Square ni por el webhook
        return new Response(JSON.stringify({ giftCardCoversTotal: true }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(allowed) }
        });
      }
      gcDiscountCents = Math.min(balCents, totalCents);
    }
  }

  // ── Cupón de descuento (solo descuento en Square — el burn real ocurre en el webhook) ──
  let cpDiscountCents = 0;
  const cpCode = (body.couponCode || '').toString().trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (cpCode) {
    const totalAfterGc = lineItems.reduce((s, i) => s + i.base_price_money.amount, 0) - gcDiscountCents;
    if (totalAfterGc > 0) cpDiscountCents = await couponPeekCents(env, cpCode, totalAfterGc);
  }

  // ── Build customer note ────────────────────────────────────────────────
  const parts = [];
  if (customer?.name)    parts.push(`Cliente: ${customer.name}`);
  if (customer?.phone)   parts.push(`WA: ${customer.phone}`);
  if (customer?.country) parts.push(`País: ${customer.country}`);
  if (customer?.city)    parts.push(`Ciudad: ${customer.city}`);
  if (customer?.address) parts.push(`Dir: ${customer.address}`);
  if (customer?.notes)   parts.push(`Notas: ${customer.notes}`);
  if (gcDiscountCents > 0) parts.push(`GiftCard: ${gcCode} (-$${(gcDiscountCents / 100).toFixed(2)})`);
  if (cpDiscountCents > 0) parts.push(`Cupón: ${cpCode} (-$${(cpDiscountCents / 100).toFixed(2)})`);
  const customerNote = parts.join(' | ');

  // ── Build discounts array ──────────────────────────────────────────────
  const orderDiscounts = [];
  if (gcDiscountCents > 0) orderDiscounts.push({
    uid: 'giftcard', name: 'Tarjeta de regalo',
    amount_money: { amount: gcDiscountCents, currency: 'USD' }, scope: 'ORDER'
  });
  if (cpDiscountCents > 0) orderDiscounts.push({
    uid: 'coupon', name: `Cupón ${cpCode}`,
    amount_money: { amount: cpDiscountCents, currency: 'USD' }, scope: 'ORDER'
  });

  // ── reference_id propio — así el webhook puede encontrar este pedido después ──
  const referenceId = crypto.randomUUID().replace(/-/g, '');

  // ── Guardar el pedido pendiente en KV — el webhook lo usa cuando Square confirme el pago ──
  const grossCents = lineItems.reduce((s, i) => s + i.base_price_money.amount, 0);
  const netCents    = Math.max(0, grossCents - gcDiscountCents - cpDiscountCents);
  const pendingOrder = {
    order: {
      cliente: {
        nombre:    customer?.name || '',
        apellido:  customer?.lastname || '',
        telefono:  customer?.phone || '',
        email:     customer?.email || '',
        direccion: customer?.address || '',
        ciudad:    customer?.city || '',
        estado:    customer?.state || '',
        zip:       customer?.zip || '',
        pais:      customer?.country || '',
        notas:     customer?.notes || '',
      },
      productos: validatedItems.map(i => ({
        id: i.id, name: i.name, price: i.price,
        personalization: i.personalization || undefined,
      })),
      total: +(netCents / 100).toFixed(2),
      pago:  'Tarjeta',
      estado: 'Nuevo',
    },
    giftCard: gcDiscountCents > 0 ? { code: gcCode, amountCents: gcDiscountCents } : null,
    coupon:   cpDiscountCents > 0 ? { code: cpCode, amountCents: cpDiscountCents, phone: customer?.phone || '', email: customer?.email || '' } : null,
    createdAt: new Date().toISOString(),
    processed: false,
  };
  if (env.CACUSA_KV) {
    await env.CACUSA_KV.put(`pending_order:${referenceId}`, JSON.stringify(pendingOrder), { expirationTtl: PENDING_TTL_SECONDS });
  }

  // ── Square API call ────────────────────────────────────────────────────
  const payload = {
    idempotency_key: crypto.randomUUID(),
    checkout_options: {
      redirect_url: REDIRECT_URL,
      ask_for_shipping_address: false,
      accepted_payment_methods: {
        apple_pay: true,
        google_pay: true,
        cash_app_pay: false
      }
    },
    order: {
      location_id: env.SQUARE_LOCATION_ID,
      reference_id: referenceId,
      line_items: lineItems,
      customer_note: customerNote.substring(0, 500),
      ...(orderDiscounts.length > 0 ? { discounts: orderDiscounts } : {})
    }
  };

  if (customer?.name) {
    const nameParts = (customer.name + ' ' + (customer.lastname || '')).trim().split(' ');
    payload.pre_populated_data = { buyer_name: nameParts.join(' ') };
  }

  let squareResp, squareData;
  try {
    squareResp = await fetch(SQUARE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION
      },
      body: JSON.stringify(payload)
    });
    squareData = await squareResp.json();
  } catch (err) {
    console.error('Square fetch error:', err);
    return jsonError('Error de conexión con Square', 502, allowed);
  }

  if (!squareResp.ok) {
    const detail = squareData?.errors?.[0]?.detail || 'Error desconocido de Square';
    console.error('Square error:', JSON.stringify(squareData));
    return jsonError(detail, 502, allowed);
  }

  const checkoutUrl = squareData.payment_link?.url;
  if (!checkoutUrl) {
    return jsonError('Square no devolvió URL de pago', 502, allowed);
  }

  return new Response(JSON.stringify({ checkoutUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(allowed) }
  });
}

export default {
  async fetch(request, env) {
    const url     = new URL(request.url);
    const origin  = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://cacusabytaitus.com';

    // El webhook de Square no manda Origin de navegador — se autentica con la firma, no con CORS
    if (url.pathname === '/webhook') {
      if (request.method !== 'POST') return new Response('OK', { status: 200 });
      return await handleWebhook(request, env);
    }

    // ── CORS preflight ──────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowed) });
    }

    if (request.method !== 'POST') {
      return jsonError('Method not allowed', 405, allowed);
    }

    // ── Parse body ──────────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Cuerpo JSON inválido', 400, allowed);
    }

    return await handleCreatePaymentLink(body, env, allowed);
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonError(msg, status, origin) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}
