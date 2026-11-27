// JavaScript de la tienda (EN) — extraído del <script> en línea el 27 sep para que
// el navegador lo guarde en caché una vez en vez de bajarlo dentro de cada una de las
// ~200 páginas físicas. Se carga en la MISMA posición que tenía el <script> (script
// clásico, sin defer), así que el orden y el alcance global no cambian. Al editar este
// archivo no hace falta tocar el ?v= del HTML: bump_asset_versions.py lo actualiza en
// product-schema.yml.
// ─── CONFIG ─────────────────────────────────────────────────
// Auditoría SEO (19 sep, S01): ruta ABSOLUTA a propósito, no relativa — este
// archivo es la plantilla fuente de la que generate_product_pages.py copia 172
// páginas físicas (producto/<slug>/, categoria/<slug>/, 2 niveles más abajo que
// acá) y fix_relative_depth() en ese script SOLO reescribe atributos href=/src=,
// nunca constantes de JS como esta. Con la ruta relativa vieja, esas 172 páginas
// pedían el catálogo a una URL que no existe (404) y caían al catálogo de
// demostración — mostrando un producto/categoría distinto al que el HTML
// estático (title, canonical, JSON-LD) decía. Con ruta absoluta (el sitio SIEMPRE
// se sirve desde la raíz de cacusabytaitus.com, nunca un subpath) no hace falta
// ningún ajuste de profundidad, sea cual sea el nivel del archivo que la usa.
const PRODUCTS_JSON_URL = '/data/products.json';

const SQUARE_WORKER_URL = 'https://cacusa-square.facturacioncacusa.workers.dev';
const ADMIN_WORKER_URL  = 'https://cacusa-admin.facturacioncacusa.workers.dev';

// ─── FIREBASE AUTH (anónima) ─────────────────────────────────
const _FB_API_KEY = 'AIzaSyDwEVeHU0mwSekHbrKM8EjBgn4HSM3zZfM';
let _fbIdToken = null;
async function _fbSignIn() {
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${_FB_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true }) }
    );
    if (r.ok) { const d = await r.json(); _fbIdToken = d.idToken || null; }
  } catch(_) {}
}
function _fbUrl(base) { return _fbIdToken ? `${base}?auth=${_fbIdToken}` : base; }

// ─── IDIOMA ─────────────────────────────────────────────────
// Traducciones embebidas directamente — no dependen de fetch
const __LANG = 'en';
const __EN_T = {
  "combo.sectionTitle":"Combos & Bundles","combo.more":" +more","combo.saving":"You save $",
  "store.back":"Back to home","store.cartBtn":"Cart","store.filterLabel":"Filter:",
  "store.all":"All","store.viewAllCatalog":"View full catalog →","store.sortDefault":"Sort: Featured","store.sortPriceAsc":"Price: low to high",
  "store.sortPriceDesc":"Price: high to low","store.sortNew":"Newest","store.loading":"Loading products…",
  "nav.followUs":"Follow us on social media","store.footerHome":"Home","store.footerShippingLink":"Shipping",
  "store.footerReturnsLink":"Returns","store.footerCareLink":"Care","store.personLabel":"Personalization",
  "store.personPh":"Name, date or special message…","store.personHint":"Max. 20 characters · letters, numbers and spaces",
  "store.cartTitle":"Your cart","store.subtotal":"Subtotal","store.checkoutBtn":"Checkout",
  "store.waBadge":"Secure payment with Square","store.coTitle":"Checkout",
  "store.coSubtitle":"CACUSA by Taitus · Personalized Jewelry","store.coContactSection":"Contact Information",
  "store.coNombre":"First Name","store.phNombre":"First Name","store.coApellido":"Last Name","store.phApellido":"Last Name",
  "store.coTel":"Mobile Number","store.coShippingSection":"Shipping Address","store.coPais":"Country",
  "store.coEstado":"State","store.coZip":"ZIP Code","store.coCiudad":"City","store.coAddress":"Full Address",
  "store.coNotes":"Additional notes (optional)","store.phNotas":"Color, size, special detail…",
  "store.coPayMethod":"Payment Method","store.paySquare":"Square / Credit Card","store.payZelleSub":"-4% discount",
  "store.coPay":"Pay with Square","store.payWithZelle":"Pay with Zelle / Transfer",
  "store.coSecure":"Secure payment · Apple Pay · Google Pay","store.coCustomNote":"Custom made pieces",
  "store.devNote":"see return policy","store.coWaFallback":"I prefer to coordinate via WhatsApp",
  "store.orderSummary":"Order Summary","store.shipping":"Shipping","store.tax":"Tax",
  "store.zelleDiscount":"Zelle Discount (4%)","store.total":"Total","store.coHelp":"NEED HELP?",
  "store.coBack":"← Back to cart","store.successH":"Order sent!",
  "store.successP":"We will contact you via WhatsApp to confirm your order. Thank you for choosing us!",
  "store.successBtn":"Continue shopping","store.quickView":"Quick view →","store.viewBtn":"+ View",
  "store.emptyCategory":"No products in this category yet.","store.cartEmpty":"Your cart is empty",
  "store.shippingFree":"Free shipping unlocked!","store.coFree":"Free",
  "store.taxEc":"Ecuador VAT (15%)","store.tax":"Tax","store.searchShort":"Search…","store.search":"Search products…",
  "store.coErrorNetwork":"We couldn't connect to the payment system. Check your connection and try again, or finish via WhatsApp.",
  "store.coError1":"Please enter your name and mobile number.","store.coError2":"Please select your state.","store.coError3":"Please enter a valid phone number.",
  "store.coErrorZip":"Please enter a valid ZIP code (5 digits).",
  "store.coErrorOrderFailed":"We couldn't save your order — please check your connection and try again.",
  "store.mktLocal":"Local product","store.mktImport":"Imported from the US","store.mktEcOnly":"Shipped from Ecuador",
  "tag.nuevo":"New","tag.bestseller":"Bestseller",
  "cat.cadenas":"Chains","cat.aretes":"Earrings","cat.anillos":"Rings","cat.hombres":"Men",
  "cat.pulseras":"Bracelets","cat.ear cuff":"Ear Cuff","cat.parejas":"Couples",
  "cat.juegos":"Sets","cat.hand chain":"Hand Chain",
  "cat.personalizado":"Custom","cat.gold edition":"Gold Edition","cat.colección":"Collection",
  "combo.add":"Add combo"
};
// Aplicar textos EN que CSS no puede manejar (select options, placeholders de inputs)
if (__LANG === 'en') {
  const _sortOpts = {default:'Sort: Featured','price-asc':'Price: low to high','price-desc':'Price: high to low',new:'Newest',bestseller:'Best sellers'};
  document.querySelectorAll('#sortSelect option').forEach(o => { if (_sortOpts[o.value]) o.textContent = _sortOpts[o.value]; });
  const _phs = {modalPersonText:'Name, date or special message…',coNombre:'First Name',coApellido:'Last Name',coTel:'(555) 123-4567',coNotas:'Color, size, special detail…',coEmail:'email@example.com',searchInput:'Search products…',cpCodeInput:'CODE',revName:'Your name',revComment:'Your review…'};
  Object.entries(_phs).forEach(([id,ph]) => { const el = document.getElementById(id); if (el) el.placeholder = ph; });
  document.title = 'Personalized Jewelry Store | CACUSA by Taitus';
}

let PRODUCTS = [];
let COMBOS = [];
let WHATSAPP_NUMBER = '';

// Config dinámica (se sobreescribe con products.json → config)
let CATEGORIES = ['Cadenas', 'Aretes', 'Anillos', 'Hombres', 'Pulseras'];
let MATERIALS  = ['Plata 925', 'Baño de oro 18k', 'Acero inoxidable', 'Gold filled'];

// Meta description por categoría — para que cada URL ?cat= tenga contenido único
// para buscadores, en vez de repetir siempre la misma descripción genérica de la tienda.
const CATEGORY_DESC_EN = {
  cadenas: 'Handmade chains and necklaces in 925 silver, 18k gold plating and stainless steel — with charms and personalization available via WhatsApp.',
  aretes: 'Handmade personalized earrings in 925 silver, 18k gold plating and stainless steel — from hoops to ear cuffs.',
  anillos: 'Handmade adjustable and fixed-size rings in 925 silver, 18k gold plating and stainless steel — custom engraving available.',
  hombres: "Men's jewelry: chains, rings and bracelets in stainless steel and 18k gold plating, built for everyday wear.",
  pulseras: 'Handmade woven and chain bracelets in 925 silver, 18k gold plating and stainless steel — personalization available.',
  'ear cuff': 'Handmade ear cuffs with no piercing needed, in 18k gold plating and stainless steel, for a modern look.',
  parejas: "Matching pieces for couples — rings, chains and bracelets that pair together, perfect for Valentine's Day or anniversaries.",
  juegos: 'Jewelry sets (earrings, chain and bracelet) in 925 silver and 18k gold plating, ready to gift.',
  'hand chain': 'Handmade hand chains combining a ring and bracelet in one piece, in 18k gold plating and stainless steel.',
};
// <title> por categoría — copia de CATEGORY_TITLE_ES/EN en
// .github/scripts/category_copy.py (las páginas físicas de categoría salen con ese
// título desde el HTML); si se edita uno, editar el otro o este JS lo pisa al cargar.
const CATEGORY_TITLE_EN = {
  "cadenas": "Personalized Necklaces & Chains | CACUSA by Taitus",
  "aretes": "Handmade Personalized Earrings | CACUSA by Taitus",
  "anillos": "Personalized & Adjustable Rings | CACUSA by Taitus",
  "hombres": "Men's Jewelry in Steel & 18k Gold | CACUSA by Taitus",
  "pulseras": "Handmade Personalized Bracelets | CACUSA by Taitus",
  "ear cuff": "No-Piercing Ear Cuffs | CACUSA by Taitus",
  "parejas": "Matching Couples Jewelry | CACUSA by Taitus",
  "juegos": "Jewelry Gift Sets | CACUSA by Taitus",
  "hand chain": "Handmade Hand Chains | CACUSA by Taitus"
};
let SHIPPING   = { freeThreshold: 90, cost: 10 };
// Copia cruda de config.shipping (handling/transit days) para armar
// shippingDetails en el JSON-LD del cliente — ver _seoShippingDetails() más
// abajo, replica build_shipping_details() de generate_product_schema.py.
let SHIPPING_CFG = {};
// ─── CAMPAÑA DE TEMPORADA (Navidad) ─────────────────────────
// config.campaign viene del panel admin (mismo contrato y mismos valores por defecto que
// DEFAULT_CAMPAIGN del admin); si falta la clave o un campo, se usan estos. Fechas límite:
// USPS Ground Advantage 2026 (enviar a más tardar el 17 dic para llegar en Navidad),
// personalización 5–10 días hábiles y Servientrega Ecuador 1–3 días.
const DEFAULT_CAMPAIGN = {
  enabled: true, endsAt: '2026-12-26',
  title: 'Regalos de Navidad', title_en: 'Christmas gifts',
  banner: '', banner_en: '',
  deadlinePersonalEc: '2026-12-08', deadlinePersonalUs: '2026-12-03',
  deadlineStockEc: '2026-12-18', deadlineStockUs: '2026-12-14'
};
let CAMPAIGN = { ...DEFAULT_CAMPAIGN };
function _isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function _normalizeCampaign(raw) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const c = { ...DEFAULT_CAMPAIGN };
  if (typeof r.enabled === 'boolean') c.enabled = r.enabled;
  ['endsAt', 'deadlinePersonalEc', 'deadlinePersonalUs', 'deadlineStockEc', 'deadlineStockUs'].forEach(k => { if (_isIsoDate(r[k])) c[k] = r[k]; });
  ['title', 'title_en'].forEach(k => { if (typeof r[k] === 'string' && r[k].trim()) c[k] = r[k].trim(); });
  ['banner', 'banner_en'].forEach(k => { if (typeof r[k] === 'string') c[k] = r[k].trim(); });
  return c;
}
// Hoy en hora LOCAL como 'YYYY-MM-DD' (nunca toISOString(): en UTC ya sería mañana por la
// noche en Ecuador/EE.UU.). Las fechas ISO se comparan directamente como texto.
function _todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// '2026-12-03' → "3 de diciembre" / "December 3" (fecha local: new Date(y, m-1, d)).
const _MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const _MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function _fmtCampaignDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return __LANG === 'en'
    ? _MONTHS_EN[dt.getMonth()] + ' ' + dt.getDate()
    : dt.getDate() + ' de ' + _MONTHS_ES[dt.getMonth()];
}
// Mercado de la visitante según el país que loadData() ya detecta por IP
// (window.__visitorCountry). Otro país o sin dato → null: se muestran EE.UU. y Ecuador.
function _campaignCountry() {
  const c = String(window.__visitorCountry || '').toUpperCase();
  return c === 'EC' || c === 'US' ? c : null;
}
// kind: 'personal' | 'stock'; country: 'EC' | 'US' | null (null → null, mostrar ambos).
function campaignDeadline(kind, country) {
  if (country !== 'EC' && country !== 'US') return null;
  return CAMPAIGN['deadline' + (kind === 'personal' ? 'Personal' : 'Stock') + (country === 'EC' ? 'Ec' : 'Us')] || null;
}
function campaignActive() {
  const c = CAMPAIGN, today = _todayIso();
  if (!c.enabled || today > c.endsAt) return false;
  return [c.deadlinePersonalEc, c.deadlinePersonalUs, c.deadlineStockEc, c.deadlineStockUs].some(d => d >= today);
}
// Fechas límite todavía vigentes para la visitante: una sola si se conoce su mercado, o
// EE.UU. y Ecuador por separado si no. Lista vacía = ya no llega a tiempo → no se muestra.
function _campaignDeadlines(kind) {
  if (!campaignActive()) return [];
  const today = _todayIso(), cc = _campaignCountry();
  return (cc ? [cc] : ['US', 'EC'])
    .map(c => ({ country: c, date: campaignDeadline(kind, c) }))
    .filter(x => x.date && x.date >= today);
}
function _campaignCountryLabel(cc) { return cc === 'EC' ? 'Ecuador' : (__LANG === 'en' ? 'US' : 'EE.UU.'); }
const US_STATE_TAX = {
  AL:0.04,AZ:0.056,AR:0.065,CA:0.0725,CO:0.029,CT:0.0635,FL:0.07,GA:0.04,
  HI:0.04,ID:0.06,IL:0.0625,IN:0.07,IA:0.06,KS:0.065,KY:0.06,LA:0.0445,
  ME:0.055,MD:0.06,MA:0.0625,MI:0.06,MN:0.06875,MS:0.07,MO:0.04225,NE:0.055,
  NV:0.0685,NJ:0.06625,NM:0.05,NY:0.04,NC:0.0475,ND:0.05,OH:0.0575,OK:0.045,
  PA:0.06,RI:0.07,SC:0.06,SD:0.045,TN:0.07,TX:0.0625,UT:0.0485,VT:0.06,
  VA:0.053,WA:0.065,WV:0.06,WI:0.05,WY:0.04,DC:0.06
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
  // NEW YORK (NYC 8.875%, LI/Westchester 8.625%, upstate ~8%)
  '100':0.08875,'101':0.08875,'102':0.08875,'103':0.08875,'104':0.08875,
  '110':0.08875,'111':0.08875,'113':0.08875,'114':0.08875,'116':0.08875,
  '105':0.08375,'106':0.08375,'107':0.08750,'108':0.08625,'109':0.08625,
  '115':0.08625,'117':0.08625,'118':0.08625,'119':0.08625,
  '120':0.080,'121':0.080,'122':0.080,'123':0.080,'124':0.080,'125':0.080,
  '126':0.080,'127':0.080,'128':0.080,'129':0.080,'130':0.080,'131':0.080,
  '132':0.080,'133':0.080,'134':0.080,'135':0.080,'136':0.080,'137':0.080,
  '138':0.080,'139':0.080,'140':0.080,'141':0.080,'142':0.080,'143':0.080,
  '144':0.080,'145':0.080,'146':0.080,'147':0.080,'148':0.080,'149':0.080,
  // CALIFORNIA (LA ~9.5-10.25%, SD ~7.75%, SF Bay ~8.6-10.25%)
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
  // ILLINOIS (Chicago 10.25%, suburbs ~8%, resto 7.25%)
  '606':0.1025,'607':0.1025,'608':0.1025,
  '600':0.0800,'601':0.0800,'602':0.0800,'603':0.0800,'604':0.0800,'605':0.0875,
  '609':0.0725,'610':0.0725,'611':0.0725,'612':0.0725,'613':0.0725,'614':0.0725,
  '615':0.0725,'616':0.0725,'617':0.0725,'618':0.0725,'619':0.0725,
  '620':0.0725,'621':0.0725,'622':0.0725,'623':0.0725,'624':0.0725,
  '625':0.0725,'626':0.0725,'627':0.0725,'628':0.0725,'629':0.0725,
  // TEXAS (casi todos los municipios al tope de 8.25%)
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
  // WASHINGTON (Seattle 10.25%, resto ~8.9%)
  '980':0.1025,'981':0.1025,'982':0.1025,
  '983':0.0890,'984':0.0890,'985':0.0890,'986':0.0890,
  '988':0.0890,'989':0.0890,'990':0.0890,'991':0.0890,'992':0.0890,
  '993':0.0860,'994':0.0860,
  // COLORADO (Denver metro ~8.8%, resto bajo)
  '800':0.0888,'801':0.0861,'802':0.0881,'803':0.0630,'804':0.0630,'805':0.0815,
  // LOUISIANA (New Orleans ~9.95%, resto ~9.45%)
  '700':0.0995,'701':0.0995,'702':0.0995,'703':0.0995,'704':0.0995,
  '705':0.0945,'706':0.0945,'707':0.0945,'708':0.0945,
  '710':0.0945,'711':0.0945,'712':0.0945,'713':0.0945,'714':0.0945,
  // TENNESSEE (~9.75% uniforme)
  '370':0.0975,'371':0.0975,'372':0.0975,'373':0.0975,'374':0.0975,
  '375':0.0975,'376':0.0975,'377':0.0975,'378':0.0975,'379':0.0975,
  '380':0.0975,'381':0.0975,'382':0.0975,'383':0.0975,'384':0.0975,'385':0.0975,
  // GEORGIA (Atlanta metro 8.75%, resto 8%)
  '300':0.0875,'301':0.0875,'302':0.0875,'303':0.0875,'304':0.0875,'305':0.0875,
  '306':0.0800,'307':0.0800,'308':0.0800,'309':0.0800,'310':0.0800,'311':0.0800,
  '312':0.0800,'313':0.0800,'314':0.0800,'315':0.0800,'316':0.0800,'317':0.0800,
  '318':0.0800,'319':0.0800,
  // NEVADA (Las Vegas/Clark 8.375%, resto 7.73%)
  '889':0.08375,'890':0.08375,'891':0.08375,
  '893':0.0773,'894':0.0773,'895':0.0773,'896':0.0773,'897':0.0773,'898':0.0773,
  // ARIZONA (Phoenix 8.6%, Tucson 8.7%, resto ~5.6%)
  '850':0.0860,'851':0.0860,'852':0.0860,'853':0.0860,'854':0.0860,'855':0.0860,
  '856':0.0870,'857':0.0870,'859':0.0560,'860':0.0560,'865':0.0861,
  // ALABAMA (Birmingham 10%, Montgomery 10%, Mobile 9%, resto 8%)
  '350':0.100,'351':0.100,'352':0.100,'353':0.100,'354':0.100,'355':0.100,
  '356':0.080,'357':0.090,'358':0.080,'359':0.090,
  '360':0.100,'361':0.100,'362':0.080,'363':0.080,'364':0.080,
  '365':0.090,'366':0.090,'367':0.080,'368':0.080,'369':0.080,
  // OKLAHOMA (OKC 8.5%, Tulsa 8.65%)
  '730':0.085,'731':0.085,'734':0.085,'735':0.085,'736':0.085,
  '737':0.085,'738':0.085,'739':0.085,
  '740':0.0865,'741':0.0865,'743':0.0865,
  '744':0.085,'745':0.085,'746':0.085,'747':0.085,'748':0.085,'749':0.085,
  // MISSOURI (St Louis 9.24%, Kansas City 8.6%, resto ~5.75%)
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
let TEXTS = {
  heroLabel: 'Shop personalized jewelry online',
  heroTitle: 'Our Store',
  heroSubtitle: 'by Taitus',
  instagram: '@cacusabytaitus',
  perks: ['Handmade', '5–10 business days', 'Special gift packaging']
};
function t(key, fallback) { return __LANG === 'en' && __EN_T[key] !== undefined ? __EN_T[key] : fallback; }
function tagLabel(tag) {
  if (!tag) return '';
  const lc = tag.toLowerCase();
  if (lc === 'nuevo' || lc === 'new')                          return t('tag.nuevo',      'Nuevo');
  if (lc === 'bestseller' || lc === 'best seller')             return t('tag.bestseller', 'Lo más vendido');
  return tag;
}


// ─── PRODUCT NORMALIZER ─────────────────────────────────────
// Maps JSON color keys → gradient strings so products without imageUrl get a nice bg
const COLOR_GRADS = {
  rose:   'linear-gradient(135deg,#F9A8C9,#EE6FA8,#FCE8F3)',
  gold:   'linear-gradient(135deg,#FEF0E4,#F4C430,#F5C8A8)',
  violet: 'linear-gradient(135deg,#EEE4FA,#C4A0EC,#88C8F0)',
  sky:    'linear-gradient(135deg,#DCF0FC,#88C8F0,#EEE4FA)',
  plum:   'linear-gradient(135deg,#2D1B2E,#4A1942,#9B5DE5)'
};
function normalizeProd(p) {
  // Resolve badge class from tag string
  const tag = p.tag || null;
  let badge = p.badge || null;
  if (!badge && tag) {
    const t = tag.toLowerCase();
    if (t === 'bestseller' || t === 'best seller') badge = 'badge-best';
    else if (t === 'nuevo' || t === 'new') badge = 'badge-new';
    else badge = 'badge-sale';
  }
  return {
    ...p,
    basePrice: p.price,
    hasSurcharge: false,
    cat:    p.category || p.cat || '',
    desc:   p.description || p.desc || '',
    grad:   p.grad || COLOR_GRADS[p.color] || 'linear-gradient(135deg,#F5C8A8,#EE6FA8,#C4A0EC)',
    badge:  badge,
    market: p.market || 'both',
    available: p.available !== false,
    promo: p.promo || null
  };
}

// ─── ESTADO ─────────────────────────────────────────────────
// 22 oct (auditoría): si el navegador bloquea el almacenamiento (Safari/Chrome con cookies bloqueadas),
// acceder a localStorage lanza un error y la tienda no cargaba. Se usa una copia en memoria.
const __LS = (() => {
  try { const k = '__cacusa_t'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return window.localStorage; }
  catch (_) { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; }
})();
let cart = (() => { try { const c = JSON.parse(__LS.getItem('cacusa-cart') || '[]'); return Array.isArray(c) ? c : []; } catch (_) { return []; } })();
let currentProduct = null, qty = 1, activeFilter = 'all', searchTerm = '';
// Mientras esta bandera sea false y no haya búsqueda activa, la primera pantalla muestra
// las categorías en vez de los 74 productos juntos — se "apaga" en cuanto la clienta elige
// una categoría, busca algo, o pide ver todo el catálogo.
let _categoryPickerDismissed = false;
// ─── FILTROS POR URL (?precio=min-max / ?regalo=1 / ?personalizado=1) ──────────
// Enlaces de campaña (guía de regalos, home, redes) que llegan directo a un rango de precio,
// a "ideas de regalo" (personalizables primero, luego Bestseller, luego el resto) o solo a
// las piezas personalizables ("Con su nombre"). Los 3 muestran solo piezas en stock (mismo
// criterio que los conteos del home). Rango de precio semiabierto: mínimo incluido, máximo
// excluido (una pieza de $30 cae en 30-60, no en 0-30), sobre el precio final (con recargo
// y promo). Se aplican encima de la categoría y la búsqueda, y cada uno se quita con su chip.
let _urlPrice = null, _urlGift = false, _urlPersonal = false;
function _readUrlFilters() {
  const sp = new URLSearchParams(window.location.search);
  const m = /^(\d{1,5}(?:\.\d{1,2})?)-(\d{1,5}(?:\.\d{1,2})?)?$/.exec((sp.get('precio') || '').trim());
  _urlPrice = null;
  if (m) {
    const min = Number(m[1]), max = m[2] != null ? Number(m[2]) : null;
    if (max == null || max >= min) _urlPrice = { min, max };
  }
  _urlGift = sp.get('regalo') === '1';
  _urlPersonal = sp.get('personalizado') === '1';
}
_readUrlFilters();
// Con ?precio, ?regalo o ?personalizado (y sin ?cat) se salta el selector de categorías: grilla directa.
function _hasUrlFilters() { return !!(_urlPrice || _urlGift || _urlPersonal); }
if (_hasUrlFilters()) _categoryPickerDismissed = true;
function _giftRank(p) { return p.personalized ? 0 : (_isBestseller(p) ? 1 : 2); }
function _priceChipLabel(pr) {
  const en = __LANG === 'en', f = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
  if (pr.max == null) return (en ? 'From ' : 'Desde ') + f(pr.min);
  if (pr.min === 0) return (en ? 'Under ' : 'Menos de ') + f(pr.max);
  return f(pr.min) + (en ? ' to ' : ' a ') + f(pr.max);
}
function _renderUrlFilterChips() {
  const wrap = document.getElementById('urlFilterChips');
  if (!wrap) return;
  const en = __LANG === 'en';
  const chips = [];
  if (_urlPrice) chips.push({ param: 'precio', label: _priceChipLabel(_urlPrice) });
  if (_urlGift) chips.push({ param: 'regalo', label: en ? 'Gift ideas' : 'Ideas de regalo' });
  if (_urlPersonal) chips.push({ param: 'personalizado', label: en ? 'With their name' : 'Con su nombre' });
  wrap.hidden = !chips.length;
  wrap.innerHTML = chips.map(c =>
    '<button type="button" class="url-chip" data-param="' + c.param + '" aria-label="' + esc((en ? 'Remove filter: ' : 'Quitar filtro: ') + c.label) + '">' +
    esc(c.label) + ' <span aria-hidden="true">✕</span></button>').join('');
}
function _removeUrlFilter(param) {
  const u = new URL(window.location.href);
  u.searchParams.delete(param);
  history.replaceState(history.state, '', u.toString());
  _readUrlFilters();
  renderProducts();
  const next = document.querySelector('#urlFilterChips .url-chip') || document.getElementById('searchInput');
  if (next) next.focus();
}
(function () {
  const wrap = document.getElementById('urlFilterChips');
  if (wrap) wrap.addEventListener('click', e => {
    const b = e.target.closest('.url-chip');
    if (b) _removeUrlFilter(b.dataset.param);
  });
})();
// Activa un div/span con role="button" desde el teclado (Enter/Espacio) — reusado por
// todas las tarjetas clicables que no son <a>/<button> nativos (category picker,
// relacionados, miniaturas de galería/lightbox).
function activateOnKey(e, fn) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
}
// Función compartida entre los botones de filtro de la cabecera y las tarjetas de
// categoría de la primera pantalla — ambos caminos llevan al mismo resultado.
// En móvil los chips de categoría son una fila deslizable (#filterBtns con overflow-x):
// al activarse uno (clic, ?cat= al cargar, atrás/adelante) se centra dentro de su fila.
// Se mueve solo el scroll horizontal de la fila (no scrollIntoView sobre la página) para
// no desplazar nunca la página en vertical. En escritorio la fila no desborda y no hace nada.
function _scrollActiveChipIntoView() {
  const wrap = document.getElementById('filterBtns');
  const btn = wrap && wrap.querySelector('.filter-btn.active');
  if (!btn || wrap.scrollWidth <= wrap.clientWidth) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const br = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  const left = wrap.scrollLeft + (br.left - wr.left) - (wrap.clientWidth - br.width) / 2;
  wrap.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' });
}
// Lleva la vista al inicio del catálogo (barra de filtros) dejando libre la altura del
// header fijo. force=false: solo si la clienta ya bajó más allá de los filtros.
function _scrollToCatalog(force) {
  const target = document.querySelector('.filters');
  if (!target) return;
  const navEl = document.querySelector('body > nav');
  const navH = navEl ? navEl.getBoundingClientRect().height : 0;
  const y = Math.max(0, target.getBoundingClientRect().top + window.scrollY - navH);
  if (!force && window.scrollY <= y + 1) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
}
function selectCategory(cat) {
  const _fromPicker = !!document.querySelector('#prodGrid.cat-picker-grid');
  _categoryPickerDismissed = true;
  activeFilter = cat;
  // Elegir una categoría reemplaza la búsqueda (que busca en todo el catálogo).
  if (searchTerm) {
    searchTerm = '';
    const si = document.getElementById('searchInput'); if (si) si.value = '';
    const sc = document.getElementById('searchClear'); if (sc) sc.style.display = 'none';
  }
  document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === cat));
  _scrollActiveChipIntoView();
  renderProducts();
  _scrollToCatalog(_fromPicker);
  const u = new URL(window.location.href);
  u.searchParams.delete('p');
  if (cat === 'all') u.searchParams.delete('cat'); else u.searchParams.set('cat', cat);
  history.pushState({}, '', u.toString());
  _updateListingSeo();
}
let _reviewSummaries = {};
let _galleryImages = [], _galleryIdx = 0;
let _lbImages = [], _lbIdx = 0;
let _gcCode = null, _gcBalance = 0, _gcApplied = 0;
let _cpCode = null, _cpType = null, _cpAmount = 0, _cpDiscount = 0;
// Cupón de envío gratis — beneficio de las suscriptoras de Cacusa Lovers. No descuenta
// dinero del subtotal (su amount es 0): lo único que hace es anular el costo de envío.
// El Worker de Square hace exactamente lo mismo del lado del servidor, que es quien
// decide el cobro real; acá solo se refleja para que el resumen muestre el mismo total.
function _cpIsFreeShip(){ return !!_cpCode && _cpType === 'freeship'; }
let _revRating = 5;

// Aviso real cuando el catálogo no pudo cargar (fetch falló o vino vacío) —
// nunca se reemplaza por productos de demostración inventados. El número de
// WhatsApp es el mismo hardcodeado en el <a id="waFloat"> del HTML estático
// (arriba en el <body>): si falló el fetch a data/products.json, tampoco se
// pudo leer el número real desde la config, así que se usa ese mismo default.
function _showCatalogLoadError() {
  showToast(
    '<span role="alert">✕ We could not load the catalog. Reload the page or message us on ' +
    '<a href="https://wa.me/17867375336" target="_blank" rel="noopener" style="text-decoration:underline;color:inherit">WhatsApp</a>.</span>',
    9000
  );
}
// ─── RED CON TIEMPO LÍMITE (wave 1, auditoría de robustez) ─────────────────
// Antes loadData() esperaba en serie products.json → /pub/surcharges → /pub/markets +
// api.country.is, sin tope de tiempo: si el Worker o country.is se colgaban, la tienda
// quedaba con 0 productos y la página de producto sin modal comprable. Ahora todo sale en
// paralelo, el catálogo se pinta apenas llega products.json, y cada pedido auxiliar tiene
// un tope (~2,5 s) con AbortController — el tope cubre también la lectura del cuerpo.
const FETCH_TIMEOUT_MS = 2500;
function fetchT(url, opts, ms) {
  const lim = ms || FETCH_TIMEOUT_MS;
  const o = Object.assign({}, opts || {});
  if (typeof AbortController === 'function') {
    const ctrl = new AbortController();
    o.signal = ctrl.signal;
    setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, lim);
  }
  return Promise.race([
    fetch(url, o),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), lim + 50))
  ]);
}
// JSON o null (error de red, tope vencido, HTTP no-OK o cuerpo inválido) — nunca lanza.
async function fetchJsonT(url, opts, ms) {
  try { const r = await fetchT(url, opts, ms); return r.ok ? await r.json() : null; }
  catch (_) { return null; }
}
// País provisional mientras responde api.country.is (o si nunca responde): primero la zona
// horaria del navegador y, si no se puede leer, la región del idioma (es-EC, en-US). Solo
// importan EC/US (fechas de la campaña y etiquetas de mercado); cualquier otro → null, que
// es lo mismo que "no sé": se muestran las fechas de los 2 países.
function _guessCountry() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
  if (tz) {
    if (/^(America\/Guayaquil|Pacific\/Galapagos)$/.test(tz)) return 'EC';
    if (/^(America\/(New_York|Detroit|Chicago|Denver|Phoenix|Boise|Los_Angeles|Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla|Adak|Menominee|Indiana\/\w+|Kentucky\/\w+|North_Dakota\/\w+)|Pacific\/Honolulu)$/.test(tz)) return 'US';
    return null;
  }
  const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
  for (const l of langs) {
    const m = /-([A-Za-z]{2})$/.exec(String(l || ''));
    if (m && (m[1].toUpperCase() === 'EC' || m[1].toUpperCase() === 'US')) return m[1].toUpperCase();
  }
  return null;
}
// ─── PRECIOS: recargo 4% con tarjeta + promos ───────────────
// El recargo vive en KV (/pub/surcharges), pero CI ya lo "hornea" en el JSON-LD estático de
// cada página (generate_product_schema.py publica el precio con recargo). Se lee de ahí como
// valor provisional: el primer render ya muestra el mismo precio que el JSON-LD y que el
// precio estático de la página de producto, sin salto cuando responde el Worker (que manda
// igual: si difiere, se re-pintan solo los precios). Si el Worker no responde, queda el valor
// horneado — el mismo que ve Google y el que cobra el Worker de Square.
let _surchargeMap = {};
function _withSurcharge(base) { return Math.round(base * 1.04 * 100) / 100; }
function _staticSurcharges() {
  const ld = {};
  document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    if (el.id === 'ld-product') return; // el que arma este mismo JS, no el horneado
    let d; try { d = JSON.parse(el.textContent); } catch (_) { return; }
    (Array.isArray(d && d['@graph']) ? d['@graph'] : [d]).forEach(n => {
      if (n && n['@type'] === 'Product' && n.sku != null && n.offers && n.offers.price != null) ld[String(n.sku)] = Number(n.offers.price);
    });
  });
  const map = {};
  PRODUCTS.forEach(p => {
    const sp = ld[String(p.id)], base = Number(p.basePrice);
    if (sp != null && base > 0 && sp !== base && Math.abs(sp - _withSurcharge(base)) < 0.005) map[p.id] = true;
  });
  return map;
}
// Recalcula p.price desde el precio base (idempotente: se puede llamar de nuevo cuando llega
// el recargo real). La promo activa manda sobre el recargo: su precio ES el precio final.
function _applyPricing() {
  const _now = new Date();
  PRODUCTS.forEach(p => {
    p.price = p.basePrice;
    p.hasSurcharge = false;
    if (_surchargeMap[p.id] === true) { p.price = _withSurcharge(p.basePrice); p.hasSurcharge = true; }
    if (p.promo && p.promo.price) {
      const _ended = p.promo.endsAt && new Date(p.promo.endsAt) < _now;
      if (!_ended) {
        p.originalPrice = p.basePrice;
        p.price = +p.promo.price;
        p.isPromo = true;
        p.tag = p.promo.label || 'Oferta';
        p.badge = 'badge-promo';
        p.hasSurcharge = false;
      }
    }
  });
}
// ─── RE-PINTADO TRAS LOS DATOS AUXILIARES ───────────────────
// Recargos, mercados, país y stock llegan después del primer render; cuando cambian algo
// visible se actualizan precios/etiquetas en su lugar (tarjetas sin re-animar, modal abierto,
// carrito y JSON-LD), una sola vez por tanda.
let _lastViewSig = '', _enrichT = null, _noCardAnim = false;
function _viewSig() {
  return PRODUCTS.map(p => p.id + ':' + p.price + ':' + (p.available === false ? 0 : 1) + ':' + (p.market || '')).join('|') +
    '#' + (window.__visitorCountry || '') + '#' + Object.keys(_reviewSummaries).length;
}
function _scheduleEnrich() { clearTimeout(_enrichT); _enrichT = setTimeout(_afterEnrich, 30); }
function _afterEnrich() {
  const sig = _viewSig();
  if (sig === _lastViewSig) return;
  _lastViewSig = sig;
  reconcileCartPrices();
  updateCartUI();
  renderSeasonBanner();
  _softRenderProducts();
  const mo = document.getElementById('modal-overlay');
  if (currentProduct && mo && mo.classList.contains('open')) _refreshOpenModal(currentProduct);
  const co = document.getElementById('checkout-overlay');
  if (co && co.classList.contains('open') && typeof renderCheckoutSummary === 'function') renderCheckoutSummary();
}
// Vuelve a pintar la grilla sin repetir la animación de entrada de las tarjetas y sin perder
// el foco del teclado (mismo tamaño de tarjetas → sin salto de diseño).
function _softRenderProducts() {
  const grid = document.getElementById('prodGrid');
  if (!grid || grid.classList.contains('cat-picker-grid')) return;
  const a = document.activeElement;
  const card = a && grid.contains(a) ? a.closest('.pcard') : null;
  const focusId = card ? card.dataset.id : null;
  const focusCls = card && a.classList.length ? a.classList[0] : '';
  _noCardAnim = true;
  try { renderProducts(); } finally { _noCardAnim = false; }
  if (focusId) {
    const sel = '.pcard[data-id="' + focusId + '"]';
    const el = (focusCls && grid.querySelector(sel + ' .' + focusCls)) || grid.querySelector(sel + ' a');
    if (el) el.focus({ preventScroll: true });
  }
}
// ─── LOAD DATA ──────────────────────────────────────────────
(async function loadData() {
  // Todo sale en paralelo desde el inicio. Solo data/products.json bloquea el primer
  // render; lo demás se aplica cuando llega, o se ignora si falla o no responde a tiempo.
  const _POST0 = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
  const _srP  = fetchJsonT(ADMIN_WORKER_URL + '/pub/surcharges', _POST0);
  const _mktP = fetchJsonT(ADMIN_WORKER_URL + '/pub/markets', _POST0);
  const _ipP  = fetchJsonT('https://api.country.is/');
  // Inventario (18 nov): ids agotados por stock. Si el Worker no responde, la tienda sigue
  // igual (solo cuenta available del catálogo).
  const _soldOutP = _fetchSoldOut();
  _fetchPubReviews();
  if (!window.__visitorCountry) window.__visitorCountry = _guessCountry();
  try {
    const res = await fetchT(PRODUCTS_JSON_URL, undefined, 20000);
    if (!res.ok) throw new Error('no json');
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (data.products || []);
    const cfg = (!Array.isArray(data) && data.config) || {};
    WHATSAPP_NUMBER = (!Array.isArray(data) && (data.whatsapp || cfg.whatsapp)) || '';
    const _waFloatEl = document.getElementById('waFloat');
    if (_waFloatEl && WHATSAPP_NUMBER) {
      const _waFloatNum = String(WHATSAPP_NUMBER).replace(/\D/g, '');
      const _waFloatMsg = __LANG === 'en' ? 'Hi, I have a question about a product' : 'Hola, tengo una consulta sobre un producto';
      _waFloatEl.href = 'https://wa.me/' + _waFloatNum + '?text=' + encodeURIComponent(_waFloatMsg);
    }
    if (Array.isArray(cfg.categories) && cfg.categories.length) CATEGORIES = cfg.categories;
    if (Array.isArray(cfg.materials)  && cfg.materials.length)  MATERIALS  = cfg.materials;
    if (cfg.shipping && typeof cfg.shipping === 'object') {
      const ft = Number(cfg.shipping.freeThreshold), c = Number(cfg.shipping.cost);
      SHIPPING = { freeThreshold: isNaN(ft) ? 90 : ft, cost: isNaN(c) ? 10 : c };
      SHIPPING_CFG = cfg.shipping;
    }
    // config.texts está escrito en español: en la tienda EN solo se aplica config.texts_en
    // (antes los beneficios del modal salían en español en la versión en inglés).
    if (__LANG !== 'en' && cfg.texts && typeof cfg.texts === 'object') TEXTS = { ...TEXTS, ...cfg.texts };
    if (__LANG === 'en' && cfg.texts_en && typeof cfg.texts_en === 'object') TEXTS = { ...TEXTS, ...cfg.texts_en };
    CAMPAIGN = _normalizeCampaign(cfg.campaign);
    // Antes se excluían acá los agotados (available:false) — el producto
    // desaparecía del todo, del sitio y de los buscadores. Ahora se quedan en
    // PRODUCTS con su flag 'available' correcto, y cada consumidor decide qué
    // hacer: la grilla los muestra marcados "Agotado", el modal bloquea la
    // compra, y el ItemList/JSON-LD de listado los sigue excluyendo aparte.
    PRODUCTS = raw.map(normalizeProd);
    COMBOS = (!Array.isArray(data) && Array.isArray(data.combos)) ? data.combos.filter(c => c.available !== false) : [];
    // Auditoría SEO externa (20 sep): antes, un catálogo vacío/malformado caía
    // en un array de 8 productos de demostración inventados — una clienta real
    // vería productos falsos sin ningún aviso de error. Ahora se deja vacío y
    // se avisa de verdad; nunca se sustituye una ficha real por una falsa.
    if (PRODUCTS.length === 0) _showCatalogLoadError();
  } catch(e) {
    PRODUCTS = [];
    _showCatalogLoadError();
  }
  // Recargo provisional (el horneado en el JSON-LD estático) + promos, antes del primer render.
  _surchargeMap = _staticSurcharges();
  _applyPricing();
  // Re-sincroniza el carrito con precios canónicos (evita precios obsoletos
  // o manipulados en localStorage; el cobro real igual se valida en el backend)
  reconcileCartPrices();
  applyTexts();
  renderSeasonBanner();
  renderFreeShippingBanner();
  renderFilters();
  renderMaterials();
  // Un link directo a un producto (?p=) no debe mostrar el selector de categorías detrás
  // del modal — se apaga de una vez, igual que si la clienta ya hubiera elegido.
  const _autoP = new URLSearchParams(window.location.search).get('p') || window.__CACUSA_STATIC_PRODUCT_ID || null;
  if (_autoP) _categoryPickerDismissed = true;
  renderProducts();
  _updateListingSeo();
  loadReviewSummaries();
  renderCombos();
  updateCartUI();
  if (_autoP) {
    const _apId = _extractProductId(_autoP);
    const _ap = PRODUCTS.find(x => String(x.id) === String(_apId));
    if (_ap) {
      openModal(_ap.id);
    } else {
      // Barrido SEO (19 sep, SEO-08): antes un ?p= inventado se quedaba con 200 +
      // index,follow + la tienda genérica — mismo tratamiento que un producto real. No
      // toca productos agotados (available:false): esos SÍ están en PRODUCTS y siguen
      // entrando por la rama de arriba, sin cambios — deben seguir indexados.
      const _robotsMeta = document.querySelector('meta[name="robots"]');
      if (_robotsMeta) _robotsMeta.setAttribute('content', 'noindex, follow');
      showToast(__LANG === 'en' ? 'This product is no longer available.' : 'Este producto ya no está disponible.', 4000);
    }
  }
  const _autoW = new URLSearchParams(window.location.search).get('wishlist');
  if (_autoW) { const _wids = _autoW.split(',').filter(Boolean); if (_wids.length) openWishlist(_wids); }
  // Nov: link del recordatorio de carrito (?cart=id:qty,...) — rellena el carrito.
  _restoreCartFromUrl();
  // Nov: link del pedido de reseña (ficha + #resena, o ?review=1) — abre el formulario.
  if (_autoP && currentProduct && _wantsReviewForm()) _openReviewForm();
  _lastViewSig = _viewSig();
  // Datos auxiliares: se aplican al llegar (re-pintando solo lo que cambió).
  if (!PRODUCTS.length) return;
  _srP.then(d => {
    const sr = d && d.surcharges;
    if (!sr || typeof sr !== 'object') return; // sin respuesta: queda el recargo horneado
    _surchargeMap = {};
    Object.keys(sr).forEach(k => { if (sr[k] === true) _surchargeMap[k] = true; });
    _applyPricing();
    _scheduleEnrich();
  });
  _mktP.then(d => {
    const mkt = d && d.markets;
    if (!mkt || typeof mkt !== 'object') return;
    window.__markets = mkt;
    PRODUCTS.forEach(p => { p.market = mkt[p.id] || 'both'; });
    _scheduleEnrich();
  });
  _ipP.then(d => {
    if (!d || typeof d.country !== 'string' || !/^[A-Za-z]{2}$/.test(d.country)) return; // queda el provisional
    window.__visitorCountry = d.country.toUpperCase();
    _scheduleEnrich();
  });
  _soldOutP.then(d => { if (d && Array.isArray(d.soldOut)) { _applySoldOut(d); _scheduleEnrich(); } });
})();

// ─── INVENTARIO (18 nov) ────────────────────────────────────
// El stock vive en el Worker (KV). /pub/stock devuelve solo los ids agotados (nunca
// cantidades); se tratan EXACTAMENTE como available === false: tarjeta "Agotado", modal sin
// botón de agregar, línea del carrito marcada y checkout bloqueado.
let SOLD_OUT_IDS = new Set();
function _fetchSoldOut() {
  return fetchJsonT(ADMIN_WORKER_URL + '/pub/stock');
}
function _applySoldOut(data) {
  if (!data || !Array.isArray(data.soldOut)) return;
  SOLD_OUT_IDS = new Set(data.soldOut.map(String));
  PRODUCTS.forEach(p => { if (SOLD_OUT_IDS.has(String(p.id))) { p.available = false; p.stockSoldOut = true; } });
}
function _cartItemSoldOut(item) {
  if (!item || item.isCombo) return false;
  const prod = PRODUCTS.find(p => String(p.id) === String(item.id));
  return !!prod && prod.available === false;
}
// Vuelve a aplicar los precios/recargos actuales del catálogo a los ítems guardados
function reconcileCartPrices() {
  if (!Array.isArray(cart) || !cart.length || !PRODUCTS.length) return;
  let changed = false;
  cart = cart.filter(item => {
    if (item.isCombo) return true; // los combos conservan su precio fijo
    const prod = PRODUCTS.find(p => p.id === item.id);
    if (!prod) return false;       // producto ya no disponible → se quita del carrito
    if (item.price !== prod.price || item.basePrice !== prod.basePrice || item.hasSurcharge !== !!prod.hasSurcharge) {
      item.price        = prod.price;
      item.basePrice    = prod.basePrice;
      item.hasSurcharge = !!prod.hasSurcharge;
      changed = true;
    }
    return true;
  });
  if (changed || cart.length !== JSON.parse(__LS.getItem('cacusa-cart') || '[]').length) saveCart();
}

// ─── APLICAR CONFIG DINÁMICA ────────────────────────────────
function applyTexts() {
  const set = (sel, val) => { const el = document.querySelector(sel); if (el && val != null) el.textContent = val; };
  set('.store-hero-label', TEXTS.heroLabel);
  set('.store-hero-h', TEXTS.heroTitle);
  set('.store-hero-s', TEXTS.heroSubtitle);
  const perksEl = document.querySelector('.modal-perks');
  if (perksEl && Array.isArray(TEXTS.perks)) {
    // "Envío express" (config.texts.perks, editable en el admin) contradice los 5–10 días
    // hábiles que se muestran al lado: se filtra cualquier beneficio que diga "express".
    perksEl.innerHTML = TEXTS.perks.filter(p => !/express/i.test(String(p || ''))).map(p =>
      '<div class="perk"><div class="perk-dot"></div>' + esc(p) + '</div>').join('');
  }
  const bEs = document.getElementById('lEs'), bEn = document.getElementById('lEn');
  if (bEs) bEs.className = __LANG === 'es' ? 'on' : '';
  if (bEn) bEn.className = __LANG === 'en' ? 'on' : '';
}
function renderFreeShippingBanner() {
  const el = document.getElementById('freeShippingBanner');
  if (!el) return;
  const threshold = SHIPPING.freeThreshold.toFixed(0);
  el.textContent = __LANG === 'en'
    ? 'Free shipping on orders $' + threshold + '+'
    : 'Envío gratis en pedidos desde $' + threshold;
  el.style.display = 'block';
}
// Franja de temporada sobre el aviso de envío gratis (#seasonBanner). Fecha de "stock"
// (piezas listas) del mercado de la visitante, o las 2 si no se conoce; se oculta sola
// cuando la campaña está apagada/vencida o la fecha de la visitante ya pasó.
function renderSeasonBanner() {
  const el = document.getElementById('seasonBanner');
  if (!el) return;
  const en = __LANG === 'en';
  const list = _campaignDeadlines('stock');
  if (!list.length) { el.hidden = true; return; }
  const known = !!_campaignCountry();
  const title = en ? CAMPAIGN.title_en : CAMPAIGN.title;
  const custom = en ? CAMPAIGN.banner_en : CAMPAIGN.banner;
  let text;
  if (custom) {
    const fecha = known
      ? _fmtCampaignDate(list[0].date)
      : list.map(x => _fmtCampaignDate(x.date) + ' (' + _campaignCountryLabel(x.country) + ')').join(en ? ' or ' : ' o hasta el ');
    text = custom.replace(/\{(fecha|date)\}/g, fecha);
  } else if (known) {
    text = '✦ ' + title + ' · ' + (en ? 'order by ' : 'pide hasta el ') + _fmtCampaignDate(list[0].date) + (en ? ' to get them in time' : ' para recibirlos a tiempo');
  } else {
    text = '✦ ' + title + ' · ' + list.map((x, i) =>
      _campaignCountryLabel(x.country) + ': ' + (en ? (i ? 'by ' : 'order by ') : (i ? 'hasta el ' : 'pide hasta el ')) + _fmtCampaignDate(x.date)
    ).join(' · ');
  }
  // CLS: la franja viene pre-pintada en el HTML (generate_noscript_catalog.py) con las fechas
  // de los 2 países; al conocerse el país el texto se acorta. Mientras carga la página no se
  // encoge (min-height), así no se mueve lo de abajo; un cambio de ancho lo libera.
  const _prevH = el.hidden ? 0 : el.offsetHeight;
  el.textContent = text;
  el.href = en ? '/en/guia-regalos.html' : '/guia-regalos.html';
  el.hidden = false;
  if (_prevH && el.offsetHeight < _prevH) el.style.minHeight = _prevH + 'px';
}
(function () {
  let w = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === w) return;
    w = window.innerWidth;
    const el = document.getElementById('seasonBanner'); if (el) el.style.minHeight = '';
  }, { passive: true });
})();
// Línea "llega antes de Navidad" del modal, bajo el precio: fecha de personalización si la
// pieza es personalizable, si no la de stock. Oculta si ya pasó o si está agotada. En las
// personalizables los 5–10 días hábiles corren desde que se confirma el diseño por WhatsApp,
// así que la frase pide pedir Y confirmar hasta esa fecha (no garantiza solo por pedir).
function _renderModalXmas(p) {
  const el = document.getElementById('modalXmas');
  if (!el) return;
  const en = __LANG === 'en';
  const list = (p && p.available !== false) ? _campaignDeadlines(p.personalized ? 'personal' : 'stock') : [];
  if (!list.length) { el.hidden = true; el.textContent = ''; return; }
  const dates = _campaignCountry()
    ? _fmtCampaignDate(list[0].date)
    : list.map(x => _fmtCampaignDate(x.date) + ' (' + _campaignCountryLabel(x.country) + ')').join(en ? ' or ' : ' o hasta el ');
  el.textContent = '◇ ' + (p.personalized
    ? (en ? 'To get it before Christmas, order and confirm your design on WhatsApp by ' : 'Para recibirla antes de Navidad, pide y confirma tu diseño por WhatsApp hasta el ')
    : (en ? 'Arrives before Christmas if you order by ' : 'Llega antes de Navidad si pides hasta el ')) + dates;
  el.hidden = false;
}
function renderFilters() {
  const wrap = document.getElementById('filterBtns');
  if (!wrap) return;
  wrap.innerHTML = '<button class="filter-btn active" data-filter="all">' + t('store.all', 'Todo') + '</button>' +
    CATEGORIES.map(c => '<button class="filter-btn" data-filter="' + c + '">' + t('cat.' + c.toLowerCase(), c) + '</button>').join('');
  wrap.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => selectCategory(btn.dataset.filter));
  });
  _renderDrawerCats();
  // Permite enlazar a una categoría desde fuera (ej. footer del landing) con ?cat=NombreCategoria
  // — o, si es una página estática generada por producto/categoría (ver
  // generate_product_pages.py), window.__CACUSA_STATIC_CATEGORY, que no lleva query string.
  const reqCat = new URLSearchParams(window.location.search).get('cat') || window.__CACUSA_STATIC_CATEGORY || null;
  if (reqCat) {
    const match = [...wrap.querySelectorAll('.filter-btn')].find(b => b.dataset.filter.toLowerCase() === reqCat.toLowerCase());
    if (match) {
      wrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      match.classList.add('active');
      activeFilter = match.dataset.filter;
      requestAnimationFrame(_scrollActiveChipIntoView);
    }
  }
}
function renderMaterials() {} // material fijo por producto, no seleccionable

// ─── CURSOR ─────────────────────────────────────────────────
// El cursor personalizado (punto + anillo que seguía al mouse) se quitó: se usa el cursor
// normal del sistema en todo el sitio. Se deja esta función vacía por si alguna página
// estática generada antes de este cambio todavía la llama.
function refreshCursorTargets() {}

// ─── IMAGE HELPERS ───────────────────────────────────────────
// Escapa texto/atributos antes de interpolar en innerHTML (evita romper el HTML y self-XSS)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// focalX/focalY/zoom vienen de products.json y van dentro de style= — forzar número y rango
function _focal(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50; }
// Mínimo 1 (auditoría visual): alejar la foto (scale < 1) dejaba la imagen chica dentro de un
// marco vacío y a la vez recortada por object-fit:cover. Un zoom < 1 del admin se trata como 1.
function _zoom(v)  { const n = Number(v); return Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 1; }
// Aviso emergente (toast) temporal, abajo-centro
let _toastTimer = null;
function showToast(html, ms) {
  const el = document.getElementById('cacusaToast');
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms || 4500);
}
function dismissToast() {
  clearTimeout(_toastTimer);
  const el = document.getElementById('cacusaToast');
  if (el) el.classList.remove('show');
}
document.getElementById('cacusaToast').addEventListener('click', dismissToast);
// Menú móvil: un enlace por categoría (página física de la categoría). En la tienda se
// filtra en el lugar, sin recargar; Ctrl/Cmd+clic sigue abriendo la URL real.
function _renderDrawerCats() {
  const box = document.getElementById('drawerCats');
  if (!box) return;
  const base = (__LANG === 'en' ? '/en' : '') + '/ui_kits/store/categoria/';
  box.innerHTML = CATEGORIES.map(c =>
    '<a class="drawer-cat" href="' + base + _categorySlug(c) + '/" data-cat="' + esc(c) + '">' + esc(t('cat.' + c.toLowerCase(), c)) + '</a>').join('');
  box.querySelectorAll('.drawer-cat').forEach(a => a.addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!document.getElementById('prodGrid')) return;
    e.preventDefault();
    if (typeof window._closeNavDrawer === 'function') window._closeNavDrawer();
    selectCategory(a.dataset.cat);
    _scrollToCatalog(true);
  }));
}
// Barrido SEO (19 sep): las tarjetas de la tienda no tenían ningún <a href> real hacia el
// producto — todo era onclick sobre <div>/<button>, invisible para un rastreador que no
// ejecuta JS. _pcardHref() arma la URL real (misma que usa _injectProductSchema como
// canonical); _pcardNav() deja que un clic normal siga abriendo el modal al instante (sin
// recargar la página), pero un clic con Ctrl/Cmd/rueda del mouse navega de verdad a la URL
// real (nueva pestaña) — comportamiento estándar de cualquier enlace.
function _pcardHref(p) {
  return (__LANG === 'en' ? '/en' : '') + '/ui_kits/store/producto/' + _productParam(p) + '/';
}
// Toda la tarjeta abre el producto (antes la descripción y el precio no respondían en móvil);
// los enlaces y botones propios de la tarjeta conservan su acción.
function _pcardClick(e, id) {
  if (e.target.closest('a,button')) return;
  openModal(id);
}
function _pcardNav(e, id) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return true;
  e.preventDefault();
  openModal(id);
  return false;
}
function imgBgStyle(p) {
  return p && p.imageUrl ? '' : 'background:' + ((p && p.grad) || 'var(--grad)');
}
function imgInner(p, alt) {
  if (p && p.imageUrl) {
    const pos  = _focal(p.focalX) + '% ' + _focal(p.focalY) + '%';
    const zoom = _zoom(p.zoom);
    const altText = alt ? alt + ' — handcrafted personalized jewelry by CACUSA' : 'Handcrafted personalized jewelry by CACUSA';
    const grad = esc((p && p.grad) || 'var(--grad)');
    return '<img src="' + esc(p.imageUrl) + '" alt="' + esc(altText) + '" loading="lazy" width="220" height="220" onerror="_imgFallback(this,\'' + grad + '\')" style="object-position:' + pos + ';transform:scale(' + zoom + ');transform-origin:' + pos + '">';
  }
  return '';
}
// Si la imagen de un producto no carga, ocultarla y mostrar el degradado de marca en su lugar
function _imgFallback(el, grad) {
  el.style.display = 'none';
  if (el.parentElement) el.parentElement.style.background = grad || 'var(--grad)';
}

// ─── MARKET BADGE ───────────────────────────────────────────
function getMarketBadge(p) {
  const market  = p.market || 'both';
  const country = window.__visitorCountry;
  if (!country || market === 'both') return '';
  const isEC = country === 'EC';
  if (isEC) {
    if (market === 'ec') return `<div class="pcard-market mkt-local">◎ ${t('store.mktLocal','Producto local')}</div>`;
    if (market === 'us') return `<div class="pcard-market mkt-import">◇ ${t('store.mktImport','Importado desde EE.UU.')}</div>`;
  } else {
    if (market === 'us') return `<div class="pcard-market mkt-local">◎ ${t('store.mktLocal','Producto local')}</div>`;
    if (market === 'ec') return `<div class="pcard-market mkt-ec-only">◎ ${t('store.mktEcOnly','Enviado desde Ecuador')}</div>`;
  }
  return '';
}

// ─── CATEGORY PICKER (primera pantalla) ──────────────────────
// En vez de recibir a la clienta con los 74 productos de golpe, la primera vista es un
// selector visual de categorías — menos abrumador, más parecido a Mejuri/Kendra Scott.
let _catTileTimers = [];
const _reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function _clearCatTileTimers() { _catTileTimers.forEach(clearInterval); _catTileTimers = []; }
function renderCategoryPicker() {
  _clearCatTileTimers();
  const grid = document.getElementById('prodGrid');
  grid.className = 'cat-picker-grid';
  // Hasta 3 fotos distintas por categoría (bestseller primero), para el crossfade.
  const tilesData = CATEGORIES.map(cat => {
    const catProducts = PRODUCTS.filter(p => p.cat === cat && p.available !== false);
    const bestsellers = catProducts.filter(p => (p.tag || '').toLowerCase() === 'bestseller');
    const ordered = [...bestsellers, ...catProducts.filter(p => !bestsellers.includes(p))];
    const images = [];
    for (const p of ordered) {
      const img = getProductImages(p)[0];
      if (img && !images.includes(img)) images.push(img);
      if (images.length >= 3) break;
    }
    return { cat, label: t('cat.' + cat.toLowerCase(), cat), images };
  });
  const tiles = tilesData.map((d, i) => {
    const bg0 = d.images[0] ? `background-image:url('${d.images[0].replace(/'/g, '%27')}')` : 'background:var(--grad)';
    return `
      <div class="cat-tile" role="button" tabindex="0" aria-label="${esc(d.label)}" onclick="selectCategory('${d.cat.replace(/'/g, "\\'")}')" onkeydown="activateOnKey(event,()=>selectCategory('${d.cat.replace(/'/g, "\\'")}'))">
        <div class="cat-tile-bg on" data-tile="${i}" style="${bg0}"></div>
        <div class="cat-tile-bg" data-tile="${i}"></div>
        <div class="cat-tile-overlay"></div>
        <div class="cat-tile-label"><span>${esc(d.label)}</span></div>
      </div>`;
  }).join('');
  grid.innerHTML = tiles +
    `<div class="cat-picker-viewall-wrap"><span class="cat-picker-viewall" role="button" tabindex="0" onclick="selectCategory('all')" onkeydown="activateOnKey(event,()=>selectCategory('all'))">${t('store.viewAllCatalog', 'Ver todo el catálogo →')}</span></div>`;
  // Carrusel con crossfade — mismo patrón que el slideshow del hero del landing
  // (2 capas superpuestas, opacidad cruzada), un pequeño desfase por tarjeta para
  // que no cambien todas a la vez.
  if (_reduceMotion) return;
  tilesData.forEach((d, i) => {
    if (d.images.length <= 1) return;
    const layers = grid.querySelectorAll('.cat-tile-bg[data-tile="' + i + '"]');
    const tile = grid.querySelectorAll('.cat-tile')[i];
    let front = layers[0], idx = 0;
    const interval = 3600 + i * 220;
    const advance = () => {
      idx = (idx + 1) % d.images.length;
      const back = front === layers[0] ? layers[1] : layers[0];
      back.style.backgroundImage = "url('" + d.images[idx].replace(/'/g, '%27') + "')";
      back.classList.add('on'); front.classList.remove('on');
      front = back;
    };
    let timer = setInterval(advance, interval);
    _catTileTimers.push(timer);
    if (tile) {
      const pause = () => { clearInterval(timer); timer = null; };
      const resume = () => { if (!timer) { timer = setInterval(advance, interval); _catTileTimers.push(timer); } };
      tile.addEventListener('mouseenter', pause);
      tile.addEventListener('mouseleave', resume);
      tile.addEventListener('focusin', pause);
      tile.addEventListener('focusout', resume);
    }
  });
}

// ─── RENDER PRODUCTS ────────────────────────────────────────
function _searchNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
// ─── BÚSQUEDA (wave 1) ──────────────────────────────────────
// Antes se buscaba la frase entera dentro de cada campo: "collar oro" → 0 resultados,
// "collar" → solo 4 de las 23 cadenas, "anilo" → 0. Ahora: palabras sueltas con lógica Y,
// sin acentos, en nombre (ES/EN), descripción, categoría y material; sinónimos ES/EN
// (collar = cadena = necklace…), singular/plural, tolerancia a 1 error de tipeo en palabras
// de 4+ letras, y orden por relevancia (coincidir en el nombre pesa más que en la descripción).
const _SEARCH_SYN = [
  ['collar', 'collares', 'cadena', 'cadenas', 'cadenita', 'necklace', 'necklaces', 'chain', 'chains', 'gargantilla', 'choker'],
  ['oro', 'dorado', 'dorada', 'dorados', 'doradas', 'gold', 'golden', 'goldfilled'],
  ['plata', 'plateado', 'plateada', 'plateados', 'plateadas', 'silver'],
  ['arete', 'aretes', 'pendiente', 'pendientes', 'earring', 'earrings', 'argolla', 'argollas', 'hoop', 'hoops', 'topo', 'topos', 'stud', 'studs'],
  ['pulsera', 'pulseras', 'brazalete', 'brazaletes', 'bracelet', 'bracelets', 'manilla', 'manillas', 'esclava'],
  ['anillo', 'anillos', 'sortija', 'sortijas', 'ring', 'rings'],
  ['dije', 'dijes', 'charm', 'charms', 'pendant', 'pendants', 'colgante', 'colgantes'],
  ['acero', 'steel', 'stainless', 'inoxidable'],
  ['corazon', 'corazones', 'heart', 'hearts'],
  ['cruz', 'cruces', 'cross', 'crosses', 'crucifijo'],
  ['perla', 'perlas', 'pearl', 'pearls'],
  ['hombre', 'hombres', 'men', 'man', 'mens', 'caballero', 'caballeros'],
  ['pareja', 'parejas', 'couple', 'couples'],
  ['juego', 'juegos', 'set', 'sets', 'conjunto', 'conjuntos'],
  ['personalizado', 'personalizada', 'personalizados', 'personalizable', 'personalizables', 'personalized', 'custom', 'grabado', 'engraved'],
  ['inicial', 'iniciales', 'initial', 'initials', 'letra', 'letras', 'letter'],
  ['nombre', 'nombres', 'name', 'names'],
  ['circon', 'circones', 'zirconia', 'zirconias', 'zircon', 'zircons', 'circonia', 'circonias'],
  ['mariposa', 'mariposas', 'butterfly', 'butterflies'],
  ['estrella', 'estrellas', 'star', 'stars'],
  ['luna', 'moon'],
  ['flor', 'flores', 'flower', 'flowers'],
  ['angel', 'angeles', 'angels'],
  ['virgen', 'virgin', 'mary'],
  ['ojo', 'ojos', 'eye', 'eyes', 'turco'],
  ['regalo', 'regalos', 'gift', 'gifts'],
];
const _SEARCH_STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'e', 'en', 'para', 'un', 'una', 'por', 'the', 'with', 'and', 'of', 'for', 'a', 'an', 'in', 'to']);
const _SEARCH_MAT_EN = { 'baño de oro 18k': '18k gold plated', 'acero inoxidable': 'stainless steel', 'plata 925': '925 silver', 'baño de rodio': 'rhodium plated', 'plata 925 con un baño de oro de 18k': '925 silver with 18k gold plating' };
const _SYN_OF = (() => { const m = new Map(); _SEARCH_SYN.forEach((g, i) => g.forEach(w => m.set(w, 'g' + i))); return m; })();
const _SYN_WORDS = [..._SYN_OF.keys()];
// Singular aproximado ES/EN: collares→collar, corazones→corazon, aretes→arete, rings→ring.
function _searchStem(w) {
  if (w.length > 4 && /[rlndz]es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}
function _searchTokens(s) { return _searchNorm(s).split(/[^a-z0-9]+/).filter(Boolean); }
function _searchKey(w) { return _SYN_OF.get(w) || _SYN_OF.get(_searchStem(w)) || _searchStem(w); }
// ¿Distancia de Levenshtein ≤ 1? (lineal: una sustitución, inserción o borrado)
function _lev1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}
// Índice por producto (se cachea por objeto: PRODUCTS no cambia de nombre/descr. en la sesión)
const _searchIdx = new WeakMap();
function _searchDoc(p) {
  let d = _searchIdx.get(p);
  if (d) return d;
  const mat = String(p.material || '');
  const fields = [
    [10, [p.name, p.name_en].join(' ')],
    [6, [p.cat, t('cat.' + (p.cat || '').toLowerCase(), ''), __EN_T['cat.' + (p.cat || '').toLowerCase()] || ''].join(' ')],
    [4, [mat, _SEARCH_MAT_EN[mat.toLowerCase()] || ''].join(' ')],
    [2, [p.desc, p.description_en].join(' ')],
  ];
  d = fields.map(([w, txt]) => {
    const toks = _searchTokens(txt).map(x => ({ stem: _searchStem(x), key: _searchKey(x) }));
    return { w, toks };
  });
  _searchIdx.set(p, d);
  return d;
}
// Una palabra de la búsqueda → qué la satisface: su clave (grupo de sinónimos o raíz), los
// grupos a 1 error de tipeo ("pulcera" → pulsera) y, para el prefijo, su raíz.
function _searchTerm(w) {
  const stem = _searchStem(w), keys = new Set([_searchKey(w)]);
  if (w.length >= 4 && !_SYN_OF.has(w) && !_SYN_OF.has(stem)) {
    _SYN_WORDS.forEach(sw => { if (_lev1(w, sw) || _lev1(stem, sw)) keys.add(_SYN_OF.get(sw)); });
  }
  return { w, stem, keys };
}
function _termScore(doc, q) {
  let best = 0;
  for (const f of doc) {
    for (const tk of f.toks) {
      let s = 0;
      if (q.keys.has(tk.key) || tk.stem === q.stem) s = f.w;
      else if (q.w.length >= 3 && tk.stem.startsWith(q.stem)) s = f.w * 0.7;
      else if (q.w.length >= 4 && tk.stem.length >= 4 && _lev1(tk.stem, q.stem)) s = f.w * 0.6;
      if (s > best) { best = s; if (best === 10) return best; }
    }
  }
  return best;
}
// Devuelve { list, scores } — list filtrada (lógica Y entre palabras), scores para ordenar.
function _searchProducts(list, raw) {
  const words = _searchTokens(raw);
  const useful = words.filter(w => !_SEARCH_STOP.has(w));
  const terms = (useful.length ? useful : words).map(_searchTerm);
  const scores = new Map();
  const qn = _searchNorm(raw).trim();
  const skuQ = qn.replace(/[\s-]+/g, '');
  const out = list.filter(p => {
    // Código de producto (AN001): "an001", "AN 001", "an-001" o "an00" también lo encuentran.
    if (typeof p.sku === 'string' && /^[a-z]{2}\d+$/.test(skuQ) && _searchNorm(p.sku).startsWith(skuQ)) { scores.set(p.id, 100); return true; }
    if (!terms.length) return false;
    const doc = _searchDoc(p);
    let total = 0;
    for (const q of terms) { const s = _termScore(doc, q); if (!s) return false; total += s; }
    // La frase completa dentro del nombre suma (ej. "dije de bailarina").
    if (qn.length > 2 && _searchNorm([p.name, p.name_en].join(' ')).includes(qn)) total += 5;
    scores.set(p.id, total);
    return true;
  });
  return { list: out, scores };
}
function renderProducts() {
  const grid = document.getElementById('prodGrid');
  _renderUrlFilterChips();
  if (activeFilter === 'all' && !searchTerm && !_categoryPickerDismissed) { renderCategoryPicker(); return; }
  _clearCatTileTimers();
  grid.className = 'prod-grid';
  // Con una búsqueda activa se busca en TODO el catálogo (antes solo dentro de la categoría
  // elegida, sin avisarlo); los chips de categoría se ven inactivos mientras tanto.
  const _fb = document.getElementById('filterBtns');
  if (_fb) _fb.classList.toggle('is-searching', !!searchTerm);
  let filtered = (activeFilter === 'all' || searchTerm)
    ? PRODUCTS
    : PRODUCTS.filter(p => p.cat === activeFilter || (p.cat || '').startsWith(activeFilter));
  let _scores = null;
  if (searchTerm) {
    const _sr = _searchProducts(filtered, searchTerm);
    filtered = _sr.list;
    _scores = _sr.scores;
  }
  if (_urlPrice) filtered = filtered.filter(p => { const pr = +p.price; return pr >= _urlPrice.min && (_urlPrice.max == null || pr < _urlPrice.max); });
  if (_hasUrlFilters()) filtered = filtered.filter(p => p.available !== false);
  if (_urlPersonal) filtered = filtered.filter(p => p.personalized);
  const sort = document.getElementById('sortSelect').value;
  const _soldOutLast = (a, b) => (a.available === false ? 1 : 0) - (b.available === false ? 1 : 0);
  if (sort === 'price-asc') filtered = [...filtered].sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') filtered = [...filtered].sort((a, b) => b.price - a.price);
  // "Más nuevos": products.json no trae fecha de alta, pero el id de cada producto es el
  // Date.now() del momento en que se creó desde el panel admin (el único más viejo es el
  // id 1) — ordenar por id descendente es ordenar por fecha de alta real.
  else if (sort === 'new') filtered = [...filtered].sort((a, b) => _soldOutLast(a, b) || (Number(b.id) - Number(a.id)));
  // "Más vendidos": no hay conteo de ventas en el catálogo; la única señal real es la
  // etiqueta "Bestseller" que pone el negocio desde el panel. Esos van primero y el resto
  // conserva el orden destacado de siempre.
  else if (sort === 'bestseller') filtered = [...filtered].sort((a, b) => _soldOutLast(a, b) || (_isBestseller(b) - _isBestseller(a)));
  // Búsqueda con el orden "Destacados": por relevancia (los agotados al final).
  else if (_scores) filtered = [...filtered].sort((a, b) => _soldOutLast(a, b) || ((_scores.get(b.id) || 0) - (_scores.get(a.id) || 0)));
  // ?regalo=1 con el orden "Destacados": personalizables, luego Bestseller, luego el resto.
  else if (_urlGift) filtered = [...filtered].sort((a, b) => _giftRank(a) - _giftRank(b));
  else filtered = [...filtered].sort((a, b) => {
    const sa = a.available === false ? 2 : (a.badge === 'badge-sale' || a.badge === 'badge-promo' || a.isPromo) ? 0 : 1;
    const sb = b.available === false ? 2 : (b.badge === 'badge-sale' || b.badge === 'badge-promo' || b.isPromo) ? 0 : 1;
    return sa - sb;
  });
  if (filtered.length === 0) {
    grid.innerHTML = _emptyStateHtml();
    return;
  }
  grid.innerHTML = filtered.map(_pcardHtml).join('');
}
function _isBestseller(p) { const tg = (p.tag || '').toLowerCase(); return (tg === 'bestseller' || tg === 'best seller') ? 1 : 0; }
// Porcentaje de descuento real: precio anterior (oldPrice del catálogo, o el precio base
// cuando hay una promo activa) contra el precio que se cobra hoy. 0 si no hay descuento.
function _discountPct(p) {
  const old = (p.isPromo && p.originalPrice) ? +p.originalPrice : +p.oldPrice;
  const now = +p.price;
  if (!old || !now || old <= now) return 0;
  return Math.round((old - now) / old * 100);
}
// Link de WhatsApp con el número real del catálogo (mismo default que el botón flotante)
function _waLink(text) {
  const num = String(WHATSAPP_NUMBER || '17867375336').replace(/\D/g, '');
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
}
// Hasta n productos destacados en stock: Bestseller primero, después Nuevo, después el resto
// (orden del catálogo). Lo usan la búsqueda sin resultados y el carrito vacío.
function _featuredProducts(n) {
  const rank = p => _isBestseller(p) ? 0 : ((p.tag || '').toLowerCase() === 'nuevo' || (p.tag || '').toLowerCase() === 'new') ? 1 : 2;
  return PRODUCTS.filter(p => p.available !== false).sort((a, b) => rank(a) - rank(b)).slice(0, n);
}
// Sin resultados: mensaje, botón que limpia búsqueda y categoría, link a WhatsApp con lo
// que se buscó, y hasta 4 productos sugeridos (bestseller y nuevos primero, en stock).
function _emptyStateHtml() {
  const en = __LANG === 'en';
  const msg = searchTerm
    ? (en ? 'No products match "' : 'No hay productos que coincidan con "') + esc(searchTerm) + '".'
    : _hasUrlFilters()
      ? (en ? 'No products match these filters.' : 'No hay productos con estos filtros.')
      : t('store.emptyCategory', 'No hay productos en esta categoría aún.');
  const waText = searchTerm
    ? (en ? 'Hi! I am looking for: ' : '¡Hola! Estoy buscando: ') + searchTerm
    : (en ? 'Hi! I have a question about a product' : '¡Hola! Tengo una consulta sobre un producto');
  const sugg = _featuredProducts(4);
  // Búsqueda sin resultados: atajos a las categorías con más piezas y a la búsqueda por foto.
  let tips = '';
  if (searchTerm) {
    const counts = {};
    PRODUCTS.forEach(p => { if (p.available !== false && p.cat) counts[p.cat] = (counts[p.cat] || 0) + 1; });
    const top = CATEGORIES.filter(c => counts[c]).sort((a, b) => counts[b] - counts[a]).slice(0, 5);
    tips = '<p class="empty-tip">' + (en ? 'Try fewer words, or browse a category:' : 'Prueba con menos palabras o mira una categoría:') + '</p>' +
      '<div class="empty-cats">' + top.map(c => '<button type="button" class="filter-btn empty-cat" data-cat="' + esc(c) + '">' + esc(t('cat.' + c.toLowerCase(), c)) + '</button>').join('') +
      '<button type="button" class="photo-search-btn empty-photo">' + (en ? '◇ Search by photo' : '◇ Buscar por foto') + '</button></div>';
  }
  return '<div class="empty-state">' +
      '<p class="empty-msg" role="status" aria-live="polite">' + msg + '</p>' + tips +
      '<button type="button" class="empty-all" onclick="_clearAllFilters()">' + (en ? 'View full catalog' : 'Ver todo el catálogo') + '</button>' +
      '<a class="empty-wa" href="' + esc(_waLink(waText)) + '" target="_blank" rel="noopener">' + (en ? 'Looking for something special? Message us on WhatsApp' : '¿Buscas algo en especial? Escríbenos por WhatsApp') + '</a>' +
      (sugg.length ? '<div class="empty-sugg-title">' + (en ? 'You might like' : 'Quizás te guste') + '</div>' : '') +
    '</div>' + sugg.map(_pcardHtml).join('');
}
function _clearAllFilters() {
  searchTerm = '';
  const si = document.getElementById('searchInput'); if (si) si.value = '';
  const sc = document.getElementById('searchClear'); if (sc) sc.style.display = 'none';
  if (_hasUrlFilters()) {
    const u = new URL(window.location.href);
    u.searchParams.delete('precio'); u.searchParams.delete('regalo'); u.searchParams.delete('personalizado');
    history.replaceState(history.state, '', u.toString());
    _readUrlFilters();
  }
  selectCategory('all');
}
function _pcardHtml(p, i) {
  const _off = _discountPct(p);
  return `
    <div class="pcard${p.available === false ? ' pcard--soldout' : ''}" style="${_noCardAnim ? 'animation:none' : 'animation-delay:' + (i || 0) * 0.06 + 's'}" data-id="${p.id}" onclick="_pcardClick(event, ${p.id})">
      ${p.available === false ? `<div class="pcard-badge badge-soldout">${__LANG === 'en' ? 'Sold out' : 'Agotado'}</div>` : (p.badge ? `<div class="pcard-badge ${p.badge}">${esc(tagLabel(p.tag))}</div>` : '')}
      <button class="pcard-wish${_wish.has(p.id)?' liked':''}" aria-label="${__LANG === 'en' ? 'Save to wishlist' : 'Guardar en lista de deseos'}" onclick="toggleWish(${p.id},this)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" style="${_wish.has(p.id)?'fill:var(--pink)':''}"/></svg>
      </button>
      <a class="pcard-img" href="${_pcardHref(p)}" onclick="return _pcardNav(event, ${p.id})">
        <div class="pcard-img-bg" style="${imgBgStyle(p)}">${imgInner(p, p.name)}</div>
        <div class="pcard-quick">${t('store.quickView', 'Vista rápida →')}</div>
      </a>
      <div class="pcard-body">
        <div class="pcard-cat">${t('cat.' + (p.cat||'').toLowerCase(), p.cat || '')}</div>
        <a class="pcard-name" href="${_pcardHref(p)}" onclick="return _pcardNav(event, ${p.id})">${esc(__LANG === 'en' && p.name_en ? p.name_en : p.name)}</a>
        <div class="pcard-desc">${esc((__LANG === 'en' && p.description_en ? p.description_en : (p.desc || '')).substring(0, 60))}…</div>
        ${(()=>{const r=_reviewSummaries[p.id];return r&&r.count?`<div class="pcard-stars">${renderStars(r.avg)}<span class="pcard-stars-count">(${r.count})</span></div>`:''})()}
        ${getMarketBadge(p)}
        <div class="pcard-foot">
          <div class="pcard-price">
            <span class="price-now">$${(+p.price).toFixed(2)}</span>
            ${p.isPromo && p.originalPrice ? `<span class="price-old">$${(+p.originalPrice).toFixed(2)}</span>` : (p.oldPrice ? `<span class="price-old">$${(+p.oldPrice).toFixed(2)}</span>` : '')}
            ${_off > 0 ? `<span class="price-off">-${_off}%</span>` : ''}
          </div>
          <button class="pcard-add" onclick="openModal(${p.id})">${t('store.viewBtn', '+ Ver')}</button>
        </div>
      </div>
    </div>
  `;
}

// ─── COMBOS ─────────────────────────────────────────────────
function renderCombos() {
  const section = document.getElementById('comboSection');
  const scroll  = document.getElementById('comboScroll');
  if (!section || !scroll) return;
  if (COMBOS.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const titleEl = section.querySelector('.combo-section-title');
  if (titleEl) titleEl.textContent = t('combo.sectionTitle', 'Combos y Paquetes');
  scroll.innerHTML = COMBOS.map(c => {
    const items = (c.items || []).map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
    const origTotal = items.reduce((s, p) => s + p.basePrice, 0);
    const saving = origTotal > c.price ? (origTotal - c.price).toFixed(2) : null;
    const imgEl = c.imageUrl
      ? `<img class="combo-img" src="${esc(c.imageUrl)}" alt="${esc(c.name)}">`
      : `<div class="combo-img-ph">◇</div>`;
    return `
      <div class="combo-card" onclick="addComboToCart(${c.id}, this)">
        ${imgEl}
        <div class="combo-body">
          <div class="combo-name">${esc(c.name)}</div>
          <div class="combo-desc">${esc(items.map(p => p.name).slice(0,3).join(' + '))}${items.length > 3 ? t('combo.more', ' +más') : ''}</div>
          <div class="combo-prices">
            <span class="combo-price-now">$${(+c.price).toFixed(2)}</span>
            ${saving ? `<span class="combo-price-old">$${origTotal.toFixed(2)}</span><span class="combo-saving">${t('combo.saving', 'Ahorras $')}${saving}</span>` : ''}
          </div>
          <button class="combo-add">${t('combo.add', 'Agregar combo')}</button>
        </div>
      </div>`;
  }).join('');
}

// UX tanda 2: antes el combo entraba al carrito sin ninguna señal visible. Ahora da el mismo
// feedback que "Añadir al carrito" del modal: el botón pasa a "✓ Añadido" y a los 800 ms se
// abre el carrito.
function addComboToCart(id, cardEl) {
  const combo = COMBOS.find(c => c.id === id);
  if (!combo) return;
  const btn = cardEl && cardEl.querySelector('.combo-add');
  if (btn && btn.classList.contains('added')) return; // doble toque mientras se confirma
  cart.push({
    id: combo.id,
    name: combo.name,
    price: +combo.price,
    basePrice: +combo.price,
    hasSurcharge: false,
    isCombo: true,
    grad: 'linear-gradient(135deg,#FCE8F3,#EE6FA8,#C4A0EC)',
    img: 'collar',
    cartId: Date.now()
  });
  saveCart(); updateCartUI();
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = __LANG === 'en' ? '✓ Added' : '✓ Añadido';
    btn.classList.add('added');
    setTimeout(() => { btn.textContent = prev; btn.classList.remove('added'); }, 1600);
  }
  setTimeout(openCart, 800);
}

// ─── FILTERS (los botones se generan en renderFilters) ──────
// Placeholder corto en móvil (el largo se cortaba: "Buscar produc").
(function () {
  const si = document.getElementById('searchInput');
  if (!si || !window.matchMedia) return;
  const mq = window.matchMedia('(max-width: 600px)');
  const apply = () => { si.placeholder = mq.matches ? t('store.searchShort', 'Buscar…') : t('store.search', 'Buscar productos…'); };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
})();
document.getElementById('sortSelect').addEventListener('change', renderProducts);
document.getElementById('prodGrid').addEventListener('click', e => {
  const c = e.target.closest('.empty-cat');
  if (c) { selectCategory(c.dataset.cat); return; }
  if (e.target.closest('.empty-photo')) openPhotoSearch();
});
document.getElementById('searchInput').addEventListener('input', e => {
  searchTerm = e.target.value.trim();
  document.getElementById('searchClear').style.display = searchTerm ? 'block' : 'none';
  renderProducts();
});
document.getElementById('searchClear').addEventListener('click', () => {
  searchTerm = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  renderProducts();
});
// ?q= — el SearchAction del schema del sitio (index.html) apunta acá. El catálogo
// carga por fetch asíncrono, así que alcanza con dejar el término puesto: el
// primer renderProducts() ya lo aplica.
(function () {
  const q = (new URLSearchParams(window.location.search).get('q') || '').trim().slice(0, 80);
  if (!q) return;
  searchTerm = q;
  document.getElementById('searchInput').value = q;
  document.getElementById('searchClear').style.display = 'block';
})();

// ─── WISHLIST ────────────────────────────────────────────────
// ─── WISHLIST ────────────────────────────────────────────────
let _wish = new Set(JSON.parse(__LS.getItem('cacusa-wish') || '[]').map(Number));
function _saveWish() { __LS.setItem('cacusa-wish', JSON.stringify([..._wish])); }
function _updateWishCount() {
  const n = _wish.size;
  const el = document.getElementById('wishCount');
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('vis', n > 0);
}
function _syncCardWish(id) {
  const btn = document.querySelector(`.pcard[data-id="${id}"] .pcard-wish`);
  if (!btn) return;
  const isIn = _wish.has(id);
  btn.classList.toggle('liked', isIn);
  const path = btn.querySelector('path');
  if (path) path.style.fill = isIn ? 'var(--pink)' : '';
}
function _syncModalWish() {
  if (!currentProduct) return;
  const isIn = _wish.has(currentProduct.id);
  const btn = document.getElementById('modalWishBtn');
  if (btn) {
    btn.classList.toggle('liked', isIn);
    const svgPath = btn.querySelector('path');
    if (svgPath) svgPath.style.fill = isIn ? 'var(--pink)' : 'none';
    const es = btn.querySelector('.t-es'), en = btn.querySelector('.t-en');
    if (es) es.textContent = isIn ? 'Guardado en lista ✓' : 'Guardar en lista de deseos';
    if (en) en.textContent = isIn ? 'Saved to wishlist ✓' : 'Save to wishlist';
  }
  const lbBtn = document.getElementById('lbWish');
  if (lbBtn) {
    lbBtn.classList.toggle('liked', isIn);
    const lbPath = document.getElementById('lbWishPath');
    if (lbPath) lbPath.style.fill = isIn ? 'var(--pink)' : 'none';
  }
}
function toggleWish(id, btn) {
  id = Number(id);
  if (_wish.has(id)) _wish.delete(id); else _wish.add(id);
  _saveWish(); _updateWishCount();
  const isIn = _wish.has(id);
  btn.classList.toggle('liked', isIn);
  const path = btn.querySelector('path');
  if (path) path.style.fill = isIn ? 'var(--pink)' : '';
  if (currentProduct && currentProduct.id === id) _syncModalWish();
}
function toggleWishFromModal() {
  if (!currentProduct) return;
  const id = currentProduct.id;
  if (_wish.has(id)) _wish.delete(id); else _wish.add(id);
  _saveWish(); _updateWishCount();
  _syncModalWish(); _syncCardWish(id);
}
let _wishReleaseTrap = null;
function openWishlist(sharedIds) {
  document.getElementById('wish-overlay').classList.add('open');
  document.getElementById('wish-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
  _renderWishlist(sharedIds || null);
  _wishReleaseTrap = trapFocus(document.getElementById('wish-drawer'), closeWishlist);
}
function closeWishlist() {
  document.getElementById('wish-overlay').classList.remove('open');
  document.getElementById('wish-drawer').classList.remove('open');
  document.body.style.overflow = '';
  if (_wishReleaseTrap) { _wishReleaseTrap(); _wishReleaseTrap = null; }
}
function _renderWishlist(sharedIds) {
  const ids = sharedIds ? sharedIds.map(Number) : [..._wish];
  const items = ids.map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
  const container = document.getElementById('wishItems');
  const foot = document.getElementById('wishFoot');
  let html = '';
  if (sharedIds) {
    html += `<div class="wish-shared-banner">
      <div class="wish-shared-title">◇ ${__LANG==='en'?'Gift Wishlist':'Lista de regalo'}</div>
      <div class="wish-shared-sub">${__LANG==='en'?'Add items you love to your cart!':'¡Agrega lo que te guste a tu carrito!'}</div>
    </div>`;
  }
  if (!items.length) {
    container.innerHTML = html + `<div class="wish-empty"><span class="wish-empty-icon">♡</span>${__LANG==='en'?'Your wishlist is empty.<br>Tap ♡ on any product!':'Tu lista está vacía.<br>¡Toca ♡ en cualquier producto!'}</div>`;
    foot.style.display = 'none'; return;
  }
  html += items.map(p => {
    const imgs = getProductImages(p);
    const imgEl = imgs.length
      ? `<img class="wish-item-img" src="${esc(imgs[0])}" alt="${esc(p.name)}" loading="lazy">`
      : `<div class="wish-item-img-ph" style="background:${p.grad||'var(--grad)'}"></div>`;
    const name = __LANG==='en' && p.name_en ? p.name_en : p.name;
    return `<div class="wish-item">${imgEl}
      <div class="wish-item-body">
        <div class="wish-item-name">${esc(name)}</div>
        <div class="wish-item-price">$${(+p.price).toFixed(2)}</div>
        <div class="wish-item-actions">
          <button class="wish-add" onclick="openModalFromWish(${p.id})">${__LANG==='en'?'View item':'Ver producto'}</button>
          ${!sharedIds?`<button class="wish-remove" onclick="removeFromWish(${p.id})">${__LANG==='en'?'Remove':'Quitar'}</button>`:''}
        </div>
      </div></div>`;
  }).join('');
  container.innerHTML = html;
  foot.style.display = sharedIds ? 'none' : 'block';
}
function openModalFromWish(id) { closeWishlist(); openModal(id); }
function removeFromWish(id) {
  id = Number(id); _wish.delete(id); _saveWish(); _updateWishCount();
  _syncCardWish(id); _renderWishlist(null);
}
function shareWishlist() {
  if (!_wish.size) return;
  const url = location.origin + location.pathname + '?wishlist=' + [..._wish].join(',');
  navigator.clipboard.writeText(url)
    .then(() => showToast(__LANG==='en'?'✓ Wishlist link copied!':'✓ ¡Link copiado!', 3000))
    .catch(() => prompt(__LANG==='en'?'Copy this link:':'Copia este link:', url));
}
function shareWishlistWA() {
  if (!_wish.size) return;
  const url = location.origin + location.pathname + '?wishlist=' + [..._wish].join(',');
  const msg = __LANG==='en'
    ? `✦ Here's my CACUSA jewelry wishlist!\n${url}`
    : `✦ ¡Esta es mi lista de deseos de CACUSA! Si quieres regalarme algo especial:\n${url}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg));
}
document.getElementById('wishBtn').addEventListener('click', () => openWishlist());
document.getElementById('wishClose').addEventListener('click', closeWishlist);
document.getElementById('wish-overlay').addEventListener('click', closeWishlist);
_updateWishCount();

// ─── MODAL ──────────────────────────────────────────────────
// Cicla el Tab dentro de modalEl y cierra con Escape. Devuelve una función para liberar los listeners.
// Pila de overlays abiertos: solo el de más arriba atiende Tab/Escape (antes, con el
// lightbox abierto sobre el modal, un Escape cerraba los dos).
const _trapStack = [];
function trapFocus(modalEl, onClose) {
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const _prevFocused = document.activeElement;
  const _token = {};
  _trapStack.push(_token);
  function getFocusable(){ return Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null); }
  function onKeydown(e){
    if (_trapStack[_trapStack.length - 1] !== _token) return;
    if (e.key === 'Escape'){ onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    // Si el foco quedó fuera del overlay (p. ej. no se pudo enfocar al abrir), el primer Tab lo trae adentro
    if (!modalEl.contains(document.activeElement)){ e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKeydown);
  // Foco adentro de inmediato (wave 1): antes se movía en un setTimeout(0) mientras el overlay
  // seguía en transición (visibility todavía hidden) y el foco quedaba afuera. Ahora el CSS
  // hace visible el overlay en el acto (.open → visibility sin retardo), se fuerza el cálculo de
  // estilos y se enfoca ya; si aún no se pudo, se reintenta en el próximo frame.
  function focusFirst() {
    if (modalEl.contains(document.activeElement)) return true;
    const items = getFocusable();
    if (!items.length) return false;
    const el = items[0];
    // Los controles con "transition:all" heredan la visibilidad del overlay CON su propia
    // transición y siguen "hidden" unos ms (no aceptan foco): se corta esa transición.
    const prevT = el.style.transition;
    el.style.transition = 'none';
    void el.offsetWidth;
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    el.style.transition = prevT;
    return modalEl.contains(document.activeElement);
  }
  void modalEl.offsetWidth;
  if (!focusFirst()) requestAnimationFrame(() => { if (!focusFirst()) setTimeout(focusFirst, 450); });
  return function release(){
    document.removeEventListener('keydown', onKeydown);
    const _i = _trapStack.indexOf(_token); if (_i !== -1) _trapStack.splice(_i, 1);
    // Devolver el foco a quien abrió el overlay; si no hay uno válido (p. ej. el modal que se
    // abre solo en la página estática de un producto), al h1 / main en vez de perderlo en <body>.
    const ok = _prevFocused && _prevFocused !== document.body && _prevFocused.isConnected &&
      typeof _prevFocused.focus === 'function' && _prevFocused.getClientRects().length > 0;
    if (ok) { try { _prevFocused.focus({ preventScroll: true }); } catch (_) { _prevFocused.focus(); } }
    if (!ok || document.activeElement !== _prevFocused) {
      const h = document.querySelector('main h1') || document.getElementById('main');
      if (h) {
        if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
        try { h.focus({ preventScroll: true }); } catch (_) { h.focus(); }
      }
    }
  };
}
let _modalReleaseTrap = null, _cartReleaseTrap = null, _checkoutReleaseTrap = null;
// Precio del modal (y de la barra fija del móvil): mismo formato que la tarjeta — precio
// actual, anterior tachado (2 decimales) y badge -X%.
function _renderModalPrice(p) {
  const _mLang = __LANG === 'en';
  const _origPrice = (p.isPromo && p.originalPrice) ? +p.originalPrice : (+p.oldPrice || 0);
  const _mOff = _discountPct(p);
  document.getElementById('modalPrice').innerHTML = '<span class="price-now">$' + (+p.price).toFixed(2) + '</span>' +
    (_origPrice && _origPrice > +p.price ? '<span class="price-old"><span class="sr-only">' + (_mLang ? 'Before: ' : 'Antes: ') + '</span>$' + _origPrice.toFixed(2) + '</span>' : '') +
    (_mOff > 0 ? '<span class="price-off">-' + _mOff + '%</span>' : '');
  const _barPrice = document.getElementById('modalBarPrice');
  if (_barPrice) _barPrice.textContent = '$' + (+p.price).toFixed(2);
}
function _renderModalBuyState(p) {
  const addBtn = document.getElementById('modalAddBtn');
  const soldOutTag = document.getElementById('modalSoldOut');
  if (p.available === false) {
    addBtn.textContent = __LANG === 'en' ? 'Sold out' : 'Agotado';
    addBtn.disabled = true;
    if (soldOutTag) { soldOutTag.textContent = __LANG === 'en' ? 'Sold out' : 'Agotado'; soldOutTag.style.display = 'inline-block'; }
  } else {
    addBtn.textContent = __LANG === 'en' ? 'Add to cart' : 'Añadir al carrito';
    addBtn.disabled = false;
    if (soldOutTag) soldOutTag.style.display = 'none';
  }
  addBtn.className = 'modal-add';
}
// Modal ya abierto cuando llegan recargo/stock/país: precio, disponibilidad, línea de
// Navidad y la oferta del JSON-LD (sin rehacer el schema, que ya puede traer las reseñas).
function _refreshOpenModal(p) {
  _renderModalPrice(p);
  const addBtn = document.getElementById('modalAddBtn');
  if (addBtn && (p.available === false) !== addBtn.disabled) _renderModalBuyState(p);
  _renderModalXmas(p);
  const el = document.getElementById('ld-product');
  if (!el) return;
  try {
    const s = JSON.parse(el.textContent);
    const prod = s['@graph'] ? s['@graph'].find(n => n['@type'] === 'Product') : s;
    if (!prod || !prod.offers) return;
    prod.offers.price = String(p.price);
    prod.offers.availability = p.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';
    el.textContent = JSON.stringify(s);
  } catch (_) {}
}

function openModal(id, _fromHistory) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  const _alreadyOpen = document.getElementById('modal-overlay').classList.contains('open');
  currentProduct = p; qty = 1;
  initGallery(p);
  document.getElementById('modalCat').textContent = t('cat.' + (p.cat||'').toLowerCase(), p.cat || '');
  document.getElementById('modalName').textContent = __LANG === 'en' && p.name_en ? p.name_en : p.name;
  const _mLang = __LANG === 'en';
  const _matEN = {'Baño de oro 18k':'18k gold plated','Acero inoxidable':'Stainless steel','Plata 925':'925 silver','Gold filled':'Gold filled','Baño de Rodio':'Rhodium plated','Plata 925 con un baño de oro de 18k':'925 silver with 18k gold plating'};
  _renderModalPrice(p);
  _renderModalXmas(p);
  document.getElementById('modalDesc').textContent = (_mLang && p.description_en) ? p.description_en : (p.desc || '');
  const matEl = document.getElementById('modalMat');
  if (matEl) matEl.textContent = (_mLang && p.material && _matEN[p.material]) ? _matEN[p.material] : (p.material || '');
  // Código de producto (sku, ej. AN001 — el mismo de la etiqueta QR del taller): sirve para
  // pedir una pieza puntual por WhatsApp. Se crea acá para no depender de las ~200 páginas físicas.
  let skuEl = document.getElementById('modalSku');
  if (!skuEl && matEl) {
    skuEl = document.createElement('div');
    skuEl.id = 'modalSku';
    skuEl.style.cssText = 'font-family:var(--fu);font-size:11px;letter-spacing:.08em;color:var(--ink-muted);margin:-8px 0 14px';
    matEl.insertAdjacentElement('afterend', skuEl);
  }
  if (skuEl) {
    const _sku = typeof p.sku === 'string' ? p.sku.trim() : '';
    skuEl.textContent = _sku ? (_mLang ? 'Code: ' : 'Código: ') + _sku : '';
    skuEl.hidden = !_sku;
  }
  document.getElementById('modalPersonField').style.display = p.personalized ? 'block' : 'none';
  document.getElementById('modalPersonText').value = '';
  _resetPersonUI();
  document.getElementById('qtyNum').textContent = qty;
  _renderModalBuyState(p);
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Otro producto desde "relacionados" con el modal ya abierto: arriba de todo (en el
  // celular el modal es pantalla completa) y sin apilar una segunda trampa de foco.
  const _box = document.querySelector('#modal-overlay .modal-box');
  if (_box) _box.scrollTop = 0;
  if (!_alreadyOpen || !_modalReleaseTrap) _modalReleaseTrap = trapFocus(document.getElementById('modal-overlay'), closeModal);
  if (p.hasSurcharge) {
    showToast(__LANG === 'en'
      ? 'This product has <strong>4% off</strong> when paying by Zelle or bank transfer'
      : 'Este producto tiene <strong>4% de descuento</strong> pagando por Zelle o transferencia', 3000);
  }
  _syncModalWish();
  loadProductReviews(p.id);
  setRevRating(5);
  _modalHistoryOpen(p, _fromHistory === true);
  _injectProductSchema(p);
  _renderRelatedProducts(p);
}
// UX tanda 2 (B1): abrir el modal deja una entrada propia en el historial ({modal: id}),
// así el botón Atrás del navegador/celular lo cierra en vez de sacar a la clienta de la
// tienda. _modalPushed = esa entrada la apilamos nosotros en esta visita: solo entonces
// cerrar con ✕/Escape/fondo hace history.back() (si no, se limpia ?p= con replaceState),
// para no navegar 2 veces ni dejar entradas basura hacia adelante.
// Auditoría SEO externa (20 sep), se mantiene: en la página física de ESTE MISMO producto
// (/producto/<slug>/) la URL ya es la correcta y no se le agrega ?p= redundante; un
// producto DISTINTO (ej. desde "relacionados") sí lleva ?p= para que la URL visible
// coincida con el modal que se ve.
let _modalPushed = false, _modalBackPending = false;
function _modalHistoryOpen(p, fromHistory) {
  const u = new URL(window.location.href);
  if (String(window.__CACUSA_STATIC_PRODUCT_ID) === String(p.id)) u.searchParams.delete('p');
  else u.searchParams.set('p', _productParam(p));
  const st = { modal: p.id };
  // Adelante del navegador hacia una entrada de modal: ya existe, no se apila otra.
  if (fromHistory) { _modalPushed = true; return; }
  // Recarga estando en una entrada de modal (history.state ya es {modal: id}): se reutiliza
  // esa entrada en vez de apilar otra igual, así ✕/Escape/Atrás vuelven a la entrada base.
  if (!_modalPushed && history.state && String(history.state.modal) === String(p.id)) { history.replaceState(st, '', u.toString()); _modalPushed = true; return; }
  // Cambio de producto con el modal abierto: se reemplaza la entrada, así Atrás cierra el modal.
  if (_modalPushed && history.state && history.state.modal != null) { history.replaceState(st, '', u.toString()); return; }
  // Entrada base sin ?p=: un link directo (?p=) queda como "listado + modal encima" y
  // Atrás cierra el modal dejando a la clienta en la tienda. Recargar sigue abriendo el
  // producto porque la URL visible del modal conserva ?p=.
  const base = new URL(window.location.href); base.searchParams.delete('p');
  if (base.toString() !== window.location.href) history.replaceState({}, '', base.toString());
  history.pushState(st, '', u.toString());
  _modalPushed = true;
}
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
// _fromPop === true solo cuando lo llama el popstate (Atrás ya sacó nuestra entrada);
// como listener de clic recibe un Event, que nunca es === true.
function closeModal(_fromPop) {
  const fromPop = _fromPop === true;
  const _wasOpen = document.getElementById('modal-overlay').classList.contains('open');
  if (!_wasOpen && !fromPop) return; // ya cerrado (p. ej. Escape + trampa de foco a la vez)
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  if (_modalReleaseTrap) { _modalReleaseTrap(); _modalReleaseTrap = null; }
  dismissToast();
  if (_wasOpen && typeof window._vigProductViewed === 'function') window._vigProductViewed();
  if (fromPop) { _modalPushed = false; return; }
  if (_modalPushed && history.state && history.state.modal != null) {
    // Sacamos nuestra propia entrada; el popstate que llega después actualiza el SEO del listado.
    _modalPushed = false;
    _modalBackPending = true;
    history.back();
    return;
  }
  _modalPushed = false;
  const _u = new URL(window.location.href);
  if (_u.searchParams.has('p')) { _u.searchParams.delete('p'); history.replaceState({}, '', _u.toString()); }
  _updateListingSeo();
}

// Tope de 10 unidades por línea (selector del modal y +/− del carrito)
const MAX_QTY = 10;
document.getElementById('qtyMinus').addEventListener('click', () => { if (qty > 1) { qty--; document.getElementById('qtyNum').textContent = qty; } });
document.getElementById('qtyPlus').addEventListener('click', () => { if (qty < MAX_QTY) { qty++; document.getElementById('qtyNum').textContent = qty; } });

document.getElementById('modalAddBtn').addEventListener('click', () => {
  if (!currentProduct || currentProduct.available === false) return;
  // Recorta a 20 caracteres como respaldo del maxlength del input (y vuelve a sanear: el
  // texto del input ya viene filtrado, esto solo cubre un pegado que se haya colado)
  const personText = _sanitizePersonText(document.getElementById('modalPersonText').value).clean.trim().slice(0, PERSON_MAX);
  const material = currentProduct.material || '';
  const existingLine = cart.find(it => !it.isCombo && it.id === currentProduct.id && (it.personalization || '') === personText && (it.material || '') === material);
  if (existingLine) {
    if ((existingLine.qty || 1) + qty > MAX_QTY) showToast(__LANG === 'en' ? 'Max ' + MAX_QTY + ' per item' : 'Máximo ' + MAX_QTY + ' unidades por pieza', 3500);
    existingLine.qty = Math.min(MAX_QTY, (existingLine.qty || 1) + qty);
  } else {
    cart.push({ ...currentProduct, personalization: personText, material, cartId: Date.now(), qty });
  }
  saveCart(); updateCartUI();
  const btn = document.getElementById('modalAddBtn');
  btn.textContent = __LANG === 'en' ? '✓ Added' : '✓ Añadido';
  btn.classList.add('added');
  setTimeout(() => { closeModal(); openCart(); }, 800);
});

// ─── M4: PERSONALIZACIÓN GUIADA (modal de producto) ─────────
// Contador en vivo, filtro de caracteres y link a WhatsApp con el texto ya escrito. El precio
// de personalizar NUNCA se muestra en la web: se cotiza por WhatsApp (5–10 días hábiles).
// Todo con chequeo de null: las páginas físicas por producto son copias de la plantilla y
// pueden tener el HTML anterior hasta que el workflow las regenere.
const PERSON_MAX = 20;
// Permitido: letras latinas (con tildes y ñ), dígitos, espacio y . , & - ' ♡ ✦
const _PERSON_BAD_G = /[^\p{Script=Latin}0-9 .,&'\-\u2661\u2726]/gu;
const _PERSON_BAD = /[^\p{Script=Latin}0-9 .,&'\-\u2661\u2726]/u;
function _sanitizePersonText(raw) {
  const norm = String(raw || '').normalize('NFC')
    .replace(/[\u2018\u2019\u02BC\u00B4`]/g, "'")   // apóstrofo "inteligente" del celular
    .replace(/[\uFE0E\uFE0F]/g, '');                 // selector de variante tras ♡/✦
  const rejected = _PERSON_BAD.test(norm);
  const clean = norm.replace(_PERSON_BAD_G, '').replace(/ {2,}/g, ' ').replace(/^ +/, '');
  return { clean, rejected };
}
function _personWaText(text) {
  const p = currentProduct;
  const name = p ? ((__LANG === 'en' && p.name_en) ? p.name_en : p.name) : '';
  const txt = String(text || '').trim();
  if (__LANG === 'en') return 'Hi, I\'d like to personalize: ' + name + '.' + (txt ? ' Text: "' + txt + '".' : '') + ' What would the price be?';
  return 'Hola, quiero personalizar: ' + name + '.' + (txt ? ' Texto: "' + txt + '".' : '') + ' ¿Cuál sería el precio?';
}
function _updatePersonUI() {
  const inp = document.getElementById('modalPersonText');
  if (!inp) return;
  const count = document.getElementById('modalPersonCount');
  if (count) count.textContent = inp.value.length + '/' + PERSON_MAX;
  const wa = document.getElementById('modalPersonWa');
  if (wa) wa.href = _waLink(_personWaText(inp.value));
}
let _personErrT = null;
function _resetPersonUI() {
  const err = document.getElementById('modalPersonErr');
  clearTimeout(_personErrT);
  if (err) err.textContent = '';
  _updatePersonUI();
}
(() => {
  const inp = document.getElementById('modalPersonText');
  if (!inp) return;
  inp.addEventListener('input', () => {
    const before = inp.value;
    const { clean, rejected } = _sanitizePersonText(before);
    const next = clean.slice(0, PERSON_MAX);
    if (next !== before) {
      const caret = Math.max(0, (inp.selectionStart != null ? inp.selectionStart : before.length) - (before.length - next.length));
      inp.value = next;
      try { inp.setSelectionRange(caret, caret); } catch (_) {}
    }
    const err = document.getElementById('modalPersonErr');
    // El aviso se queda unos segundos (no se borra con la siguiente tecla válida),
    // para que en el celular se entienda por qué desapareció un carácter.
    if (err && rejected) {
      err.textContent = __LANG === 'en'
        ? 'Only letters, numbers, spaces and . , & - \' ♡ ✦'
        : 'Solo letras, números, espacios y . , & - \' ♡ ✦';
      clearTimeout(_personErrT);
      _personErrT = setTimeout(() => { err.textContent = ''; }, 4000);
    }
    _updatePersonUI();
  });
  // Al salir del campo: sin espacios al final
  inp.addEventListener('blur', () => { const v = inp.value.replace(/ +$/, ''); if (v !== inp.value) { inp.value = v; _updatePersonUI(); } });
})();

// ─── CART ───────────────────────────────────────────────────
// Email del lead de carrito abandonado que se registró en ESTA sesión (si se registró
// alguno) — lo pone registerLead() cuando el carrito llega al checkout, y saveCart() lo
// usa para saber a quién avisarle si el carrito termina vacío sin haber comprado.
let _abandonLeadEmail = null;
// Email con carrito pendiente guardado para el recordatorio por correo (ver /cart/pending
// más abajo): si el carrito queda vacío, también se cancela.
let _pendingCartEmail = null;
function saveCart() {
  __LS.setItem('cacusa-cart', JSON.stringify(cart));
  if (cart.length === 0 && _pendingCartEmail && _pendingCartEmail !== _abandonLeadEmail) {
    const email = _pendingCartEmail;
    _pendingCartEmail = null;
    fetch(ADMIN_WORKER_URL + '/lead/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {});
  } else if (cart.length === 0) _pendingCartEmail = null;
  // El carrito quedó en cero sin pasar por un pedido (esos casos limpian el lead solos,
  // del lado del servidor, al crear el pedido) — avisar para que deje de figurar como
  // "carrito abandonado" en el panel. Best-effort, no bloquea nada si falla.
  if (cart.length === 0 && _abandonLeadEmail) {
    const email = _abandonLeadEmail;
    _abandonLeadEmail = null;
    fetch(ADMIN_WORKER_URL + '/lead/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {});
  }
}
// square-payment-worker.js valida/factura un item por unidad (sin campo qty) — al agrupar
// cantidades en una sola línea del carrito, hay que expandirlas de vuelta antes de mandarlas
// a Square para no subcobrar (ej. qty:3 en una línea → 3 items separados, como antes).
function expandCartForOrder(c) {
  const out = [];
  c.forEach(item => {
    const { qty, ...rest } = item;
    const n = qty || 1;
    for (let i = 0; i < n; i++) out.push({ ...rest, cartId: item.cartId + '_' + i });
  });
  return out;
}
function openCart() {
  document.getElementById('cart-overlay').classList.add('open');
  document.getElementById('cart-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
  updateCartUI();
  _cartReleaseTrap = trapFocus(document.getElementById('cart-drawer'), closeCart);
}
function closeCart() {
  document.getElementById('cart-overlay').classList.remove('open');
  document.getElementById('cart-drawer').classList.remove('open');
  document.body.style.overflow = '';
  if (_cartReleaseTrap) { _cartReleaseTrap(); _cartReleaseTrap = null; }
}
document.getElementById('cartBtn').addEventListener('click', openCart);
document.getElementById('cartClose').addEventListener('click', closeCart);
document.getElementById('cart-overlay').addEventListener('click', closeCart);

function updateCartUI() {
  const count = cart.reduce((s, i) => s + (i.qty || 1), 0);
  document.getElementById('cartCount').textContent = count;
  const total = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const itemsEl = document.getElementById('cartItems');
  const footEl = document.getElementById('cartFoot');
  if (count === 0) {
    itemsEl.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon" aria-hidden="true">✦</span><div class="cart-empty-text">' + t('store.cartEmpty', 'Tu carrito está vacío') + '</div>' +
      '<button type="button" class="cart-empty-cta" onclick="_cartExploreStore()">' + (__LANG === 'en' ? 'Explore the store' : 'Explorar la tienda') + '</button></div>' +
      _cartEmptySuggestHtml();
    footEl.style.display = 'none';
  } else {
    itemsEl.innerHTML = cart.map((item, i) => `
      <div class="cart-item">
        <div class="ci-img" style="${imgBgStyle(item)}">${imgInner(item, item.name)}</div>
        <div class="ci-body">
          <div class="ci-name">${esc(__LANG === 'en' && item.name_en ? item.name_en : item.name)}</div>
          ${_cartItemSoldOut(item) ? `<div class="ci-soldout" role="note" style="color:#B42318;font-size:12px;font-weight:700;margin:2px 0">${__LANG === 'en' ? 'Sold out · remove it to continue' : 'Agotado · quítalo para continuar'}</div>` : ''}
          ${item.personalization ? `<div class="ci-custom">"${esc(item.personalization)}"</div>` : ''}
          ${item.material ? `<div class="ci-mat">${esc((()=>{const _cEN={'Baño de oro 18k':'18k gold plated','Acero inoxidable':'Stainless steel','Plata 925':'925 silver','Gold filled':'Gold filled','Baño de Rodio':'Rhodium plated','Plata 925 con un baño de oro de 18k':'925 silver with 18k gold plating'};const _m=item.material;return __LANG==='en'?(_cEN[_m]||_m):_m;})())}</div>` : ''}
          <div class="ci-foot">
            <span class="ci-price">$${(item.price * (item.qty || 1)).toFixed(2)}</span>
            <div class="ci-qty">
              <button class="ci-qty-btn" onclick="changeQty(${item.cartId}, -1)" aria-label="${__LANG === 'en' ? 'Decrease quantity' : 'Restar cantidad'}">−</button>
              <span class="ci-qty-num">${item.qty || 1}</span>
              <button class="ci-qty-btn" onclick="changeQty(${item.cartId}, 1)" aria-label="${__LANG === 'en' ? 'Increase quantity' : 'Sumar cantidad'}"${(item.qty || 1) >= MAX_QTY || _cartItemSoldOut(item) ? ' disabled' : ''}>+</button>
            </div>
            <button class="ci-remove" onclick="removeItem(${item.cartId})" aria-label="${__LANG === 'en' ? 'Remove from cart' : 'Quitar del carrito'}">✕</button>
          </div>
        </div>
      </div>`).join('');
    document.getElementById('cartTotal').textContent = '$' + total.toFixed(2);
    // Barra de progreso hacia el envío gratis (umbral de config.shipping.freeThreshold).
    // Zelle/transferencia decide el envío gratis con el subtotal sin recargo de tarjeta
    // (basePrice) — solo se promete "envío gratis" sin matices si llega con los 2 subtotales.
    const baseTotal = cart.reduce((s, i) => s + (i.hasSurcharge && i.basePrice != null ? i.basePrice : i.price) * (i.qty || 1), 0);
    const free = _cpIsFreeShip() || baseTotal >= SHIPPING.freeThreshold;
    const freeCard = free || total >= SHIPPING.freeThreshold;
    const remaining = Math.max(0, SHIPPING.freeThreshold - baseTotal);
    document.getElementById('cartShipping').textContent = free
      ? (__LANG === 'en' ? '✓ You have free shipping' : '✓ Tienes envío gratis')
      : freeCard
        ? (__LANG === 'en' ? '✓ Free shipping when paying by card' : '✓ Envío gratis pagando con tarjeta')
        : _freeShipMissingText(remaining);
    const fill = document.getElementById('cartShipFill');
    if (fill) fill.style.width = (freeCard || SHIPPING.freeThreshold <= 0 ? 100 : Math.min(100, baseTotal / SHIPPING.freeThreshold * 100)) + '%';
    if (!freeCard) itemsEl.insertAdjacentHTML('beforeend', _cartSuggestHtml(remaining));
    itemsEl.insertAdjacentHTML('beforeend', _cartSimilarHtml(freeCard ? [] : _cartSuggestions(remaining).map(p => p.id)));
    footEl.style.display = 'block';
  }
}
function _freeShipMissingText(remaining) {
  return __LANG === 'en'
    ? 'You are $' + remaining.toFixed(2) + ' away from free shipping'
    : 'Te faltan $' + remaining.toFixed(2) + ' para el envío gratis';
}
// Sugerencias del carrito: 2–3 productos en stock de categorías que no están en el
// carrito, empezando por los más baratos que por sí solos alcanzan el envío gratis (si no
// alcanzan, los que más se acercan). Solo abren el producto — nunca se agregan solos.
function _cartSuggestions(remaining) {
  const inCart = new Set(cart.map(i => String(i.id)));
  const cats = new Set(cart.map(i => i.cat).filter(Boolean));
  const pool = PRODUCTS.filter(p => p.available !== false && +p.price > 0 && !inCart.has(String(p.id)) && !cats.has(p.cat));
  const reach = pool.filter(p => p.price >= remaining).sort((a, b) => a.price - b.price);
  const below = pool.filter(p => p.price < remaining).sort((a, b) => b.price - a.price);
  const out = [], usedCats = new Set();
  for (const p of [...reach, ...below]) {
    if (usedCats.has(p.cat)) continue;
    usedCats.add(p.cat); out.push(p);
    if (out.length === 3) break;
  }
  return out.length >= 2 ? out : [];
}
function _cartSuggestHtml(remaining) {
  const list = _cartSuggestions(remaining);
  if (!list.length) return '';
  return '<div class="cart-suggest"><div class="cs-title">' + (__LANG === 'en' ? 'Complete your free shipping with' : 'Completa tu envío gratis con') + '</div><div class="cs-list">' +
    list.map(p => {
      const nm = __LANG === 'en' && p.name_en ? p.name_en : p.name;
      return `<a class="cs-item" href="${_pcardHref(p)}" onclick="return _cartSuggestNav(event, ${p.id})"><div class="cs-img" style="${imgBgStyle(p)}">${imgInner(p, p.name)}</div><div class="cs-name">${esc(nm)}</div><div class="cs-price">$${(+p.price).toFixed(2)}</div></a>`;
    }).join('') + '</div></div>';
}
// Carrito vacío: hasta 4 productos (Bestseller, después Nuevo, en stock) como tarjetitas
// que abren el producto — mismo marcado y navegación que las sugerencias de envío gratis.
function _cartEmptySuggestHtml() {
  const list = _featuredProducts(4);
  if (!list.length) return '';
  return '<div class="cart-suggest cart-suggest--empty"><div class="cs-title">' + (__LANG === 'en' ? 'You might like' : 'Quizás te guste') + '</div><div class="cs-list">' +
    list.map(p => {
      const nm = __LANG === 'en' && p.name_en ? p.name_en : p.name;
      return `<a class="cs-item" href="${_pcardHref(p)}" onclick="return _cartSuggestNav(event, ${p.id})"><div class="cs-img" style="${imgBgStyle(p)}">${imgInner(p, p.name)}</div><div class="cs-name">${esc(nm)}</div><div class="cs-price">$${(+p.price).toFixed(2)}</div></a>`;
    }).join('') + '</div></div>';
}
// "Explorar la tienda": cierra el carrito y baja hasta los filtros del catálogo.
function _cartExploreStore() {
  closeCart();
  const target = document.querySelector('.filters') || document.getElementById('prodGrid');
  if (!target) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const navEl = document.querySelector('nav');
  const y = target.getBoundingClientRect().top + window.scrollY - (navEl ? navEl.offsetHeight : 0);
  window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
}
function _cartSuggestNav(e, id) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return true;
  e.preventDefault();
  closeCart();
  openModal(id);
  return false;
}
function removeItem(cartId) { cart = cart.filter(i => i.cartId !== cartId); saveCart(); updateCartUI(); }
function changeQty(cartId, delta) {
  const item = cart.find(i => i.cartId === cartId);
  if (!item) return;
  if (delta > 0 && _cartItemSoldOut(item)) return; // agotado: solo se puede bajar o quitar
  const next = (item.qty || 1) + delta;
  if (next <= 0) { removeItem(cartId); return; }
  if (next > MAX_QTY) return;
  item.qty = next;
  saveCart(); updateCartUI();
}

// Estado/ZIP solo para EE.UU. — también al cargar (el país por defecto es Ecuador en la
// tienda ES y EE.UU. en la EN).
function _syncCountryFields() {
  const isUS = document.getElementById('coPais').value === 'US';
  document.getElementById('coEstadoWrap').style.display = isUS ? 'block' : 'none';
  document.getElementById('coZipWrap').style.display    = isUS ? 'block' : 'none';
  // Ejemplos de dirección: estilo EE.UU. para US (y siempre en la tienda en inglés);
  // estilo Ecuador/Latam en español para cualquier otro país.
  const usStyle = isUS || __LANG === 'en';
  document.getElementById('coDireccion').placeholder = usStyle ? '123 Main St…' : 'Av. Amazonas N34-120 y Juan Pablo II…';
  document.getElementById('coApto').placeholder      = usStyle ? 'Apt 4B, Suite 200…' : 'Depto 3B, edificio, referencia…';
}
_syncCountryFields();
document.getElementById('coPais').addEventListener('change', function() {
  _syncCountryFields();
  document.getElementById('coEstado').value = '';
  document.getElementById('coZip').value    = '';
  renderCheckoutSummary();
});

// ─── AUTOCOMPLETE DIRECCIÓN (Photon / OpenStreetMap) ─────────────────────────
(function initAddrAutocomplete() {
  const inp  = document.getElementById('coDireccion');
  const list = document.getElementById('addrSuggestions');
  if (!inp || !list) return;
  let _timer = null;
  let _items = [];

  function matchState(stateName) {
    if (!stateName) return '';
    const s = stateName.toLowerCase();
    for (const opt of document.getElementById('coEstado').options) {
      if (opt.value && opt.text.toLowerCase().startsWith(s)) return opt.value;
    }
    return '';
  }

  // Combobox accesible (wave 1): el input lleva role="combobox" + aria-expanded y las
  // sugerencias son role="option"; la opción activa se anuncia con aria-activedescendant.
  // El input conserva autocomplete="shipping address-line1": el autocompletado del navegador
  // y las sugerencias de Photon conviven (la clienta elige cualquiera de los dos).
  function closeList() {
    list.classList.remove('open'); list.innerHTML = ''; _items = [];
    inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant');
  }
  function setActive(el) {
    list.querySelectorAll('.addr-sugg-item').forEach(x => { x.classList.remove('focused'); x.setAttribute('aria-selected', 'false'); });
    if (!el) { inp.removeAttribute('aria-activedescendant'); return; }
    el.classList.add('focused'); el.setAttribute('aria-selected', 'true');
    inp.setAttribute('aria-activedescendant', el.id);
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function fillFromFeature(f) {
    const p = f.properties;
    const num    = p.housenumber || '';
    const street = p.street || '';
    // If Photon gives us housenumber+street use those; otherwise use name as full street line
    inp.value = street ? (num ? num + ' ' : '') + street : (p.name || '');
    if (p.city)     document.getElementById('coCiudad').value = p.city;
    // Photon uses "countrycode" (no underscore), two-letter lowercase
    const cc = (p.countrycode || '').toUpperCase();
    const paisSel = document.getElementById('coPais');
    if (['US','EC','CO','PE','MX'].includes(cc)) paisSel.value = cc;
    const isUS = paisSel.value === 'US';
    document.getElementById('coEstadoWrap').style.display = isUS ? 'block' : 'none';
    document.getElementById('coZipWrap').style.display    = isUS ? 'block' : 'none';
    if (isUS && p.state) {
      const abbr = matchState(p.state);
      if (abbr) document.getElementById('coEstado').value = abbr;
    }
    if (isUS && p.postcode) document.getElementById('coZip').value = p.postcode.substring(0, 5);
    closeList();
    renderCheckoutSummary();
  }

  inp.addEventListener('input', function() {
    clearTimeout(_timer);
    const q = this.value.trim();
    if (q.length < 3) { closeList(); return; }
    _timer = setTimeout(async () => {
      try {
        const res  = await fetchT('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=6&lang=en', undefined, 5000);
        const data = await res.json();
        // Accept any result that has at least a street OR a city — broad enough for all address formats
        const features = (data.features || []).filter(f => {
          const p = f.properties;
          return p && (p.street || p.housenumber || (p.city && p.name));
        });
        if (!features.length) { closeList(); return; }
        _items = features;
        list.innerHTML = features.map((f, i) => {
          const p = f.properties;
          const num    = p.housenumber || '';
          const street = p.street || '';
          const main   = street ? (num ? num + ' ' : '') + street : (p.name || '');
          const sub    = [p.city, p.state, p.country].filter(Boolean).join(', ');
          return '<div class="addr-sugg-item" role="option" aria-selected="false" id="addrOpt' + i + '" data-idx="' + i + '">'
               + '<div class="addr-sugg-main">' + esc(main) + '</div>'
               + (sub ? '<div class="addr-sugg-sub">' + esc(sub) + '</div>' : '')
               + '</div>';
        }).join('');
        list.classList.add('open');
        inp.setAttribute('aria-expanded', 'true');
      } catch(e) { closeList(); }
    }, 380);
  });

  list.addEventListener('click', function(e) {
    const item = e.target.closest('.addr-sugg-item');
    if (!item) return;
    fillFromFeature(_items[+item.dataset.idx]);
  });

  // Keyboard nav
  inp.addEventListener('keydown', function(e) {
    const items = list.querySelectorAll('.addr-sugg-item');
    if (!items.length) return;
    const focused = list.querySelector('.focused');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(focused ? (focused.nextElementSibling || items[0]) : items[0]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(focused ? (focused.previousElementSibling || items[items.length - 1]) : items[items.length - 1]);
    } else if (e.key === 'Enter' && focused) {
      e.preventDefault();
      fillFromFeature(_items[+focused.dataset.idx]);
    } else if (e.key === 'Escape') {
      // Cierra solo la lista, no el checkout (la trampa de foco también escucha Escape).
      e.stopPropagation();
      closeList();
    }
  });

  document.addEventListener('click', function(e) {
    if (!inp.contains(e.target) && !list.contains(e.target)) closeList();
  });
})();
document.getElementById('coEstado').addEventListener('change', renderCheckoutSummary);
document.getElementById('coZip').addEventListener('input', renderCheckoutSummary);

document.getElementById('checkoutBtn').addEventListener('click', () => { closeCart(); openCheckout(); });
document.getElementById('checkoutBack').addEventListener('click', () => { closeCheckout(); openCart(); });

// ─── CHECKOUT ───────────────────────────────────────────────
// "¿Tienes un código?": cupón y tarjeta de regalo plegados por defecto (menos ruido para
// quien no tiene código); se abren solos si ya hay un código aplicado o escrito.
function _setCoCodesOpen(open) {
  const btn = document.getElementById('coCodesToggle'), panel = document.getElementById('coCodesPanel');
  if (!btn || !panel) return;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
}
(function () {
  const btn = document.getElementById('coCodesToggle');
  if (btn) btn.addEventListener('click', () => {
    const panel = document.getElementById('coCodesPanel');
    const open = !!(panel && panel.hidden);
    _setCoCodesOpen(open);
    if (open) { const first = document.getElementById('gcCodeInput'); if (first) first.focus(); }
  });
})();
function openCheckout() {
  // Inventario (18 nov): no se puede pagar un carrito con piezas agotadas.
  if (cart.some(_cartItemSoldOut)) {
    showToast(__LANG === 'en' ? 'Some pieces in your cart are sold out. Remove them to continue.' : 'Hay piezas agotadas en tu carrito. Quítalas para continuar.', 4500);
    updateCartUI(); openCart(); // el botón Pagar cierra el carrito antes: se vuelve a abrir
    return;
  }
  document.getElementById('checkout-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  coGoStep1();
  const _typed = (document.getElementById('gcCodeInput').value || '').trim() || (document.getElementById('cpCodeInput').value || '').trim();
  _setCoCodesOpen(!!(_gcCode || _cpCode || _typed));
  const helpWa = document.getElementById('coHelpWa');
  if (helpWa) helpWa.href = _waLink(__LANG === 'en' ? 'Hi! I need help with my order' : '¡Hola! Necesito ayuda con mi pedido');
  renderCheckoutSummary();
  _checkoutReleaseTrap = trapFocus(document.getElementById('checkout-overlay'), closeCheckout);
}
function closeCheckout() {
  document.getElementById('checkout-overlay').classList.remove('open');
  document.body.style.overflow = '';
  document.querySelectorAll('.co-input').forEach(el => el.style.borderColor = '');
  const errorEl = document.getElementById('coError');
  if (errorEl) errorEl.textContent = '';
  const errorEl1 = document.getElementById('coErrorStep1');
  if (errorEl1) errorEl1.textContent = '';
  _clearCoInlineErrs();
  if (_checkoutReleaseTrap) { _checkoutReleaseTrap(); _checkoutReleaseTrap = null; }
}
document.getElementById('checkout-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('checkout-overlay')) closeCheckout();
});

// ─── ESCAPE KEY ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('success-overlay').classList.contains('open')) return;
  if (document.getElementById('lightbox').classList.contains('open')) return; // lo cierra su propia trampa de foco
  if (document.getElementById('checkout-overlay').classList.contains('open')) { closeCheckout(); return; }
  if (document.getElementById('modal-overlay').classList.contains('open')) { closeModal(); return; }
  if (document.getElementById('cart-drawer').classList.contains('open')) { closeCart(); return; }
});

function renderCheckoutSummary() {
  const payMethod   = (document.querySelector('.pay-method-opt.selected') || {}).dataset?.method || 'square';
  const isZelle     = payMethod === 'zelle';
  const subtotal    = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);

  // Zelle discount: remove the 4% surcharge from eligible items
  let zelleDiscount = 0;
  if (isZelle) {
    cart.forEach(item => {
      if (item.hasSurcharge && item.basePrice != null) {
        zelleDiscount += Math.round((item.price - item.basePrice) * (item.qty || 1) * 100) / 100;
      }
    });
  }
  const adjustedSubtotal = subtotal - zelleDiscount;

  const free       = _cpIsFreeShip() || adjustedSubtotal >= SHIPPING.freeThreshold;
  const shippingCost = free ? 0 : SHIPPING.cost;
  const pais       = (document.getElementById('coPais').value || '').toUpperCase();
  const estado     = (document.getElementById('coEstado').value || '').toUpperCase();

  // Calcular impuesto
  let taxAmt = 0, taxLabel = t('store.tax', 'Impuesto');
  if (pais === 'EC') {
    taxAmt   = (adjustedSubtotal + shippingCost) * 0.15;
    taxLabel = t('store.taxEc', 'IVA Ecuador (15%)');
  } else if (pais === 'US' && estado) {
    const zip  = (document.getElementById('coZip').value || '').trim();
    const rate = getTaxRate(estado, zip);
    if (rate) {
      taxAmt   = (adjustedSubtotal + shippingCost) * rate;
      const pct = (rate * 100).toFixed(2).replace(/\.?0+$/, '');
      taxLabel  = `Sales Tax ${estado} (${pct}%)`;
    }
  }

  const totalFinal = adjustedSubtotal + shippingCost + taxAmt;
  _gcApplied = (_gcCode && _gcBalance > 0) ? parseFloat(Math.min(_gcBalance, totalFinal).toFixed(2)) : 0;
  const afterGc = totalFinal - _gcApplied;
  if (_cpCode && _cpType) {
    _cpDiscount = _cpIsFreeShip() ? 0
      : _cpType === 'percent'
      ? parseFloat((afterGc * _cpAmount / 100).toFixed(2))
      : parseFloat(Math.min(_cpAmount, afterGc).toFixed(2));
  } else {
    _cpDiscount = 0;
  }
  const grandTotal = parseFloat((afterGc - _cpDiscount).toFixed(2));

  document.getElementById('coSubtotal').textContent = '$' + subtotal.toFixed(2);
  document.getElementById('coEnvio').textContent    = free ? t('store.coFree', 'Gratis') : '$' + shippingCost.toFixed(2);
  const shipHint = document.getElementById('coShipHint');
  if (shipHint) shipHint.textContent = free ? '' : _freeShipMissingText(Math.max(0, SHIPPING.freeThreshold - adjustedSubtotal));
  const taxLine = document.getElementById('coTaxLine');
  if (taxAmt > 0) {
    taxLine.style.display = '';
    document.getElementById('coTaxLabel').textContent   = taxLabel;
    document.getElementById('coImpuesto').textContent   = '$' + taxAmt.toFixed(2);
  } else {
    taxLine.style.display = 'none';
  }
  // El "-4%" de Zelle solo existe si algún producto del carrito trae el recargo con tarjeta
  // (/pub/surcharges del Worker). Sin recargo, Zelle y tarjeta cuestan lo mismo y no se promete.
  const _anySurcharge = cart.some(i => i.hasSurcharge && i.basePrice != null && i.price > i.basePrice);
  document.querySelectorAll('.zelle-disc-badge').forEach(el => { el.hidden = !_anySurcharge; });
  const zelleRow = document.getElementById('coZelleRow');
  if (zelleDiscount > 0) {
    zelleRow.style.display = '';
    document.getElementById('coZelleAmt').textContent = '-$' + zelleDiscount.toFixed(2);
  } else {
    zelleRow.style.display = 'none';
  }
  const gcRow = document.getElementById('coGcRow');
  if (_gcApplied > 0) {
    gcRow.style.display = '';
    document.getElementById('coGcAmt').textContent   = _gcApplied.toFixed(2);
    document.getElementById('coGcCode').textContent  = _gcCode;
  } else {
    gcRow.style.display = 'none';
  }
  const cpRow = document.getElementById('coCpRow');
  if (_cpDiscount > 0) {
    cpRow.style.display = '';
    document.getElementById('coCpAmt').textContent  = _cpDiscount.toFixed(2);
    document.getElementById('coCpCode').textContent = _cpCode;
  } else {
    cpRow.style.display = 'none';
  }
  document.getElementById('coTotal').textContent = '$' + grandTotal.toFixed(2);
  const coTotalMobile = document.getElementById('coTotalMobile');
  if (coTotalMobile) coTotalMobile.textContent = '$' + grandTotal.toFixed(2);
  document.getElementById('coSummaryItems').innerHTML = cart.map(item => `
    <div class="co-sum-item">
      <div class="co-si-img" style="${imgBgStyle(item)}">
        ${imgInner(item, item.name)}
        <div class="co-si-qty">${item.qty || 1}</div>
      </div>
      <div>
        <div class="co-si-name">${esc(__LANG === 'en' && item.name_en ? item.name_en : item.name)}</div>
        ${item.personalization ? `<div class="co-si-custom">"${esc(item.personalization)}"</div>` : ''}
      </div>
      <div class="co-si-price">$${(item.price * (item.qty || 1)).toFixed(2)}</div>
    </div>`).join('');
}

// ─── PAYMENT METHOD SELECTOR ─────────────────────────────────
function payMethodKeydown(e, el) {
  const opts = [...el.parentElement.querySelectorAll('.pay-method-opt')];
  const i = opts.indexOf(el);
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPayMethod(el); return; }
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
    const next = opts[(i + dir + opts.length) % opts.length];
    next.focus();
    selectPayMethod(next);
  }
}
function selectPayMethod(el) {
  document.querySelectorAll('.pay-method-opt').forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); b.tabIndex = -1; });
  el.classList.add('selected');
  el.setAttribute('aria-checked', 'true');
  el.tabIndex = 0;
  const isZelle = el.dataset.method === 'zelle';
  document.getElementById('payBtn').style.display        = isZelle ? 'none' : '';
  document.getElementById('zelleBtn').classList.toggle('show', isZelle);
  const sqNote = document.getElementById('squareNote');
  if (sqNote) sqNote.style.display = isZelle ? 'none' : '';
  const payBadges = document.getElementById('payBadges');
  if (payBadges) payBadges.style.display = isZelle ? 'none' : '';
  const zelleTrustNote = document.getElementById('zelleTrustNote');
  if (zelleTrustNote) zelleTrustNote.style.display = isZelle ? '' : 'none';
  renderCheckoutSummary();
}

function isValidPhone(tel) {
  const digits = tel.replace(/[\s\-\(\)\+\.]/g, '');
  return /^\d{7,15}$/.test(digits);
}
// Resalta el/los campo(s) inválidos del checkout con borde rojo y foco, además del mensaje de error genérico
function _markCoFieldError(ids, errorEl, msg) {
  document.querySelectorAll('.co-input').forEach(el => { el.style.borderColor = ''; el.removeAttribute('aria-invalid'); });
  _clearCoInlineErrs();
  let first = null;
  (Array.isArray(ids) ? ids : [ids]).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.borderColor = '#C0336E'; el.setAttribute('aria-invalid', 'true'); if (!first) first = el; }
  });
  if (first) first.focus();
  if (errorEl) errorEl.textContent = msg;
}

// Error en línea debajo de un campo (#<id>Err, enlazado con aria-describedby en el HTML).
function _setCoInlineErr(id, msg) { const el = document.getElementById(id + 'Err'); if (el) el.textContent = msg; }
function _clearCoInlineErrs() { document.querySelectorAll('.co-field-err').forEach(el => { el.textContent = ''; }); }
// Al corregir un campo marcado, se le quita el borde rojo y su error en línea.
['coDireccion', 'coCiudad'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => {
    if (!el.value.trim()) return;
    el.style.borderColor = ''; el.removeAttribute('aria-invalid'); _setCoInlineErr(id, '');
  });
});

// ─── CHECKOUT EN 2 PASOS ─────────────────────────────────────
function _coMarkStep(n) {
  [1, 2].forEach(i => {
    const d = document.getElementById('coDot' + i);
    if (!d) return;
    d.classList.toggle('act', i === n);
    d.classList.toggle('done', i < n);
    if (i === n) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
  });
}
function coGoStep2() {
  const errorEl = document.getElementById('coErrorStep1');
  const nombre  = document.getElementById('coNombre').value.trim();
  const tel     = document.getElementById('coTel').value.trim();
  const pais    = document.getElementById('coPais').value;
  if (!nombre || !tel) {
    _markCoFieldError([!nombre && 'coNombre', !tel && 'coTel'].filter(Boolean), errorEl, t('store.coError1', 'Por favor ingresa tu nombre y número móvil.'));
    return;
  }
  if (!isValidPhone(tel)) {
    _markCoFieldError('coTel', errorEl, t('store.coError3', 'Por favor ingresa un número de teléfono válido.'));
    return;
  }
  // UX tanda 2: dirección y ciudad obligatorias para todos los países (sin ellas no hay a dónde enviar).
  const _missingAddr = [
    !document.getElementById('coDireccion').value.trim() && 'coDireccion',
    !document.getElementById('coCiudad').value.trim() && 'coCiudad'
  ].filter(Boolean);
  if (_missingAddr.length) {
    const _en = __LANG === 'en';
    _markCoFieldError(_missingAddr, errorEl, _missingAddr.length === 2
      ? (_en ? 'Please enter your address and city.' : 'Por favor ingresa tu dirección y ciudad.')
      : _missingAddr[0] === 'coDireccion'
        ? (_en ? 'Please enter your address.' : 'Por favor ingresa tu dirección.')
        : (_en ? 'Please enter your city.' : 'Por favor ingresa tu ciudad.'));
    if (_missingAddr.includes('coDireccion')) _setCoInlineErr('coDireccion', _en ? 'Enter your street address so we can ship your order.' : 'Escribe tu dirección para poder enviarte el pedido.');
    if (_missingAddr.includes('coCiudad')) _setCoInlineErr('coCiudad', _en ? 'Enter your city.' : 'Escribe tu ciudad.');
    return;
  }
  if (pais === 'US') {
    const estado = document.getElementById('coEstado').value;
    const zip     = document.getElementById('coZip').value.trim();
    if (!estado) { _markCoFieldError('coEstado', errorEl, t('store.coError2', 'Por favor selecciona tu estado.')); return; }
    if (!/^\d{5}$/.test(zip)) { _markCoFieldError('coZip', errorEl, t('store.coErrorZip', 'Por favor ingresa un código postal válido (5 dígitos).')); return; }
  }
  errorEl.textContent = '';
  _clearCoInlineErrs();
  document.getElementById('coStep1').classList.remove('active');
  document.getElementById('coStep2').classList.add('active');
  _coMarkStep(2);
  _coScrollTop();
}
function coGoStep1() {
  document.getElementById('coStep2').classList.remove('active');
  document.getElementById('coStep1').classList.add('active');
  _coMarkStep(1);
  _coScrollTop();
}
// Al cambiar de paso, el checkout vuelve arriba (antes el paso 2 abría a mitad de página,
// directo en el botón de pagar, sin ver el método de pago ni los códigos).
function _coScrollTop() {
  const box = document.querySelector('#checkout-overlay .checkout-box');
  if (box) box.scrollTop = 0;
  const ov = document.getElementById('checkout-overlay');
  if (ov) ov.scrollTop = 0;
}
document.getElementById('coNextBtn').addEventListener('click', coGoStep2);
document.getElementById('coBackStepBtn').addEventListener('click', coGoStep1);

// ─── ZELLE / TRANSFERENCIA BUTTON ────────────────────────────
document.getElementById('zelleBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('coError');
  const nombre  = document.getElementById('coNombre').value.trim();
  const tel     = document.getElementById('coTel').value.trim();
  if (!nombre || !tel) {
    _markCoFieldError([!nombre && 'coNombre', !tel && 'coTel'].filter(Boolean), errorEl, t('store.coError1', 'Por favor ingresa tu nombre y número móvil.'));
    return;
  }
  if (!isValidPhone(tel)) {
    _markCoFieldError('coTel', errorEl, t('store.coError3', 'Por favor ingresa un número de teléfono válido.'));
    return;
  }
  errorEl.textContent = '';

  const apellido  = document.getElementById('coApellido').value.trim();
  const ciudad    = document.getElementById('coCiudad').value.trim();
  const paisVal   = document.getElementById('coPais').value;
  const estadoVal = (document.getElementById('coEstado').value || '').toUpperCase();
  const zipVal    = (document.getElementById('coZip').value || '').trim();
  if (paisVal === 'US' && !estadoVal) {
    _markCoFieldError('coEstado', errorEl, t('store.coError2', 'Por favor selecciona tu estado.'));
    return;
  }
  if (paisVal === 'US' && !/^\d{5}$/.test(zipVal)) {
    _markCoFieldError('coZip', errorEl, t('store.coErrorZip', 'Por favor ingresa un código postal válido (5 dígitos).'));
    return;
  }
  const direccion = document.getElementById('coDireccion').value.trim();
  const apto      = document.getElementById('coApto').value.trim();
  const zelleSubtotal = cart.reduce((s, i) => s + (i.hasSurcharge ? i.basePrice : i.price) * (i.qty || 1), 0);
  const free          = _cpIsFreeShip() || zelleSubtotal >= SHIPPING.freeThreshold;
  const shippingCost  = free ? 0 : SHIPPING.cost;
  let zelleTax = 0;
  if (paisVal === 'EC') {
    zelleTax = (zelleSubtotal + shippingCost) * 0.15;
  } else if (paisVal === 'US' && estadoVal) {
    const rate = getTaxRate(estadoVal, zipVal);
    if (rate) zelleTax = (zelleSubtotal + shippingCost) * rate;
  }
  const totalFinal = zelleSubtotal + shippingCost + zelleTax;
  const zelleGcDiscount = (_gcCode && _gcBalance > 0) ? parseFloat(Math.min(_gcBalance, totalFinal).toFixed(2)) : 0;
  const afterZelleGc = totalFinal - zelleGcDiscount;
  const zelleCpDiscount = (_cpCode && _cpType)
    ? (_cpIsFreeShip() ? 0 : parseFloat((_cpType==='percent' ? afterZelleGc*_cpAmount/100 : Math.min(_cpAmount, afterZelleGc)).toFixed(2)))
    : 0;
  const totalConGC = parseFloat((afterZelleGc - zelleCpDiscount).toFixed(2));

  _currentOrderNum = generateOrderNum();
  const zelleExtras = [
    zelleGcDiscount > 0 ? `GC:${_gcCode}(-$${zelleGcDiscount})` : '',
    zelleCpDiscount > 0 ? `CP:${_cpCode}(-$${zelleCpDiscount})` : ''
  ].filter(Boolean).join(' | ');
  const zelleEmailVal = (document.getElementById('coEmail').value || '').trim();
  // 22 oct (auditoría): la ventana de WhatsApp se abre ANTES de esperar al servidor — Safari/iPhone
  // bloquea las que se abren después de un await y la clienta se quedaba sin el mensaje (ni el Zelle).
  const _waWin = window.open('', '_blank');
  const result = await submitOrder({
    numero:    _currentOrderNum,
    cliente:   { nombre: (nombre + ' ' + apellido).trim(), telefono: tel, ciudad: ciudad + (paisVal ? ', ' + paisVal : ''), direccion, apto, estado: estadoVal, zip: zipVal, pais: paisVal, email: zelleEmailVal, idioma: __LANG },
    productos: cart.map(i => ({ id: i.id, isCombo: !!i.isCombo, name: i.name, price: i.hasSurcharge ? i.basePrice : i.price, qty: i.qty || 1, personalization: i.personalization || undefined, material: i.material || undefined })),
    total:     totalConGC,
    subtotal:  zelleSubtotal,
    envio:     shippingCost,
    impuesto:  zelleTax,
    pago:      'Zelle',
    estado:    'Nuevo',
    notas:     _composeNotas(zelleExtras) || undefined,
    giftcard:  zelleGcDiscount > 0 ? { code: _gcCode, amount: zelleGcDiscount } : undefined,
    cuponAplicado: _cpCode || undefined
  });
  if (!result.ok) {
    if (_waWin) { try { _waWin.close(); } catch (_) {} }
    errorEl.textContent = t('store.coErrorOrderFailed', 'No pudimos guardar tu pedido — revisa tu conexión e intenta de nuevo.');
    return;
  }
  if (_cpCode) burnCoupon(_cpCode, tel, zelleEmailVal, result.id);
  const _zelleSuccess = { orderNum: _currentOrderNum, total: totalConGC, hasEmail: !!zelleEmailVal, method: 'zelle' };
  _openWa(_waWin, buildWhatsAppUrl());
  closeCheckout();
  cart = []; saveCart(); updateCartUI();
  _resetGift();
  _gcCode=null; _gcBalance=0; _gcApplied=0;
  _cpCode=null; _cpType=null; _cpAmount=0; _cpDiscount=0;
  document.getElementById('gcCodeInput').value='';
  document.getElementById('gcMsg').textContent='';
  document.getElementById('cpCodeInput').value='';
  document.getElementById('cpMsg').textContent='';
  showSuccess(_zelleSuccess);
});

// ─── SQUARE PAYMENT ──────────────────────────────────────────
document.getElementById('payBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('coError');
  const nombre  = document.getElementById('coNombre').value.trim();
  const tel     = document.getElementById('coTel').value.trim();

  if (!nombre || !tel) {
    _markCoFieldError([!nombre && 'coNombre', !tel && 'coTel'].filter(Boolean), errorEl, t('store.coError1', 'Por favor ingresa tu nombre y número móvil.'));
    return;
  }
  if (!isValidPhone(tel)) {
    _markCoFieldError('coTel', errorEl, t('store.coError3', 'Por favor ingresa un número de teléfono válido.'));
    return;
  }
  errorEl.textContent = '';

  const paisVal = document.getElementById('coPais').value;
  const estadoVal = document.getElementById('coEstado').value;
  if (paisVal === 'US' && !estadoVal) {
    _markCoFieldError('coEstado', errorEl, t('store.coError2', 'Por favor selecciona tu estado.'));
    return;
  }
  if (paisVal === 'US' && !/^\d{5}$/.test((document.getElementById('coZip').value || '').trim())) {
    _markCoFieldError('coZip', errorEl, t('store.coErrorZip', 'Por favor ingresa un código postal válido (5 dígitos).'));
    return;
  }

  const btn = document.getElementById('payBtn');
  btn.disabled = true;
  btn.classList.add('loading');

  const customer = {
    name:     nombre,
    lastname: document.getElementById('coApellido').value.trim(),
    phone:    tel,
    email:    (document.getElementById('coEmail').value || '').trim(),
    country:  paisVal,
    state:    estadoVal || undefined,
    zip:      document.getElementById('coZip').value.trim() || undefined,
    city:     document.getElementById('coCiudad').value.trim(),
    address:  document.getElementById('coDireccion').value.trim(),
    apto:     document.getElementById('coApto').value.trim(),
    // Notas libres + línea de regalo (M7); deja lugar para GC/CP que suma cacusa-square
    notes:    _composeNotas('', NOTAS_SQUARE_MAX),
    idioma:   __LANG
  };

  const _subtotal = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const _shippingCost = (_cpIsFreeShip() || _subtotal >= SHIPPING.freeThreshold) ? 0 : SHIPPING.cost;
  const _sqBase = _subtotal + _shippingCost;
  const _sqGcDiscount = (_gcCode && _gcBalance > 0) ? parseFloat(Math.min(_gcBalance, _sqBase).toFixed(2)) : 0;
  const _sqAfterGc = _sqBase - _sqGcDiscount;
  const _sqCpDiscount = (_cpCode && _cpType)
    ? (_cpIsFreeShip() ? 0 : parseFloat((_cpType==='percent' ? _sqAfterGc*_cpAmount/100 : Math.min(_cpAmount, _sqAfterGc)).toFixed(2)))
    : 0;

  try {
    const resp = await fetch(SQUARE_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: expandCartForOrder(cart), customer, shippingCost: _shippingCost, giftCardCode: _gcCode || undefined, couponCode: _cpCode || undefined })
    });
    const data = await resp.json();

    // La tarjeta cubre el total → no se puede cobrar $0 por Square: usar WhatsApp.
    if (data && data.giftCardCoversTotal) {
      const _e = new Error(__LANG === 'en'
        ? 'Your gift card covers the full total — please finish via WhatsApp'
        : 'Tu tarjeta de regalo cubre el total — finaliza por WhatsApp');
      _e.friendly = true;
      throw _e;
    }
    if (!resp.ok || !data.checkoutUrl) {
      const _e = new Error(data.error || '');
      _e.friendly = !!data.error;
      throw _e;
    }

    // El pedido ya no se arma ni se guarda acá — cacusa-square lo registra del lado del
    // servidor (con los mismos datos que ya le mandamos en este POST) recién cuando su
    // webhook confirma que Square procesó el pago de verdad.
    // 22 oct (auditoría): el carrito ya NO se vacía antes de pagar — si la tarjeta se rechaza o la
    // clienta vuelve atrás desde Square, lo encuentra igual. Se vacía al volver con ?paid=1.
    try { sessionStorage.setItem('cacusa_order_pending', '1'); } catch (_) {}
    // Para la pantalla de éxito al volver de Square: solo el total que vio la clienta en el
    // resumen y si dejó email (sí/no) — nunca el email ni otros datos personales.
    try {
      const _shownTotal = parseFloat((document.getElementById('coTotal').textContent || '').replace(/[^0-9.]/g, ''));
      sessionStorage.setItem('cacusa_success_info', JSON.stringify({ total: isNaN(_shownTotal) ? null : _shownTotal, hasEmail: !!customer.email }));
    } catch (_) {}
    window.location.href = data.checkoutUrl;

  } catch (err) {
    // Nunca un error técnico a la vista ("Failed to fetch", JSON inválido…): solo los
    // mensajes pensados para la clienta (del Worker o propios); el resto, uno genérico.
    errorEl.textContent = (err && err.friendly && err.message)
      ? '! ' + err.message + (__LANG === 'en' ? '. Try again or use WhatsApp.' : '. Intenta de nuevo o usa WhatsApp.')
      : t('store.coErrorNetwork', 'No pudimos conectar con el sistema de pago. Revisa tu conexión e intenta de nuevo, o finaliza por WhatsApp.');
    btn.disabled = false;
    btn.classList.remove('loading');
  }
});

// ─── NÚMERO DE ORDEN ─────────────────────────────────────────
function generateOrderNum() {
  const n = new Date();
  const yy = String(n.getFullYear()).slice(2);
  const mm = String(n.getMonth() + 1).padStart(2, '0');
  const dd = String(n.getDate()).padStart(2, '0');
  return 'CA-' + yy + mm + dd + '-' + String(1000 + Math.floor(Math.random() * 9000));
}
let _currentOrderNum = '';

// ─── M7: OPCIÓN DE REGALO (checkout, paso 1) ────────────────
// Viaja en las notas del pedido por los 3 caminos (tarjeta, Zelle/transferencia, WhatsApp) y
// en el mensaje de WhatsApp. Los Workers cortan las notas a 500 caracteres (y cacusa-square
// les suma GC/CP del lado del servidor), así que se compone con tope: la línea de regalo y
// los extras tienen prioridad y, si no entra todo, se recortan las notas libres.
// En el camino de tarjeta se pasa un tope menor (NOTAS_SQUARE_MAX): el Worker de Square
// arma customer_note con nombre/WA/país/ciudad/dirección + estas notas + GiftCard/Cupón y
// corta todo a 500, así que las notas tienen que dejar lugar al resto. La línea de regalo
// va primero para que nunca sea lo que se corta.
const NOTAS_MAX = 500, NOTAS_SQUARE_MAX = 260, NOTAS_EXTRAS_RESERVE = 100, GIFT_MSG_MAX = 150;
function _giftState() {
  const box = document.getElementById('coGift');
  if (!box || !box.checked) return null;
  const msgEl = document.getElementById('coGiftMsg');
  const hideEl = document.getElementById('coGiftHide');
  const msg = String((msgEl && msgEl.value) || '').replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, GIFT_MSG_MAX);
  return { msg, hide: !!(hideEl && hideEl.checked) };
}
// Línea compacta para el admin (siempre en español: la leen Tita/Robin)
function _giftNoteLine() {
  const g = _giftState();
  if (!g) return '';
  return '[REGALO] Ocultar precios: ' + (g.hide ? 'sí' : 'no') + '.' + (g.msg ? ' Tarjeta: "' + g.msg + '"' : '');
}
function _composeNotas(extras, max) {
  const cap = max || NOTAS_MAX;
  const notasEl = document.getElementById('coNotas');
  const gift = _giftNoteLine();
  const ex = extras || '';
  const reserve = cap < NOTAS_MAX ? (ex ? ex.length + 3 : 0) : Math.max(NOTAS_EXTRAS_RESERVE, ex ? ex.length + 3 : 0);
  const room = cap - reserve - (gift ? gift.length + 3 : 0);
  let free = String((notasEl && notasEl.value) || '').trim();
  if (free.length > room) free = free.slice(0, Math.max(0, room)).trim();
  return [gift, free, ex].filter(Boolean).join(' | ').slice(0, cap);
}
function _updateCoCount(inputId, countId, max) {
  const el = document.getElementById(inputId), c = document.getElementById(countId);
  if (el && c) c.textContent = el.value.length + '/' + max;
}
function _syncGiftPanel() {
  const box = document.getElementById('coGift'), panel = document.getElementById('coGiftPanel');
  if (!box || !panel) return;
  panel.hidden = !box.checked;
}
function _resetGift() {
  const box = document.getElementById('coGift');
  if (!box) return;
  box.checked = false;
  const msgEl = document.getElementById('coGiftMsg'); if (msgEl) msgEl.value = '';
  const hideEl = document.getElementById('coGiftHide'); if (hideEl) hideEl.checked = false;
  _syncGiftPanel();
  _updateCoCount('coGiftMsg', 'coGiftMsgCount', GIFT_MSG_MAX);
}
(() => {
  const box = document.getElementById('coGift');
  if (box) box.addEventListener('change', _syncGiftPanel);
  const msgEl = document.getElementById('coGiftMsg');
  if (msgEl) msgEl.addEventListener('input', () => _updateCoCount('coGiftMsg', 'coGiftMsgCount', GIFT_MSG_MAX));
  const notasEl = document.getElementById('coNotas');
  if (notasEl) notasEl.addEventListener('input', () => _updateCoCount('coNotas', 'coNotasCount', notasEl.maxLength > 0 ? notasEl.maxLength : 200));
  _syncGiftPanel();
})();

// ─── WHATSAPP FALLBACK ────────────────────────────────────────
// Lleva la ventana abierta de antemano al chat de WhatsApp; si el navegador no dejó abrirla,
// abre WhatsApp en esta misma pestaña (lo importante es que la clienta reciba el mensaje).
function _openWa(win, url) {
  if (win && !win.closed) { try { win.opener = null; } catch (_) {} win.location.href = url; }
  else window.location.href = url;
}
function buildWhatsAppUrl(opts = {}) {
  const _waEN    = __LANG === 'en';
  const _waMat   = {'Baño de oro 18k':'18k gold plated','Acero inoxidable':'Stainless steel','Plata 925':'925 silver','Gold filled':'Gold filled','Baño de Rodio':'Rhodium plated','Plata 925 con un baño de oro de 18k':'925 silver with 18k gold plating'};
  // opts.method: "coordinar por WhatsApp" pasa 'whatsapp' para que el mensaje cuadre con el pedido
  // guardado (precio con tarjeta, pago a coordinar) aunque la clienta haya marcado Zelle (22 oct).
  const payMethod = opts.method || (document.querySelector('.pay-method-opt.selected') || {}).dataset?.method || 'square';
  const isZelle  = payMethod === 'zelle';
  const nombre   = document.getElementById('coNombre').value.trim();
  const apellido = document.getElementById('coApellido').value.trim();
  const tel      = document.getElementById('coTel').value.trim();
  const ciudad   = document.getElementById('coCiudad').value.trim();
  const pais     = document.getElementById('coPais').value;
  const direccion = document.getElementById('coDireccion').value.trim();
  const notas    = document.getElementById('coNotas').value.trim();

  // Use base price for Zelle (no surcharge), full price for Square
  const total    = cart.reduce((s, i) => s + (isZelle && i.hasSurcharge ? i.basePrice : i.price) * (i.qty || 1), 0);
  const free     = _cpIsFreeShip() || total >= SHIPPING.freeThreshold;
  const envio    = free ? (_waEN ? 'Free' : 'Gratis') : '$' + SHIPPING.cost.toFixed(2);
  const _waShip  = free ? 0 : SHIPPING.cost;
  // Impuesto — misma lógica que renderCheckoutSummary para que el mensaje cuadre con el resumen
  const _waPais   = (document.getElementById('coPais').value || '').toUpperCase();
  const _waEstado = (document.getElementById('coEstado').value || '').toUpperCase();
  const _waZip    = (document.getElementById('coZip').value || '').trim();
  let _waTax = 0, _waTaxLabel = '';
  if (_waPais === 'EC') {
    _waTax = (total + _waShip) * 0.15;
    _waTaxLabel = 'IVA Ecuador (15%)';
  } else if (_waPais === 'US' && _waEstado) {
    const _waRate = getTaxRate(_waEstado, _waZip);
    if (_waRate) {
      _waTax = (total + _waShip) * _waRate;
      _waTaxLabel = 'Sales Tax ' + _waEstado + ' (' + (_waRate * 100).toFixed(2).replace(/\.?0+$/, '') + '%)';
    }
  }
  const totalFinal = total + _waShip + _waTax;

  let msg = _waEN ? '✦ *New order CACUSA by Taitus*\n' : '✦ *Nuevo pedido CACUSA by Taitus*\n';
  if (_currentOrderNum) msg += (_waEN ? '*Order #:* ' : '*Pedido #:* ') + _currentOrderNum + '\n';
  msg += '\n';
  msg += (_waEN ? '*Customer:* ' : '*Cliente:* ') + nombre + (apellido ? ' ' + apellido : '') + '\n';
  msg += '*WhatsApp:* ' + tel + '\n';
  if (ciudad) msg += (_waEN ? '*City:* ' : '*Ciudad:* ') + ciudad + (_waEstado ? ', ' + _waEstado : '') + (_waZip ? ' ' + _waZip : '') + ' (' + pais + ')\n';
  const _waApto = document.getElementById('coApto').value.trim();
  if (direccion) msg += (_waEN ? '*Address:* ' : '*Dirección:* ') + direccion + (_waApto ? ', ' + _waApto : '') + '\n';
  if (notas) msg += (_waEN ? '*Notes:* ' : '*Notas:* ') + notas + '\n';
  const _waGift = _giftState();
  if (_waGift) {
    msg += _waEN
      ? '*Gift:* yes · Hide prices: ' + (_waGift.hide ? 'yes' : 'no') + (_waGift.msg ? ' · Card: "' + _waGift.msg + '"' : '') + '\n'
      : '*Regalo:* sí · Ocultar precios: ' + (_waGift.hide ? 'sí' : 'no') + (_waGift.msg ? ' · Tarjeta: "' + _waGift.msg + '"' : '') + '\n';
  }
  msg += _waEN ? '\n*Products:*\n' : '\n*Productos:*\n';
  cart.forEach(item => {
    const _iName  = _waEN && item.name_en ? item.name_en : item.name;
    const _iMat   = item.material ? (_waEN ? (_waMat[item.material] || item.material) : item.material) : null;
    const _iPrice = isZelle && item.hasSurcharge ? item.basePrice : item.price;
    const _iQty   = item.qty || 1;
    msg += '• ' + (_iQty > 1 ? _iQty + '× ' : '') + _iName + ' — $' + (_iPrice * _iQty).toFixed(2);
    if (_iMat) msg += ' (' + _iMat + ')';
    if (item.personalization) msg += ' — "' + item.personalization + '"';
    msg += '\n';
  });
  msg += (_waEN ? '\n*Subtotal:* $' : '\n*Subtotal:* $') + total.toFixed(2);
  msg += (_waEN ? '\n*Shipping:* ' : '\n*Envío:* ') + envio;
  if (_waTax > 0) {
    msg += '\n*' + _waTaxLabel + ':* $' + _waTax.toFixed(2);
  }
  const _waGc = (_gcCode && _gcBalance > 0) ? parseFloat(Math.min(_gcBalance, totalFinal).toFixed(2)) : 0;
  if (_waGc > 0) {
    msg += (_waEN ? '\n*Gift card (' + _gcCode + '):* -$' : '\n*Tarjeta de regalo (' + _gcCode + '):* -$') + _waGc.toFixed(2);
  }
  const _waAfterGc = totalFinal - _waGc;
  const _waCp = (_cpCode && _cpType)
    ? (_cpIsFreeShip() ? 0 : parseFloat((_cpType === 'percent' ? _waAfterGc * _cpAmount / 100 : Math.min(_cpAmount, _waAfterGc)).toFixed(2)))
    : 0;
  if (_waCp > 0) {
    msg += (_waEN ? '\n*Coupon (' + _cpCode + '):* -$' : '\n*Cupón (' + _cpCode + '):* -$') + _waCp.toFixed(2);
  }
  const _waTotalFinal = parseFloat((_waAfterGc - _waCp).toFixed(2));
  msg += (_waEN ? '\n*Total:* $' : '\n*Total:* $') + _waTotalFinal.toFixed(2);
  if (isZelle) {
    msg += _waEN
      ? '\n\n*Payment:* Zelle / Bank Transfer\nZelle: facturacioncacusa@gmail.com'
      : '\n\n*Pago:* Zelle / Transferencia bancaria\nZelle: facturacioncacusa@gmail.com';
  }

  const waNumber = (WHATSAPP_NUMBER || '').replace(/\D/g, '');
  return waNumber
    ? 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(msg)
    : 'https://wa.me/?text=' + encodeURIComponent(msg);
}

// Barrido de seguridad (19 sep): antes esto era fire-and-forget — el checkout abría
// WhatsApp, quemaba el cupón y vaciaba el carrito de inmediato, sin esperar a que el
// servidor confirmara que el pedido se guardó. Si el Worker estaba caído, la clienta
// veía "pedido confirmado" pero el pedido nunca existió. Ahora devuelve true/false
// según la respuesta real, y los 2 checkouts (Zelle y WhatsApp) esperan este resultado
// antes de continuar.
// Idempotencia real (hallazgo del 19 sep, auditoría propia A07-A19; endurecida el 19
// sep en la auditoría de integridad, F01): si la clienta ve un error de red pero el
// pedido SÍ se guardó server-side, el checkout deja el carrito intacto para
// reintentar (arreglo A06+A10) — un reintento manual disparaba un pedido nuevo
// entero, con doble redención de gift card.
//
// La llave original se derivaba de un hash de 32 bits de email+teléfono+total+items
// — determinística, y por eso ADIVINABLE/RECONSTRUIBLE por cualquiera que conociera
// esos 4 datos de otra clienta: el servidor devolvía el pedido COMPLETO (email,
// dirección, teléfono) a quien reenviara esa key. Ahora la key es aleatoria de
// verdad (crypto.randomUUID) — pero sigue habiendo que reusar la MISMA key en un
// reintento del MISMO carrito (si no, cada reintento crearía un pedido nuevo) y
// generar una NUEVA si la clienta modifica el carrito entre intentos (si no, un
// cambio real de carrito podría toparse con el chequeo de huella canónica del
// servidor y rebotar con 409). Se resuelve cacheando la key contra una firma del
// contenido (no contra el tiempo ni un evento explícito de "abrí el checkout") —
// mismo carrito/cliente/total → misma key cacheada; cualquier cambio → key nueva.
let _checkoutIdemCache = null; // { signature, key }
function _orderIdemKey(order) {
  const c = order.cliente || {};
  const items = (order.productos || []).map(p => `${p.name}:${p.qty}`).sort().join(',');
  const signature = `${(c.email || '').toLowerCase()}|${c.telefono || ''}|${order.total}|${items}`;
  if (_checkoutIdemCache && _checkoutIdemCache.signature === signature) {
    return _checkoutIdemCache.key;
  }
  const key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2));
  _checkoutIdemCache = { signature, key };
  return key;
}

// Auditoría externa (19 sep, ronda nueva): antes solo devolvía true/false — /coupon/burn
// se llamaba con teléfono/email pero sin ningún id de pedido real detrás (el Worker no
// tenía forma de verificar que el cupón se estaba consumiendo contra una compra que de
// verdad quedó guardada). Ahora también devuelve el id real del pedido, para atarlo — ver
// burnCoupon() y handleCouponBurnPublic() en admin-worker.js.
async function submitOrder(order) {
  try {
    order.idempotencyKey = _orderIdemKey(order);
    const r = await fetch(ADMIN_WORKER_URL + '/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ order })
    });
    if (!r.ok) return { ok: false, id: null };
    const data = await r.json().catch(() => null);
    const id = data?.id ?? data?.order?.id ?? null;
    return { ok: !!(data && data.ok), id };
  } catch (e) {
    return { ok: false, id: null };
  }
}

document.getElementById('waFallbackBtn').addEventListener('click', async e => {
  e.preventDefault();
  const errorEl = document.getElementById('coError');
  const nombre  = document.getElementById('coNombre').value.trim();
  const tel     = document.getElementById('coTel').value.trim();
  if (!nombre || !tel) {
    _markCoFieldError([!nombre && 'coNombre', !tel && 'coTel'].filter(Boolean), errorEl, t('store.coError1', 'Por favor ingresa tu nombre y teléfono WhatsApp.'));
    return;
  }
  if (!isValidPhone(tel)) {
    _markCoFieldError('coTel', errorEl, t('store.coError3', 'Por favor ingresa un número de teléfono válido.'));
    return;
  }
  errorEl.textContent = '';

  // Registrar pedido en el admin
  const apellido   = document.getElementById('coApellido').value.trim();
  const ciudad     = document.getElementById('coCiudad').value.trim();
  const pais       = document.getElementById('coPais').value;
  if (pais === 'US' && !(document.getElementById('coEstado').value || '')) {
    _markCoFieldError('coEstado', errorEl, t('store.coError2', 'Por favor selecciona tu estado.'));
    return;
  }
  if (pais === 'US' && !/^\d{5}$/.test((document.getElementById('coZip').value || '').trim())) {
    _markCoFieldError('coZip', errorEl, t('store.coErrorZip', 'Por favor ingresa un código postal válido (5 dígitos).'));
    return;
  }
  const direccion  = document.getElementById('coDireccion').value.trim();
  const apto       = document.getElementById('coApto').value.trim();
  const total      = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const free       = _cpIsFreeShip() || total >= SHIPPING.freeThreshold;
  const waShip     = free ? 0 : SHIPPING.cost;
  // Impuesto — misma lógica que renderCheckoutSummary (el total registrado debe cuadrar con lo que vio el cliente)
  const waEstadoV  = (document.getElementById('coEstado').value || '').toUpperCase();
  const waZipV     = (document.getElementById('coZip').value || '').trim();
  let waTax = 0;
  if ((pais || '').toUpperCase() === 'EC') {
    waTax = (total + waShip) * 0.15;
  } else if ((pais || '').toUpperCase() === 'US' && waEstadoV) {
    const waRate = getTaxRate(waEstadoV, waZipV);
    if (waRate) waTax = (total + waShip) * waRate;
  }
  const totalFinal = total + waShip + waTax;
  const waGcDiscount = (_gcCode && _gcBalance > 0) ? parseFloat(Math.min(_gcBalance, totalFinal).toFixed(2)) : 0;
  const afterWaGc = totalFinal - waGcDiscount;
  const waCpDiscount = (_cpCode && _cpType)
    ? (_cpIsFreeShip() ? 0 : parseFloat((_cpType==='percent' ? afterWaGc*_cpAmount/100 : Math.min(_cpAmount, afterWaGc)).toFixed(2)))
    : 0;
  const totalConGC   = parseFloat((afterWaGc - waCpDiscount).toFixed(2));
  _currentOrderNum = generateOrderNum();
  const waExtras = [
    waGcDiscount > 0 ? `GC:${_gcCode}(-$${waGcDiscount})` : '',
    waCpDiscount > 0 ? `CP:${_cpCode}(-$${waCpDiscount})` : ''
  ].filter(Boolean).join(' | ');
  const emailVal = (document.getElementById('coEmail').value || '').trim();
  // 22 oct (auditoría): la ventana de WhatsApp se abre ANTES de esperar al servidor — Safari/iPhone
  // bloquea las que se abren después de un await y la clienta se quedaba sin el mensaje (ni el Zelle).
  const _waWin = window.open('', '_blank');
  const result = await submitOrder({
    numero:  _currentOrderNum,
    cliente: { nombre: (nombre + ' ' + apellido).trim(), telefono: tel, ciudad: ciudad + (pais ? ', ' + pais : ''), direccion, apto, estado: waEstadoV, zip: waZipV, pais: pais || '', email: emailVal, idioma: __LANG },
    productos: cart.map(i => ({ id: i.id, isCombo: !!i.isCombo, name: i.name, price: i.price, qty: i.qty || 1, personalization: i.personalization || undefined, material: i.material || undefined })),
    total:  totalConGC,
    subtotal: total,
    envio:  waShip,
    impuesto: waTax,
    pago:   'WhatsApp',
    estado: 'Nuevo',
    notas:  _composeNotas(waExtras) || undefined,
    giftcard: waGcDiscount > 0 ? { code: _gcCode, amount: waGcDiscount } : undefined,
    cuponAplicado: _cpCode || undefined
  });
  if (!result.ok) {
    if (_waWin) { try { _waWin.close(); } catch (_) {} }
    errorEl.textContent = t('store.coErrorOrderFailed', 'No pudimos guardar tu pedido — revisa tu conexión e intenta de nuevo.');
    return;
  }
  if (_cpCode) burnCoupon(_cpCode, tel, emailVal, result.id);
  const _waSuccess = { orderNum: _currentOrderNum, total: totalConGC, hasEmail: !!emailVal, method: 'whatsapp' };
  _openWa(_waWin, buildWhatsAppUrl({ method: 'whatsapp' }));
  closeCheckout();
  cart = []; saveCart(); updateCartUI();
  _resetGift();
  _gcCode=null; _gcBalance=0; _gcApplied=0;
  _cpCode=null; _cpType=null; _cpAmount=0; _cpDiscount=0;
  document.getElementById('gcCodeInput').value='';
  document.getElementById('gcMsg').textContent='';
  document.getElementById('cpCodeInput').value='';
  document.getElementById('cpMsg').textContent='';
  showSuccess(_waSuccess);
});

// Pantalla de éxito. info = { orderNum, total, hasEmail, method } — cada campo es opcional
// y solo se muestra si el flujo de verdad lo tiene (el regreso de Square no trae número de
// pedido: lo genera cacusa-square del lado del servidor al confirmar el pago).
let _successReleaseTrap = null;
function showSuccess(info) {
  info = info || {};
  const en = __LANG === 'en';
  const box = document.getElementById('successDetails');
  if (box) {
    let h = '';
    if (info.orderNum) h += '<p>' + (en ? 'Order #' : 'Pedido #') + '<strong>' + esc(info.orderNum) + '</strong></p>';
    if (typeof info.total === 'number' && isFinite(info.total)) h += '<p>Total: <strong>$' + info.total.toFixed(2) + '</strong></p>';
    h += '<p>' + (en ? 'Personalized pieces are handmade in 5 to 10 business days, plus shipping time.' : 'Las piezas personalizadas se elaboran a mano en 5 a 10 días hábiles, más el tiempo de envío.') + '</p>';
    if (info.hasEmail) h += '<p>✓ ' + (en ? 'We sent the confirmation to your email.' : 'Te enviamos la confirmación a tu email.') + '</p>';
    if (info.method === 'zelle' && info.orderNum && info.total > 0) {
      const waText = (en ? 'Hi! Here is the payment screenshot for my order #' : '¡Hola! Te envío la captura del pago de mi pedido #') + info.orderNum;
      h += '<ol class="success-steps">' +
        '<li>' + (en ? 'Pay' : 'Paga') + (typeof info.total === 'number' ? ' $' + info.total.toFixed(2) : '') + (en ? ' by Zelle to facturacioncacusa@gmail.com or by bank transfer.' : ' por Zelle a facturacioncacusa@gmail.com o por transferencia.') + '</li>' +
        '<li>' + (en ? 'Send the screenshot on WhatsApp with your order #' : 'Envía la captura por WhatsApp con tu pedido #') + esc(info.orderNum) + '.</li>' +
        '</ol><a class="success-wa" href="' + esc(_waLink(waText)) + '" target="_blank" rel="noopener">' + (en ? 'Send screenshot on WhatsApp' : 'Enviar captura por WhatsApp') + '</a>';
    }
    box.innerHTML = h;
  }
  const ov = document.getElementById('success-overlay');
  ov.classList.add('open');
  if (_successReleaseTrap) _successReleaseTrap();
  _successReleaseTrap = trapFocus(ov, closeSuccess);
}
function closeSuccess() {
  document.getElementById('success-overlay').classList.remove('open');
  if (_successReleaseTrap) { const r = _successReleaseTrap; _successReleaseTrap = null; r(); }
}
document.getElementById('successBack').addEventListener('click', closeSuccess);

// ─── LANG ───────────────────────────────────────────────────
// Cambia de idioma yendo a la página equivalente del otro idioma (el hreflang de la
// página actual: producto, categoría o tienda) y guarda la elección — lo usan el
// selector ES/EN de la barra y el del menú móvil.
function _goLang(l) {
  const lang = l === 'en' ? 'en' : 'es';
  __LS.setItem('cacusa-lang', lang);
  let dest = lang === 'en' ? '/en/ui_kits/store/' : '/ui_kits/store/';
  const link = document.getElementById(lang === 'en' ? 'hreflangEn' : 'hreflangEs');
  try {
    if (link && link.getAttribute('href')) {
      const u = new URL(link.getAttribute('href'), location.href);
      if (/\/ui_kits\/store\//.test(u.pathname)) dest = u.pathname;
    }
  } catch (_) {}
  window.location.href = dest;
}
window.cacusaLang = _goLang;

// ─── INIT ───────────────────────────────────────────────────
updateCartUI();

// Detectar regreso desde Square (?paid=1) → solo mostrar success.
// El pedido, el cupón y la tarjeta de regalo ya NO se registran acá: este parámetro en la URL
// no prueba que el pago se haya completado (cualquiera puede escribir esta misma URL sin pagar).
// cacusa-square registra el pedido de verdad cuando su webhook recibe la confirmación real de
// Square — este código solo limpia el estado local y saluda a la clienta.
if (new URLSearchParams(window.location.search).get('paid') === '1') {
  history.replaceState({}, '', window.location.pathname);
  try { sessionStorage.removeItem('cacusa_order_pending'); } catch (_) {}
  cart = []; saveCart(); updateCartUI();
  _resetGift();
  let _sqInfo = {};
  try { _sqInfo = JSON.parse(sessionStorage.getItem('cacusa_success_info') || '{}') || {}; sessionStorage.removeItem('cacusa_success_info'); } catch (_) {}
  showSuccess({ total: typeof _sqInfo.total === 'number' ? _sqInfo.total : undefined, hasEmail: !!_sqInfo.hasEmail, method: 'square' });
}

// ─── STARS RENDERER ────────────────────────────────────────
function renderStars(avg) {
  let h = '';
  for (let i = 1; i <= 5; i++) {
    const c = avg >= i - 0.25 ? 'var(--pink)' : (avg >= i - 0.75 ? 'var(--pink-mid)' : '#ddd');
    h += `<span class="star-icon" style="color:${c}">★</span>`;
  }
  return h;
}

// ─── RESEÑAS VÍA EL WORKER (wave 1) ─────────────────────────
// GET /pub/reviews (Worker cacusa-admin, el mismo de /pub/stock) devuelve SOLO las reseñas
// aprobadas, ya agrupadas: { ok, byProduct: { "<id>": { avg, count, items:[{name,rating,
// comment,date,lang}] } } }, cacheable 300 s. Se pide una sola vez por visita (en paralelo
// con el catálogo). Si el Worker todavía no tiene la ruta (404/405), falla o no responde,
// se usa la lectura directa de Firebase de siempre.
var _pubReviewsP = null; // var (no let): loadData() la usa antes de llegar a esta línea
function _fetchPubReviews() {
  if (!_pubReviewsP) _pubReviewsP = fetchJsonT(ADMIN_WORKER_URL + '/pub/reviews', undefined, 4000)
    .then(d => (d && d.ok && d.byProduct && typeof d.byProduct === 'object' && !Array.isArray(d.byProduct)) ? d.byProduct : null);
  return _pubReviewsP;
}
function _pubReviewItems(entry) {
  const items = entry && Array.isArray(entry.items) ? entry.items : [];
  return items.filter(v => v && typeof v === 'object' && v.comment)
    .map(v => ({ name: String(v.name || ''), rating: Math.min(5, Math.max(1, Math.round(Number(v.rating) || 5))), comment: String(v.comment), date: String(v.date || '') }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
// ─── REVIEW SUMMARIES (para las cards) ─────────────────────
async function loadReviewSummaries() {
  const pub = await _fetchPubReviews();
  if (pub) {
    Object.entries(pub).forEach(([pid, e]) => {
      const count = Math.floor(Number(e && e.count) || 0), avg = Number(e && e.avg);
      if (count > 0 && avg >= 1 && avg <= 5) _reviewSummaries[+pid] = { avg: Math.round(avg * 10) / 10, count };
    });
    _softRenderProducts();
    return;
  }
  try {
    const r = await fetch(_fbUrl('https://cacusa-pos-default-rtdb.firebaseio.com/cacusa_reviews.json'));
    if (!r.ok) return;
    const all = await r.json();
    if (!all || typeof all !== 'object') return;
    Object.entries(all).forEach(([pid, revs]) => {
      if (!revs || typeof revs !== 'object') return;
      const vals = Object.values(revs).filter(v => v && v.rating && v.approved !== false);
      if (!vals.length) return;
      const avg = vals.reduce((s, v) => s + v.rating, 0) / vals.length;
      _reviewSummaries[+pid] = { avg: Math.round(avg * 10) / 10, count: vals.length };
    });
    _softRenderProducts();
  } catch(_) {}
}

// ─── GALLERY ───────────────────────────────────────────────
function getProductImages(p) {
  if (Array.isArray(p.images) && p.images.length) return p.images;
  if (p.imageUrl) return [p.imageUrl];
  return [];
}
function initGallery(p) {
  _galleryImages = getProductImages(p);
  _galleryIdx = 0;
  renderGallerySlide();
  const multi = _galleryImages.length > 1;
  const thumbs = document.getElementById('galleryThumbs');
  if (multi) {
    thumbs.classList.remove('hidden');
    thumbs.innerHTML = _galleryImages.map((url, i) =>
      `<div class="gallery-thumb ${i===0?'active':''}" role="button" tabindex="0" aria-label="Photo ${i + 1}" onclick="switchGallerySlide(${i})" onkeydown="activateOnKey(event,()=>switchGallerySlide(${i}))"><img src="${esc(url)}" loading="lazy" width="52" height="52" alt="${esc(p.name || '')} — foto ${i + 1}"></div>`
    ).join('');
  } else {
    thumbs.classList.add('hidden');
  }
  const dots = document.getElementById('galleryDots');
  dots.innerHTML = multi ? _galleryImages.map((_, i) =>
    `<button class="gallery-dot ${i===0?'active':''}" aria-label="${__LANG === 'en' ? 'Photo' : 'Foto'} ${i + 1}" onclick="event.stopPropagation();switchGallerySlide(${i})"></button>`
  ).join('') : '';
  document.getElementById('galleryPrev').classList.toggle('vis', multi);
  document.getElementById('galleryNext').classList.toggle('vis', multi);
}
function renderGallerySlide() {
  const p = currentProduct; if (!p) return;
  const url = _galleryImages[_galleryIdx];
  const imgBg = document.getElementById('modalImgBg');
  if (url) {
    const pos = _focal(p.focalX) + '% ' + _focal(p.focalY) + '%';
    const zoom = _galleryImages.length > 1 ? 1 : _zoom(p.zoom);
    imgBg.innerHTML = `<img src="${esc(url)}" alt="${esc(p.name + ' — handcrafted personalized jewelry by CACUSA')}" width="340" height="340" style="width:100%;height:100%;object-fit:cover;object-position:${pos};transform:scale(${zoom});transform-origin:${pos};display:block">`;
    imgBg.style.cssText = 'width:100%;height:100%';
  } else {
    imgBg.innerHTML = '';
    imgBg.style.cssText = 'background:' + (p.grad || 'var(--grad)') + ';width:100%;height:100%';
  }
}
function switchGallerySlide(idx) {
  const n = _galleryImages.length; if (!n) return;
  _galleryIdx = ((idx % n) + n) % n;
  renderGallerySlide();
  document.querySelectorAll('#galleryThumbs .gallery-thumb').forEach((t, i) => t.classList.toggle('active', i === _galleryIdx));
  document.querySelectorAll('#galleryDots .gallery-dot').forEach((d, i) => d.classList.toggle('active', i === _galleryIdx));
}

// ─── SWIPE HELPER ──────────────────────────────────────────
function addSwipe(el, onLeft, onRight) {
  let _tx = null;
  el.addEventListener('touchstart', e => { _tx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (_tx === null) return;
    const dx = e.changedTouches[0].clientX - _tx; _tx = null;
    if (Math.abs(dx) < 40) return;
    dx < 0 ? onLeft() : onRight();
  }, { passive: true });
}
addSwipe(document.getElementById('galleryMain'),
  () => _galleryImages.length > 1 ? switchGallerySlide(_galleryIdx + 1) : openLightbox(_galleryImages, 0),
  () => _galleryImages.length > 1 ? switchGallerySlide(_galleryIdx - 1) : null
);

// ─── LIGHTBOX ──────────────────────────────────────────────
function openLightbox(images, idx) {
  if (!images || !images.length) return;
  _lbImages = images; _lbIdx = ((idx||0) + images.length) % images.length;
  const multi = images.length > 1;
  document.getElementById('lbPrev').classList.toggle('vis', multi);
  document.getElementById('lbNext').classList.toggle('vis', multi);
  const thumbs = document.getElementById('lbThumbs');
  const _lbName = currentProduct ? (currentProduct.name || '') : '';
  thumbs.innerHTML = multi ? images.map((url, i) =>
    `<div class="lb-thumb ${i===_lbIdx?'active':''}" role="button" tabindex="0" aria-label="Photo ${i + 1}" onclick="lbGoTo(${i})" onkeydown="activateOnKey(event,()=>lbGoTo(${i}))"><img src="${esc(url)}" loading="lazy" width="44" height="44" alt="${esc(_lbName)} — foto ${i + 1}"></div>`
  ).join('') : '';
  renderLbSlide();
  const _lbW = document.getElementById('lbWish');
  const _lbWp = document.getElementById('lbWishPath');
  const _inW = currentProduct && _wish.has(currentProduct.id);
  if (_lbW) _lbW.classList.toggle('liked', !!_inW);
  if (_lbWp) _lbWp.style.fill = _inW ? 'var(--pink)' : 'none';
  document.getElementById('lightbox').classList.add('open');
  _lbReleaseTrap = trapFocus(document.getElementById('lightbox'), closeLightbox);
}
function renderLbSlide() {
  const _lbI = document.getElementById('lbImg');
  _lbI.src = _lbImages[_lbIdx] || '';
  _lbI.alt = currentProduct ? (currentProduct.name + ' — handcrafted personalized jewelry by CACUSA') : '';
  document.getElementById('lbCounter').textContent = _lbImages.length > 1 ? (_lbIdx + 1) + ' / ' + _lbImages.length : '';
  document.querySelectorAll('#lbThumbs .lb-thumb').forEach((t, i) => t.classList.toggle('active', i === _lbIdx));
}
function lbGoTo(idx) {
  _lbIdx = ((idx % _lbImages.length) + _lbImages.length) % _lbImages.length;
  renderLbSlide();
}
let _lbReleaseTrap = null;
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  if (_lbReleaseTrap) { _lbReleaseTrap(); _lbReleaseTrap = null; }
}
document.getElementById('lbClose').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target === document.getElementById('lightbox') || e.target === document.getElementById('lbImg')) closeLightbox();
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowRight') lbGoTo(_lbIdx + 1);
  if (e.key === 'ArrowLeft') lbGoTo(_lbIdx - 1);
});
addSwipe(document.getElementById('lightbox'), () => lbGoTo(_lbIdx + 1), () => lbGoTo(_lbIdx - 1));

// ─── TAMBIÉN TE PUEDE GUSTAR (25 nov) ──────────────────────
// products.json puede traer `similar: [ids]` por producto (hasta 8, en orden, calculados en el
// panel con las huellas visuales del catálogo). Se usan los que siguen disponibles y con stock
// (available === false ya incluye los agotados de /pub/stock, ver _applySoldOut). Si no hay
// `similar` o quedan menos de n, se completa con la misma categoría primero y después el precio
// más cercano. Nunca el mismo producto ni agotados. Lo usan el modal/ficha y el carrito.
function _similarProducts(p, n, exclude) {
  const ex = new Set((exclude || []).map(String));
  ex.add(String(p.id));
  const ok = x => !!x && x.available !== false && !ex.has(String(x.id));
  const out = [];
  const take = x => { if (out.length < n && ok(x)) { out.push(x); ex.add(String(x.id)); } };
  if (Array.isArray(p.similar) && p.similar.length) {
    const byId = new Map(PRODUCTS.map(x => [String(x.id), x]));
    p.similar.slice(0, 8).forEach(id => take(byId.get(String(id))));
  }
  if (out.length < n) {
    const price = +p.price || 0;
    PRODUCTS.filter(ok)
      .sort((a, b) => ((b.cat === p.cat) - (a.cat === p.cat)) || (Math.abs(+a.price - price) - Math.abs(+b.price - price)))
      .forEach(take);
  }
  return out;
}
// Tarjeta de la fila (mismos estilos .related-card de siempre). <a href> real a la página del
// producto; un clic normal abre el modal igual que la grilla (_pcardNav → openModal + ?p=).
function _relatedCardHtml(r) {
  const rName = (__LANG === 'en' && r.name_en) ? r.name_en : r.name;
  return `<a class="related-card" href="${_pcardHref(r)}" onclick="return _pcardNav(event, ${r.id})">
      <div class="related-card-img" style="${imgBgStyle(r)}">${imgInner(r, rName)}</div>
      <div class="related-card-body">
        ${r.badge ? `<div class="related-card-tag">${esc(tagLabel(r.tag))}</div>` : ''}
        <div class="related-card-name">${esc(rName)}</div>
        <div class="related-card-price">$${(+r.price).toFixed(2)}</div>
      </div>
    </a>`;
}
// Se pinta perezoso: al abrir el modal quedan 4 tarjetas vacías del mismo tamaño (sin salto de
// diseño) y las de verdad, con sus fotos, recién cuando la fila se acerca a la pantalla.
let _relatedIO = null;
function _renderRelatedProducts(p) {
  const container = document.getElementById('relatedProducts');
  const grid = document.getElementById('relatedGrid');
  if (!container || !grid) return;
  if (_relatedIO) { _relatedIO.disconnect(); _relatedIO = null; }
  const related = _similarProducts(p, 4);
  if (related.length < 2) { container.style.display = 'none'; grid.innerHTML = ''; return; }
  container.style.display = 'block';
  const fill = () => { if (currentProduct === p) grid.innerHTML = related.map(_relatedCardHtml).join(''); };
  if (!('IntersectionObserver' in window)) { fill(); return; }
  grid.innerHTML = related.map(() => '<div class="related-card related-card--ph" aria-hidden="true"><div class="related-card-img"></div><div class="related-card-body"></div></div>').join('');
  _relatedIO = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    if (_relatedIO) { _relatedIO.disconnect(); _relatedIO = null; }
    fill();
  }, { rootMargin: '240px 0px' });
  _relatedIO.observe(grid);
}
// Carrito: hasta 4 piezas parecidas a lo que ya lleva (turnándose entre sus productos), sin
// repetir lo del carrito ni las sugerencias de envío gratis. Solo con el carrito abierto, así
// no se arma ni se piden fotos mientras está cerrado.
function _cartSimilarHtml(excludeIds) {
  const drawer = document.getElementById('cart-drawer');
  if (!drawer || !drawer.classList.contains('open')) return '';
  const base = cart.filter(i => !i.isCombo).map(i => PRODUCTS.find(p => String(p.id) === String(i.id))).filter(Boolean);
  if (!base.length) return '';
  const ex = cart.map(i => String(i.id)).concat((excludeIds || []).map(String));
  const lists = base.map(p => _similarProducts(p, 8, ex));
  const out = [], seen = new Set();
  for (let k = 0; k < 8 && out.length < 4; k++) {
    for (const l of lists) {
      const x = l[k];
      if (x && !seen.has(String(x.id)) && out.length < 4) { seen.add(String(x.id)); out.push(x); }
    }
  }
  if (out.length < 2) return '';
  return '<div class="cart-suggest cart-suggest--similar"><div class="cs-title">' + (__LANG === 'en' ? 'You may also like' : 'También te puede gustar') + '</div><div class="cs-list cs-list--row">' +
    out.map(p => {
      const nm = __LANG === 'en' && p.name_en ? p.name_en : p.name;
      return `<a class="cs-item" href="${_pcardHref(p)}" onclick="return _cartSuggestNav(event, ${p.id})"><div class="cs-img" style="${imgBgStyle(p)}">${imgInner(p, nm)}</div><div class="cs-name">${esc(nm)}</div><div class="cs-price">$${(+p.price).toFixed(2)}</div></a>`;
    }).join('') + '</div></div>';
}

// ─── BUSCAR POR FOTO (25 nov) ──────────────────────────────
// El motor (TF.js + EfficientNetV2-B0 + huellas del catálogo, ~14 MB, servido por el panel en
// admin.cacusabytaitus.com/models/) y el overlay viven en photo-search.js, compartido ES/EN.
// No se descarga NADA hasta que la clienta toca el botón. El ?v= de abajo lo pone
// .github/scripts/bump_asset_versions.py (no tocarlo a mano).
const PHOTO_SEARCH_SRC = '/ui_kits/store/photo-search.js?v=a4cdb53eec';
let _photoSearchP = null;
function _loadPhotoSearch() {
  if (window.CacusaPhotoSearch) return Promise.resolve(window.CacusaPhotoSearch);
  if (_photoSearchP) return _photoSearchP;
  _photoSearchP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PHOTO_SEARCH_SRC; s.async = true;
    s.onload = () => (window.CacusaPhotoSearch ? resolve(window.CacusaPhotoSearch) : reject(new Error('init')));
    s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
  _photoSearchP.catch(() => { _photoSearchP = null; });
  return _photoSearchP;
}
function openPhotoSearch() {
  const btn = document.getElementById('photoSearchBtn');
  if (btn) btn.setAttribute('aria-busy', 'true');
  _loadPhotoSearch()
    .then(ps => ps.open(btn))
    .catch(() => showToast(__LANG === 'en' ? 'Photo search could not load. Check your connection and try again.' : 'No se pudo abrir la búsqueda por foto. Revisa tu conexión e inténtalo de nuevo.', 4000))
    .then(() => { if (btn) btn.removeAttribute('aria-busy'); });
}
// El botón viene en la plantilla; si una página física todavía no se regeneró, se crea acá.
(function _initPhotoSearchBtn() {
  let btn = document.getElementById('photoSearchBtn');
  if (!btn) {
    const sw = document.querySelector('.filters .search-wrap');
    if (!sw) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'photoSearchBtn'; btn.className = 'photo-search-btn';
    btn.textContent = __LANG === 'en' ? '◇ Search by photo' : '◇ Buscar por foto';
    sw.insertAdjacentElement('afterend', btn);
  }
  btn.addEventListener('click', openPhotoSearch);
})();

// ─── SEO: SCHEMA DINÁMICO ─────────────────────────────────
const _SEO_BASE = 'https://cacusabytaitus.com/en/ui_kits/store/';
const _SEO_ORG  = 'https://cacusabytaitus.com/#organization';
const _SEO_IMG_DEFAULT = 'https://cacusabytaitus.com/assets/og-image.jpg';
// Bases de las 2 tiendas (idénticas en el archivo ES y en el EN) — hacen falta las 2 para
// armar el par de hreflang recíproco sin importar en qué idioma esté el visitante actual.
const _STORE_BASE_ES = 'https://cacusabytaitus.com/ui_kits/store/';
const _STORE_BASE_EN = 'https://cacusabytaitus.com/en/ui_kits/store/';
function _slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function _productParam(p) {
  const name = String(((__LANG === 'en' && p.name_en) ? p.name_en : p.name) || '').replace(/\s+/g, ' ').trim();
  const slug = _slugify(name);
  return (slug ? slug + '-' : '') + p.id;
}
function _extractProductId(param) {
  if (!param) return param;
  const idx = param.lastIndexOf('-');
  return idx === -1 ? param : param.slice(idx + 1);
}
// _productParam() usa el __LANG actual; para el par de hreflang hace falta el slug en
// LOS 2 idiomas a la vez, sin importar en cuál esté navegando la clienta ahora mismo.
function _productSlugFor(p, lang) {
  const name = (lang === 'en' && p.name_en) ? p.name_en : p.name;
  const slug = _slugify(name);
  return (slug ? slug + '-' : '') + p.id;
}
function _categorySlug(cat) { return _slugify(cat); }
// <title> de una ficha: misma regla que product_title() en
// .github/scripts/generate_product_pages.py (máx. 70 caracteres, aviso de Bing).
function _productTitle(name) {
  const full = name + ' — CACUSA by Taitus';
  if (full.length <= 70) return full;
  const short = name + ' | CACUSA';
  if (short.length <= 70) return short;
  const room = 70 - '… | CACUSA'.length;
  const cut = name.slice(0, room).replace(/\s+\S*$/, '').replace(/[\s,.;:\-—]+$/, '');
  return cut + '… | CACUSA';
}
function _setMeta(id, val) { const el = document.getElementById(id); if (el) el.setAttribute('content', val); }
function _setCanonical(url) { const el = document.getElementById('canonicalLink'); if (el) el.setAttribute('href', url); }
// Barrido SEO (19 sep): las URLs limpias (/producto/<slug>-<id>/, /categoria/<slug>/) son
// las que sirve el generador estático (.github/scripts/generate_product_pages.py) — desde
// ahí Google ve canonical/hreflang/H1 correctos desde el primer byte. Estas 3 funciones
// (_setHreflang + las que llaman) usan esa MISMA URL como canonical/hreflang aunque la
// clienta esté navegando por la SPA con el viejo ?p=/?cat= en la barra de direcciones —
// consolida el SEO hacia la página nueva sin forzar una redirección real al visitante.
function _setHreflang(esUrl, enUrl) {
  const es = document.getElementById('hreflangEs');      if (es) es.setAttribute('href', esUrl);
  const en = document.getElementById('hreflangEn');      if (en) en.setAttribute('href', enUrl);
  const d  = document.getElementById('hreflangDefault'); if (d)  d.setAttribute('href', esUrl);
}
// Respaldo de datos estructurados para el listado general o por categoría (si el fetch de
// un producto individual falla o no se abre ningún modal)
function renderStoreItemListLd(cat) {
  let el = document.getElementById('ld-storelist');
  if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ld-storelist'; document.head.appendChild(el); }
  let top = PRODUCTS.filter(p => p.available !== false);
  if (cat) top = top.filter(p => p.cat === cat);
  top = top.slice(0, 30);
  if (!top.length) { el.textContent = ''; return; }
  el.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: top.map((p, i) => ({
      '@type': 'ListItem', position: i + 1,
      url: (__LANG === 'en' ? _STORE_BASE_EN : _STORE_BASE_ES) + 'producto/' + _productSlugFor(p, __LANG) + '/',
      name: (__LANG === 'en' && p.name_en) ? p.name_en : p.name
    }))
  });
}
// Meta/canonical/schema dinámicos para una categoría filtrada — le da a cada ?cat= una
// URL con contenido propio (título, descripción, canonical e ItemList), no solo un filtro
// visual sobre la misma página genérica.
function _updateCategorySeo(cat) {
  const key = cat.toLowerCase();
  const label = t('cat.' + key, cat);
  const desc = CATEGORY_DESC_EN[key]
    || `Handmade ${label} — personalized jewelry in 925 silver, 18k gold plating and stainless steel.`;
  const catSlug = _categorySlug(cat);
  const url = (__LANG === 'en' ? _STORE_BASE_EN : _STORE_BASE_ES) + 'categoria/' + catSlug + '/';
  const title = CATEGORY_TITLE_EN[key] || (label + ' — CACUSA by Taitus');
  const catProducts = PRODUCTS.filter(p => p.cat === cat && p.available !== false);
  const firstImg = catProducts.length ? getProductImages(catProducts[0])[0] : null;
  document.title = title;
  _setMeta('meta-desc', desc);
  _setCanonical(url);
  _setHreflang(_STORE_BASE_ES + 'categoria/' + catSlug + '/', _STORE_BASE_EN + 'categoria/' + catSlug + '/');
  { const h1el = document.querySelector('.store-hero-h'); if (h1el) h1el.textContent = label; }
  _setMeta('og-url', url);
  _setMeta('og-title', title);
  _setMeta('og-description', desc);
  if (firstImg) _setMeta('og-image', firstImg);
  _setMeta('tw-title', title);
  _setMeta('tw-description', desc);
  if (firstImg) _setMeta('tw-image', firstImg);
  const schemaEl = document.getElementById('ld-product');
  if (schemaEl) schemaEl.remove();
  renderStoreItemListLd(cat);
}
// Dispatcher: decide si la URL actual pide una categoría (?cat=) o el listado general,
// y actualiza el SEO en consecuencia. Se llama al cargar, al cambiar de filtro y al
// cerrar el modal de producto (openModal/_injectProductSchema siempre corre después y
// tiene prioridad si además hay un ?p= en la URL).
// Migas + introducción de la página física de una categoría (.static-cat, la genera
// generate_product_pages.py para SEO): solo tienen sentido mientras se ve ESA categoría.
// Al cambiar de categoría (chips, Todo, Atrás) se ocultan, y el texto largo queda en 2
// líneas con "Leer más" para no empujar los productos hacia abajo.
function _syncStaticCat() {
  const sec = document.querySelector('.static-cat');
  if (!sec) return;
  const sc = window.__CACUSA_STATIC_CATEGORY;
  sec.hidden = !(sc && String(activeFilter).toLowerCase() === String(sc).toLowerCase());
  const intro = sec.querySelector('.static-cat-intro');
  if (sec.hidden || !intro || sec.dataset.clampReady) return;
  sec.dataset.clampReady = '1';
  // CLS (wave 1): el CSS ya lo recorta a 2 líneas desde el primer pintado (html.js), así no
  // se encoge de golpe cuando corre este JS; .noclamp lo libera.
  intro.classList.add('clamp');
  if (intro.scrollHeight <= intro.clientHeight + 2) { intro.classList.remove('clamp'); intro.classList.add('noclamp'); return; }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'static-cat-more';
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = __LANG === 'en' ? 'Read more' : 'Leer más';
  btn.addEventListener('click', () => {
    const open = intro.classList.toggle('clamp') === false;
    intro.classList.toggle('noclamp', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? (__LANG === 'en' ? 'Read less' : 'Leer menos') : (__LANG === 'en' ? 'Read more' : 'Leer más');
  });
  intro.after(btn);
}
function _updateListingSeo() {
  _syncStaticCat();
  const catParam = new URLSearchParams(window.location.search).get('cat') || window.__CACUSA_STATIC_CATEGORY || null;
  const match = catParam && CATEGORIES.find(c => c.toLowerCase() === catParam.toLowerCase());
  if (match) _updateCategorySeo(match); else _clearProductSchema();
}
// Atrás/adelante del navegador: cierra el modal de producto si está abierto (B1, UX tanda 2),
// lo reabre si se vuelve hacia adelante a una entrada de modal, y si no sincroniza la
// categoría con la URL.
window.addEventListener('popstate', e => {
  // history.back() lanzado por closeModal(): el modal ya está cerrado, solo falta el SEO del listado.
  if (_modalBackPending) { _modalBackPending = false; _updateListingSeo(); return; }
  if (document.getElementById('modal-overlay').classList.contains('open')) {
    closeModal(true);
    _updateListingSeo();
    return;
  }
  const _st = e.state || {};
  if (_st.modal != null) {
    const _mp = PRODUCTS.find(x => String(x.id) === String(_st.modal));
    if (_mp) { openModal(_mp.id, true); return; }
  }
  // En la página física de una categoría, la URL sin ?cat es esa categoría (no "Todo").
  const catParam = new URLSearchParams(window.location.search).get('cat') || window.__CACUSA_STATIC_CATEGORY || null;
  const match = catParam && CATEGORIES.find(c => c.toLowerCase() === catParam.toLowerCase());
  activeFilter = match || 'all';
  _readUrlFilters();
  document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilter));
  _scrollActiveChipIntoView();
  renderProducts();
  _updateListingSeo();
});
// Réplica exacta de RETURN_POLICY / build_shipping_details() en
// generate_product_schema.py (hallazgo SEO externo, 20 sep): antes,
// _injectProductSchema() reemplazaba el JSON-LD estático por uno nuevo que
// no traía shippingDetails/hasMerchantReturnPolicy — cualquier visita con
// JS corriendo (que es como Google indexa en su segunda pasada) perdía esas
// 2 señales apenas se abría el modal de un producto. Se arman acá con los
// mismos valores reales (config.shipping vía SHIPPING_CFG, misma política
// de devoluciones fija) en vez de leer el bloque estático del DOM, porque
// una segunda apertura de modal en la misma sesión ya vería el bloque
// reemplazado (sin esos campos) y los perdería igual.
const _RETURN_POLICY_LD = {
  '@type': 'MerchantReturnPolicy', applicableCountry: ['EC', 'US'],
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 2, returnMethod: 'https://schema.org/ReturnByMail',
  returnFees: 'https://schema.org/FreeReturn', refundType: 'https://schema.org/ExchangeRefund',
  merchantReturnLink: 'https://cacusabytaitus.com/devoluciones.html'
};
function _seoShippingDetails() {
  const s = SHIPPING_CFG || {};
  const rate = { '@type': 'MonetaryAmount', value: Number(s.cost != null ? s.cost : 10).toFixed(2), currency: 'USD' };
  const handling = { '@type': 'QuantitativeValue', minValue: Number(s.handlingDaysMin || 5), maxValue: Number(s.handlingDaysMax || 10), unitCode: 'DAY' };
  const dest = (country, minV, maxV) => ({
    '@type': 'OfferShippingDetails', shippingRate: rate,
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: country },
    deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: handling,
      transitTime: { '@type': 'QuantitativeValue', minValue: Number(minV), maxValue: Number(maxV), unitCode: 'DAY' } }
  });
  return [
    dest('EC', s.transitDaysEcMin || 1, s.transitDaysEcMax || 2),
    dest('US', s.transitDaysUsMin || 2, s.transitDaysUsMax || 5)
  ];
}
function _injectProductSchema(p) {
  const imgs = getProductImages(p);
  const name = String(((__LANG === 'en' && p.name_en) ? p.name_en : p.name) || '').replace(/\s+/g, ' ').trim();
  const desc = (__LANG === 'en' && p.description_en) ? p.description_en : (p.desc || '');
  const esSlug = _productSlugFor(p, 'es');
  const enSlug = _productSlugFor(p, 'en');
  const url  = (__LANG === 'en' ? _STORE_BASE_EN : _STORE_BASE_ES) + 'producto/' + (__LANG === 'en' ? enSlug : esSlug) + '/';
  // Título y meta description (lo que Google muestra en resultados)
  document.title = _productTitle(name);
  _setMeta('meta-desc', (desc || name).slice(0, 160));
  _setCanonical(url);
  _setHreflang(_STORE_BASE_ES + 'producto/' + esSlug + '/', _STORE_BASE_EN + 'producto/' + enSlug + '/');
  { const h1el = document.querySelector('.store-hero-h'); if (h1el) h1el.textContent = name; }
  // OG + Twitter
  _setMeta('og-url', url);
  _setMeta('og-title', _productTitle(name));
  _setMeta('og-description', desc || name);
  if (imgs.length) _setMeta('og-image', imgs[0]);
  _setMeta('tw-title', _productTitle(name));
  _setMeta('tw-description', desc || name);
  if (imgs.length) _setMeta('tw-image', imgs[0]);
  // BreadcrumbList + Product JSON-LD
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList', itemListElement: [
      // Misma ruta que la página física (generate_product_pages.py): Inicio > Tienda > Categoría > Producto
      { '@type': 'ListItem', position: 1, name: 'CACUSA', item: __LANG === 'en' ? 'https://cacusabytaitus.com/en/' : 'https://cacusabytaitus.com/' },
      { '@type': 'ListItem', position: 2, name: __LANG === 'en' ? 'Store' : 'Tienda', item: _SEO_BASE },
      ...(p.cat ? [{ '@type': 'ListItem', position: 3, name: t('cat.' + p.cat.toLowerCase(), p.cat),
        item: (__LANG === 'en' ? _STORE_BASE_EN : _STORE_BASE_ES) + 'categoria/' + _categorySlug(p.cat) + '/' }] : []),
      { '@type': 'ListItem', position: p.cat ? 4 : 3, name, item: url }
    ]},
    { '@type': 'Product', name, description: desc || name,
      ...(imgs.length ? { image: imgs } : {}),
      ...(p.material ? { material: p.material } : {}),
      sku: String(p.id),
      brand: { '@type': 'Brand', name: 'CACUSA by Taitus' },
      offers: { '@type': 'Offer', priceCurrency: 'USD', price: String(p.price),
        availability: p.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        url, seller: { '@id': _SEO_ORG },
        shippingDetails: _seoShippingDetails(), hasMerchantReturnPolicy: _RETURN_POLICY_LD }
    }
  ]};
  let el = document.getElementById('ld-product');
  if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ld-product'; document.head.appendChild(el); }
  el.textContent = JSON.stringify(schema);
}
function _clearProductSchema() {
  const el = document.getElementById('ld-product'); if (el) el.remove();
  document.title = 'Personalized Jewelry Store | CACUSA by Taitus';
  _setMeta('meta-desc', 'Personalized handmade jewelry: rings, necklaces, bracelets and earrings in 18k gold plating, stainless steel and gold filled. Personalization available. Shipping to the USA and Ecuador.');
  _setCanonical(_SEO_BASE);
  _setHreflang(_STORE_BASE_ES, _STORE_BASE_EN);
  { const h1el = document.querySelector('.store-hero-h'); if (h1el) h1el.textContent = TEXTS.heroTitle; }
  _setMeta('og-url', _SEO_BASE);
  _setMeta('og-title', 'Personalized Jewelry Store | CACUSA by Taitus');
  _setMeta('og-description', 'Rings, necklaces, bracelets and earrings handmade with 18k gold plating, 925 silver and stainless steel. Custom personalization on request. Shipping to the USA and Ecuador.');
  _setMeta('og-image', _SEO_IMG_DEFAULT);
  _setMeta('tw-title', 'Personalized Jewelry Store | CACUSA by Taitus');
  _setMeta('tw-description', 'Handmade rings, necklaces, bracelets and earrings. Custom personalization on request.');
  _setMeta('tw-image', _SEO_IMG_DEFAULT);
  renderStoreItemListLd();
}
function _patchSchemaRating(avg, count, reviews) {
  const el = document.getElementById('ld-product'); if (!el) return;
  try {
    const s = JSON.parse(el.textContent);
    const prod = s['@graph'] ? s['@graph'].find(n => n['@type'] === 'Product') : s;
    if (!prod) return;
    prod.aggregateRating = { '@type': 'AggregateRating', ratingValue: avg.toFixed(1), reviewCount: count, bestRating: '5', worstRating: '1' };
    prod.review = reviews.slice(0, 5).map(rv => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: rv.name || 'Anónimo' },
      reviewRating: { '@type': 'Rating', ratingValue: String(rv.rating || 5), bestRating: '5', worstRating: '1' },
      reviewBody: rv.comment || '', datePublished: rv.date || ''
    }));
    el.textContent = JSON.stringify(s);
  } catch(_) {}
}

// ─── REVIEWS ──────────────────────────────────────────────
function setRevRating(n) {
  _revRating = n;
  document.querySelectorAll('#revStarPicker .sp-star').forEach((s, i) => {
    s.classList.toggle('lit', i < n);
    s.setAttribute('aria-checked', i === n - 1 ? 'true' : 'false');
    s.tabIndex = i === n - 1 ? 0 : -1;
  });
}
function starKeydown(e) {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
  const next = Math.min(5, Math.max(1, _revRating + dir));
  setRevRating(next);
  document.querySelectorAll('#revStarPicker .sp-star')[next - 1].focus();
}
document.getElementById('revStarPicker').addEventListener('mouseover', e => {
  if (!e.target.classList.contains('sp-star')) return;
  const idx = [...e.target.parentElement.children].indexOf(e.target);
  document.querySelectorAll('#revStarPicker .sp-star').forEach((s, i) => s.classList.toggle('lit', i <= idx));
});
document.getElementById('revStarPicker').addEventListener('mouseleave', () => setRevRating(_revRating));

async function loadProductReviews(productId) {
  const list = document.getElementById('revList');
  const avgRow = document.getElementById('revAvgRow');
  const section = list.closest('.reviews-section');
  if (section) section.hidden = false;
  list.innerHTML = `<div class="no-reviews" style="color:var(--ink-muted)">…</div>`;
  try {
    let reviews, avg, count;
    const pub = await _fetchPubReviews();
    // Otro producto abierto mientras esperábamos: no pisar su lista.
    if (!currentProduct || String(currentProduct.id) !== String(productId)) return;
    if (pub) {
      const entry = pub[String(productId)];
      reviews = _pubReviewItems(entry);
      count = Math.floor(Number(entry && entry.count) || 0) || reviews.length;
      avg = Number(entry && entry.avg) || 0;
    } else {
      const r = await fetch(_fbUrl(`https://cacusa-pos-default-rtdb.firebaseio.com/cacusa_reviews/${productId}.json`));
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!currentProduct || String(currentProduct.id) !== String(productId)) return;
      // approved !== false: las reseñas anteriores a la moderación no tienen el campo
      // y siguen visibles; solo se ocultan las nuevas mientras esperan aprobación.
      reviews = (data && typeof data === 'object' ? Object.values(data) : []).filter(v => v && v.comment && v.approved !== false).sort((a, b) => (b.date||'').localeCompare(a.date||''));
      count = reviews.length;
      avg = count ? reviews.reduce((s, v) => s + (v.rating || 5), 0) / count : 0;
    }
    if (!reviews.length) {
      list.innerHTML = `<div class="no-reviews">${__LANG === 'en' ? 'No reviews yet. Be the first!' : 'Aún sin reseñas. ¡Sé el primero/a!'}</div>`;
      avgRow.style.display = 'none'; return;
    }
    if (!(avg >= 1 && avg <= 5)) avg = reviews.reduce((s, v) => s + (v.rating || 5), 0) / reviews.length;
    avgRow.style.display = 'flex';
    document.getElementById('revScore').textContent = avg.toFixed(1);
    document.getElementById('revStarsDisplay').innerHTML = renderStars(avg);
    document.getElementById('revCountText').textContent = `(${count})`;
    _patchSchemaRating(avg, count, reviews);
    list.innerHTML = reviews.slice(0, 5).map(rv => `
      <div class="review-item">
        <div class="review-top">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="review-name">${esc(rv.name||'Anónimo')}</span>
            <span class="stars-row">${renderStars(rv.rating||5)}</span>
          </div>
          <span class="review-date">${esc(rv.date||'')}</span>
        </div>
        <div class="review-text">${esc(rv.comment)}</div>
      </div>`).join('');
  } catch(_) {
    // Sin conexión con las reseñas: se oculta el bloque entero en vez de mostrar un error.
    list.innerHTML = '';
    avgRow.style.display = 'none';
    if (section) section.hidden = true;
  }
}

async function submitReview() {
  if (!currentProduct) return;
  const name = document.getElementById('revName').value.trim().slice(0, 60);
  const comment = document.getElementById('revComment').value.trim().slice(0, 600);
  const rating = Math.min(5, Math.max(1, Math.round(Number(_revRating) || 0)));
  if (!name || !comment || rating < 1) {
    showToast(__LANG==='en'?'Please fill all fields and pick a rating ★':'Completa nombre, comentario y calificación ★'); return;
  }
  // Anti-spam básico: 1 reseña cada 30s desde este navegador (Firebase es abierto; esto frena envíos accidentales/repetidos)
  const _lastRev = parseInt(__LS.getItem('cacusa-last-review') || '0', 10);
  if (Date.now() - _lastRev < 30000) {
    showToast(__LANG==='en'?'Please wait a moment before submitting again.':'Espera un momento antes de enviar otra reseña.'); return;
  }
  const btn = document.getElementById('revSubmitBtn');
  btn.disabled = true; btn.textContent = '…';
  try {
    // Wave 1: la reseña va al Worker (POST /review/submit), que valida, limita la frecuencia
    // (429) y la guarda pendiente de aprobación. Solo si el Worker todavía no tiene la ruta
    // (404, no desplegado) se usa la escritura directa a Firebase de antes.
    let res = await fetchT(ADMIN_WORKER_URL + '/review/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: String(currentProduct.id), name, rating, comment, lang: __LANG })
    }, 10000);
    if (res.status === 404) {
      res = await fetch(_fbUrl(`https://cacusa-pos-default-rtdb.firebaseio.com/cacusa_reviews/${encodeURIComponent(currentProduct.id)}.json`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // approved:false — la reseña no se muestra hasta que Tita o Robin la aprueben
        // desde el panel. Las reglas de Firebase exigen este valor al crear, así que
        // nadie puede auto-aprobarse mandando la reseña por fuera del sitio.
        body: JSON.stringify({ name, rating, comment, approved: false, date: new Date().toISOString().slice(0,10) })
      });
    } else if (res.status === 429) {
      showToast(__LANG==='en'?'Too many reviews from this connection. Please try again later.':'Recibimos varias reseñas desde aquí. Intenta de nuevo más tarde.');
      btn.disabled = false;
      btn.textContent = __LANG === 'en' ? 'Submit' : 'Enviar';
      return;
    } else if (res.ok) {
      const d = await res.json().catch(() => null);
      if (!d || d.ok !== true) throw new Error();
    }
    if (!res.ok) throw new Error();
    __LS.setItem('cacusa-last-review', String(Date.now()));
    document.getElementById('revName').value = '';
    document.getElementById('revComment').value = '';
    setRevRating(5);
    showToast(__LANG==='en'?'✓ Review submitted! It will appear once we review it.':'✓ ¡Reseña enviada! Se publica apenas la revisemos.');
    // No se toca el promedio local: la reseña todavía no está aprobada, así que
    // mostrarla ya contada daría una calificación que no es la real.
    await loadProductReviews(currentProduct.id);
  } catch(_) {
    showToast(__LANG==='en'?'Could not submit. Try again.':'No se pudo enviar. Intenta de nuevo.');
  }
  btn.disabled = false;
  btn.textContent = __LANG === 'en' ? 'Submit' : 'Enviar';
}

// ─── GIFT CARDS ───────────────────────────────────────────────
async function applyGiftCard() {
  const raw = (document.getElementById('gcCodeInput').value || '').trim().toUpperCase().replace(/\s/g,'');
  const msgEl = document.getElementById('gcMsg');
  if (!raw) { msgEl.className='gc-msg err'; msgEl.textContent=(__LANG==='en'?'Enter a gift card code.':'Ingresa un código de tarjeta de regalo.'); return; }
  const btn = document.getElementById('gcApplyBtn');
  btn.disabled = true;
  msgEl.className='gc-msg'; msgEl.textContent='…';
  try {
    // Validación server-side: el worker lee KV (privado). El navegador nunca ve otros códigos.
    const res  = await fetch(ADMIN_WORKER_URL + '/giftcard/validate', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ code: raw })
    });
    const data = res.ok ? await res.json() : null;
    if (!data || !data.valid || !(Number(data.balance) > 0)) {
      msgEl.className='gc-msg err';
      msgEl.textContent=(__LANG==='en'?'Invalid or already used code.':'Código no válido o ya utilizado.');
      _gcCode=null; _gcBalance=0; _gcApplied=0;
    } else {
      _gcCode=raw; _gcBalance=Number(data.balance);
      msgEl.className='gc-msg ok';
      msgEl.textContent=`✓ $${_gcBalance.toFixed(2)} ${__LANG==='en'?'credit applied':'de crédito aplicado'}`;
    }
  } catch(_) {
    msgEl.className='gc-msg err';
    msgEl.textContent=(__LANG==='en'?'Error verifying code. Try again.':'Error al verificar. Intenta de nuevo.');
  }
  btn.disabled=false;
  renderCheckoutSummary();
}

// ─── COUPONS ──────────────────────────────────────────────────
async function applyCoupon() {
  const raw = (document.getElementById('cpCodeInput').value || '').trim().toUpperCase().replace(/\s/g,'');
  const msgEl = document.getElementById('cpMsg');
  if (!raw) { msgEl.className='gc-msg err'; msgEl.textContent=(__LANG==='en'?'Enter a coupon code.':'Ingresa un código de cupón.'); return; }
  const btn = document.getElementById('cpApplyBtn');
  btn.disabled = true;
  msgEl.className='gc-msg'; msgEl.textContent='…';
  try {
    const telVal = (document.getElementById('coTel').value || '').trim();
    const emailVal = (document.getElementById('coEmail').value || '').trim();
    const res = await fetch(ADMIN_WORKER_URL + '/coupon/validate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code: raw, phone: telVal || undefined, email: emailVal || undefined })
    });
    const data = res.ok ? await res.json() : null;
    if (!data || !data.valid) {
      msgEl.className='gc-msg err';
      msgEl.textContent=(__LANG==='en'?'Invalid or expired coupon.':'Cupón inválido o vencido.');
      btn.disabled=false; return;
    }
    _cpCode=data.code; _cpType=data.type; _cpAmount=data.amount;
    renderCheckoutSummary();
    const disc = _cpIsFreeShip() ? (__LANG==='en' ? 'FREE SHIPPING' : 'ENVÍO GRATIS')
      : _cpType==='percent' ? `${_cpAmount}% OFF` : `$${_cpAmount.toFixed(2)} OFF`;
    msgEl.className='gc-msg ok';
    msgEl.textContent=(__LANG==='en' ? `✓ Applied: ${disc}` : `✓ Aplicado: ${disc}`);
  } catch(_) {
    msgEl.className='gc-msg err';
    msgEl.textContent=(__LANG==='en'?'Could not verify coupon.':'No se pudo verificar el cupón.');
  }
  btn.disabled=false;
}

// Se llama SOLO después de confirmar que el pedido se guardó (ver los 2 checkouts) —
// antes se llamaba en paralelo con submitOrder, así que un pedido que nunca se guardó
// igual quemaba el cupón de la clienta. Requiere orderId (auditoría externa, 19 sep):
// admin-worker.js ahora verifica que ese pedido exista de verdad y que su
// cuponAplicado coincida con este código antes de consumirlo, en vez de aceptar
// cualquier request con un Origin permitido.
async function burnCoupon(code, phone, email, orderId) {
  if (!code || orderId == null) return;
  try {
    await fetch(ADMIN_WORKER_URL + '/coupon/burn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, phone: phone || '', email: email || '', orderId })
    });
  } catch (e) {}
}

// PWA: registrar service worker + botón de instalación
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'flex';
});
document.getElementById('installBtn')?.addEventListener('click', async () => {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('installBtn').style.display = 'none';
    _installPrompt = null;
  }
});
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
  _installPrompt = null;
});

// ── Mobile nav drawer ─────────────────────────────────────────
(function(){
  const btn   = document.getElementById('navMenuBtn');
  const drawer= document.getElementById('navDrawer');
  const close = document.getElementById('navDrawerClose');
  if (!btn || !drawer) return;
  let _navReleaseTrap = null;

  function openDrawer(){
    drawer.classList.add('open');
    btn.classList.add('open');
    btn.setAttribute('aria-expanded','true');
    btn.setAttribute('aria-label','Close menu');
    document.body.style.overflow='hidden';
    _navReleaseTrap = trapFocus(drawer, closeDrawer);
  }
  function closeDrawer(){
    drawer.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded','false');
    btn.setAttribute('aria-label','Open menu');
    document.body.style.overflow='';
    if (_navReleaseTrap) { _navReleaseTrap(); _navReleaseTrap = null; }
  }

  window._closeNavDrawer = () => { if (drawer.classList.contains('open')) closeDrawer(); };
  btn.addEventListener('click', () => drawer.classList.contains('open') ? closeDrawer() : openDrawer());
  if (close) close.addEventListener('click', closeDrawer);
  drawer.querySelectorAll('.drawer-link').forEach(a => a.addEventListener('click', closeDrawer));
})();

// ── Captura de lead (compartida por el vignette y el checkout) ── Devuelve una promesa
// con true/false: el checkout la sigue usando fire-and-forget (no le importa el
// resultado, es solo tracking de abandono), pero el vignette SÍ necesita saber si de
// verdad se registró antes de decirle a la clienta "revisa tu correo" (ver más abajo).
async function registerLead(email, source, cartData, total) {
  if (!email) return false;
  if (source === 'cart_checkout_start') _abandonLeadEmail = email;
  try {
    const r = await fetch(ADMIN_WORKER_URL + '/lead/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, lang: __LANG, source, cart: cartData, total })
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// ── VIGNETTE (10% descuento) — clave propia, independiente del landing ──
let _vigReleaseTrap = null;
(function(){
  const vig = document.getElementById('vignette');
  if (!vig) return;
  // Fix (20 sep): esta tienda usaba su propia llave (cacusa-vig-store), distinta de la
  // que usa index.html/en/index.html (cacusa-vig2) — poner el email en el home no le
  // avisaba a la tienda, así que la clienta volvía a ver el popup acá aunque ya se
  // hubiera registrado en el home. Ahora comparten la misma llave (cacusa-vig); la
  // migración hereda el estado de cualquiera de las 2 llaves viejas para que nadie que
  // ya haya interactuado (acá o en el home) vuelva a ver el popup una vez más.
  if (!__LS.getItem('cacusa-vig') && (__LS.getItem('cacusa-vig2') || __LS.getItem('cacusa-vig-store'))) {
    __LS.setItem('cacusa-vig', '1');
  }
  // Se abre por intención, no por temporizador: 50% de scroll, después de ver 2 productos
  // en la sesión (al cerrar el segundo), o con el mouse saliendo por arriba en escritorio.
  // Como máximo una vez por sesión, nunca encima de otro panel abierto, y nunca en los
  // primeros segundos si la clienta acaba de llegar desde afuera (buscador) directo a un
  // producto — que primero lo vea.
  const _VIG_SESSION_KEY = 'cacusa-vig-session';
  const _sessGet = k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
  const _sessSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
  let _landedOnProduct = false;
  try {
    _landedOnProduct = !!(new URLSearchParams(location.search).get('p') || window.__CACUSA_STATIC_PRODUCT_ID) &&
      (!document.referrer || new URL(document.referrer).origin !== location.origin);
  } catch (_) {}
  const _vigNotBefore = Date.now() + (_landedOnProduct ? 20000 : 0);
  const _overlayOpen = () => ['modal-overlay', 'checkout-overlay', 'success-overlay', 'cart-drawer', 'navDrawer', 'wish-drawer', 'lightbox']
    .some(id => { const el = document.getElementById(id); return el && (el.classList.contains('open') || el.classList.contains('show')); });
  function _vigBlocked() { return !!(__LS.getItem('cacusa-vig') || _sessGet(_VIG_SESSION_KEY)); }
  function _vigScrollCheck() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h > 0 && window.scrollY / h >= 0.5) tryOpenVig();
  }
  function _vigExitIntent(e) { if (!e.relatedTarget && e.clientY <= 0) tryOpenVig(); }
  function _vigDetach() {
    window.removeEventListener('scroll', _vigScrollCheck);
    document.removeEventListener('mouseout', _vigExitIntent);
  }
  function tryOpenVig() {
    if (_vigBlocked()) { _vigDetach(); return; }
    if (vig.classList.contains('show') || Date.now() < _vigNotBefore || _overlayOpen()) return;
    _vigDetach();
    openVig();
  }
  // Lo llama closeModal(): cuenta productos vistos en la sesión
  window._vigProductViewed = function () {
    const n = (parseInt(_sessGet('cacusa-vig-views') || '0', 10) || 0) + 1;
    _sessSet('cacusa-vig-views', String(n));
    if (n >= 2) setTimeout(tryOpenVig, 600);
  };
  function openVig() {
    _sessSet(_VIG_SESSION_KEY, '1');
    vig.classList.add('show');
    _vigReleaseTrap = trapFocus(vig, closeVig);
  }
  function closeVig() {
    vig.classList.remove('show');
    __LS.setItem('cacusa-vig', '1');
    if (_vigReleaseTrap) { _vigReleaseTrap(); _vigReleaseTrap = null; }
  }
  if (!_vigBlocked()) {
    window.addEventListener('scroll', _vigScrollCheck, { passive: true });
    if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) document.addEventListener('mouseout', _vigExitIntent);
  }
  [document.getElementById('vigClose'), document.getElementById('vigSkip')].forEach(el => el && el.addEventListener('click', closeVig));
  const vigBtn = document.getElementById('vigBtn');
  if (vigBtn) vigBtn.addEventListener('click', async () => {
    const emailEl = document.getElementById('vigEmail');
    const email = (emailEl ? emailEl.value : '').trim();
    if (!email) { if (emailEl) { emailEl.style.borderColor = '#C0336E'; emailEl.placeholder = __LANG === 'en' ? 'Enter your email first' : 'Escribe tu correo primero'; emailEl.focus(); } return; }
    const skipEl = document.getElementById('vigSkip');
    const msgEl = document.getElementById('vigMsg');
    // Deshabilita de inmediato — evita doble envío mientras se espera la respuesta real
    // (antes se mostraba "listo" apenas se disparaba el fetch, sin esperar nada: un
    // error de red le mentía a la clienta que ya tenía su código, sin forma de reintentar).
    vigBtn.disabled = true;
    if (emailEl) emailEl.disabled = true;
    // El código de bienvenida ahora llega solo por correo (Gmail API, admin-worker.js) —
    // ya no hace falta coordinar por WhatsApp, así que solo registramos el lead.
    const sent = await registerLead(email, 'vignette');
    if (sent) {
      if (emailEl) emailEl.style.display = 'none';
      vigBtn.style.display = 'none';
      if (skipEl) skipEl.style.display = 'none';
      if (msgEl) {
        msgEl.setAttribute('role', 'status'); msgEl.setAttribute('aria-live', 'polite');
        msgEl.textContent = __LANG === 'en' ? '✓ Check your email — we just sent your 10% code.' : '✓ Revisa tu correo — te acabamos de enviar tu código de 10%.';
        msgEl.hidden = false;
      }
      setTimeout(closeVig, 2400);
    } else {
      vigBtn.disabled = false;
      if (emailEl) emailEl.disabled = false;
      if (msgEl) {
        msgEl.setAttribute('role', 'alert'); msgEl.setAttribute('aria-live', 'assertive');
        msgEl.textContent = __LANG === 'en' ? '✕ Something went wrong — try again.' : '✕ Algo falló — intenta de nuevo.';
        msgEl.hidden = false;
      }
    }
  });
})();

// ── Restaurar carrito desde el correo de recordatorio (?cart=id:qty,id:qty) ──
// Solo ids del catálogo cargado, cantidades 1–MAX_QTY, máx. 20 líneas; agotadas o
// inexistentes se ignoran. Nunca trae precios ni nombres del link: salen de PRODUCTS.
const CART_RESTORE_MAX = 20;
function _parseCartParam(raw) {
  const out = [];
  if (typeof raw !== 'string' || raw.length > 800) return out;
  for (const part of raw.split(',')) {
    if (out.length >= CART_RESTORE_MAX) break;
    const m = /^([A-Za-z0-9_-]{1,50})(?::(\d{1,2}))?$/.exec(part.trim());
    if (!m) continue;
    const q = m[2] ? parseInt(m[2], 10) : 1;
    if (!(q >= 1 && q <= MAX_QTY)) continue;
    out.push({ id: m[1], qty: q });
  }
  return out;
}
function _restoreCartFromUrl() {
  let u; try { u = new URL(window.location.href); } catch (_) { return; }
  const raw = u.searchParams.get('cart');
  if (raw == null) return;
  u.searchParams.delete('cart');
  try { history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (_) {}
  let added = 0, skipped = 0;
  for (const { id, qty: q } of _parseCartParam(raw)) {
    const prod = PRODUCTS.find(p => String(p.id) === id);
    if (!prod || prod.available === false) { skipped++; continue; }
    const material = prod.material || '';
    const line = cart.find(it => !it.isCombo && String(it.id) === id && !it.personalization && (it.material || '') === material);
    if (line) { line.qty = Math.min(MAX_QTY, Math.max(line.qty || 1, q)); added++; continue; }
    cart.push({ ...prod, personalization: '', material, cartId: Date.now() + added, qty: q });
    added++;
  }
  if (added) {
    saveCart(); updateCartUI(); openCart();
    showToast(__LANG === 'en' ? '✓ We restored your cart' : '✓ Recuperamos tu carrito', 3500);
  } else if (skipped) {
    showToast(__LANG === 'en' ? 'The pieces from your cart are no longer available.' : 'Las piezas de tu carrito ya no están disponibles.', 4000);
  }
}

// ── Link del pedido de reseña: la ficha con #resena (o ?review=1) abre el formulario ──
function _wantsReviewForm() {
  const h = String(location.hash || '').toLowerCase();
  return h === '#resena' || h === '#review' || new URLSearchParams(location.search).get('review') === '1';
}
function _openReviewForm() {
  const form = document.querySelector('.review-form');
  if (!form) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    const first = form.querySelector('.sp-star[tabindex="0"]') || document.getElementById('revName');
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); } }
  }, 450);
}

// ── Captura de lead en checkout (recuperación de abandono) ──
(function(){
  const emailInput = document.getElementById('coEmail');
  if (!emailInput) return;
  const remindBox = document.getElementById('coRemind');
  const EMAIL_OK = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[a-z]{2,}$/i;
  // Consentimiento (wave 1, auditoría): el email + el carrito se mandan a /lead/register
  // (carrito abandonado del panel) SOLO si la clienta marcó "Te podemos enviar un
  // recordatorio…" (#coRemind, desmarcado por defecto) — antes se mandaban al salir del
  // campo de email aunque la casilla estuviera desmarcada. Si la marca después de escribir
  // el email, se registra en ese momento; si la desmarca, se cancela (mismo criterio que
  // /cart/pending más abajo, que manda remind:false para borrar lo guardado).
  let _leadSent = null; // email registrado en esta sesión de checkout
  function syncLead() {
    const email = emailInput.value.trim().toLowerCase();
    const ok = !!remindBox && remindBox.checked && email.length <= 100 && EMAIL_OK.test(email) && cart.length > 0;
    if (ok && _leadSent !== email) {
      _leadSent = email;
      const cartData = cart.map(i => ({ name: i.name + (i.qty > 1 ? ' ×' + i.qty : ''), price: i.price * (i.qty || 1) }));
      const total = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
      registerLead(email, 'cart_checkout_start', cartData, total);
    } else if (!ok && _leadSent && remindBox && !remindBox.checked) {
      const prev = _leadSent;
      _leadSent = null;
      if (_abandonLeadEmail === prev) _abandonLeadEmail = null;
      fetch(ADMIN_WORKER_URL + '/lead/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ email: prev }),
      }).catch(() => {});
    }
  }
  emailInput.addEventListener('blur', syncLead);
  if (remindBox) remindBox.addEventListener('change', syncLead);
  // Carrito pendiente para UN recordatorio por correo (nov) — solo con el permiso marcado
  // (#coRemind, desmarcado por defecto). Nunca por tecla: al salir del campo de email o al
  // cambiar el permiso, con debounce, y como mucho 3 veces por sesión (solo si cambió el
  // email, el carrito o el permiso). Manda solo email, idioma e ids + cantidades.
  if (!remindBox) return;
  let timer = null, lastSig = '', sends = 0, stored = false;
  function sendPending() {
    timer = null;
    const email = emailInput.value.trim().toLowerCase();
    if (email.length > 100 || !EMAIL_OK.test(email)) return;
    const remind = !!remindBox.checked;
    const items = cart.filter(i => !i.isCombo && /^[A-Za-z0-9_-]{1,50}$/.test(String(i.id)))
      .slice(0, 20).map(i => ({ id: String(i.id), qty: Math.min(MAX_QTY, Math.max(1, i.qty || 1)) }));
    if (!remind && !stored) return;           // sin permiso y nada guardado: no se manda nada
    if (remind && !items.length) return;
    const sig = remind ? email + '|' + JSON.stringify(items) : email + '|off';
    if (sig === lastSig || sends >= 3) return;
    lastSig = sig; sends++; stored = remind;
    _pendingCartEmail = remind ? email : null;
    fetch(ADMIN_WORKER_URL + '/cart/pending', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ email, lang: __LANG, items, remind }),
    }).catch(() => {});
  }
  function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(sendPending, 800); }
  emailInput.addEventListener('blur', schedule);
  remindBox.addEventListener('change', schedule);
})();
