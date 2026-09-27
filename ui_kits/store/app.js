// JavaScript de la tienda (ES) — extraído del <script> en línea el 27 sep para que
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
const __LANG = localStorage.getItem('cacusa-lang') || 'es';
const __EN_T = {
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
  const _sortOpts = {default:'Sort: Featured','price-asc':'Price: low to high','price-desc':'Price: high to low',new:'Newest'};
  document.querySelectorAll('#sortSelect option').forEach(o => { if (_sortOpts[o.value]) o.textContent = _sortOpts[o.value]; });
  const _phs = {modalPersonText:'Name, date or special message…',coNombre:'First Name',coApellido:'Last Name',coTel:'(555) 123-4567',coNotas:'Color, size, special detail…'};
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
const CATEGORY_DESC_ES = {
  cadenas: 'Cadenas y collares artesanales en plata 925, baño de oro 18k y acero inoxidable — con dijes y personalización disponible por WhatsApp.',
  aretes: 'Aretes artesanales personalizados en plata 925, baño de oro 18k y acero inoxidable — desde argollas hasta ear cuffs.',
  anillos: 'Anillos artesanales ajustables y de talla fija en plata 925, baño de oro 18k y acero inoxidable — grabado personalizado disponible.',
  hombres: 'Joyería para hombre: cadenas, anillos y pulseras en acero inoxidable y baño de oro 18k, resistentes para el uso diario.',
  pulseras: 'Pulseras artesanales tejidas y en cadena, en plata 925, baño de oro 18k y acero inoxidable — con opción de personalización.',
  'ear cuff': 'Ear cuffs artesanales sin necesidad de perforación, en baño de oro 18k y acero inoxidable, para un look moderno.',
  parejas: 'Piezas a juego para parejas — anillos, cadenas y pulseras que se complementan, ideales para regalar en San Valentín o aniversario.',
  juegos: 'Juegos y sets de joyería a conjunto (aretes, cadena y pulsera) en plata 925 y baño de oro 18k, listos para regalar.',
  'hand chain': 'Hand chains artesanales que combinan anillo y pulsera en una sola pieza, en baño de oro 18k y acero inoxidable.',
};
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
const CATEGORY_TITLE_ES = {
  "cadenas": "Cadenas y collares personalizados | CACUSA by Taitus",
  "aretes": "Aretes artesanales y personalizados | CACUSA by Taitus",
  "anillos": "Anillos personalizados y ajustables | CACUSA by Taitus",
  "hombres": "Joyería para hombre en acero y oro 18k | CACUSA by Taitus",
  "pulseras": "Pulseras artesanales personalizadas | CACUSA by Taitus",
  "ear cuff": "Ear cuffs sin perforación | CACUSA by Taitus",
  "parejas": "Joyas para parejas a juego | CACUSA by Taitus",
  "juegos": "Sets de joyería para regalar | CACUSA by Taitus",
  "hand chain": "Hand chains artesanales | CACUSA by Taitus"
};
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
  heroLabel: 'Compra joyería personalizada online',
  heroTitle: 'Nuestra Tienda',
  heroSubtitle: 'by Taitus',
  instagram: '@cacusabytaitus',
  perks: ['Hecho a mano', 'Envío express', '5–10 días hábiles', 'Empaque especial para regalo']
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
let cart = JSON.parse(localStorage.getItem('cacusa-cart') || '[]');
let currentProduct = null, qty = 1, activeFilter = 'all', searchTerm = '';
// Mientras esta bandera sea false y no haya búsqueda activa, la primera pantalla muestra
// las categorías en vez de los 74 productos juntos — se "apaga" en cuanto la clienta elige
// una categoría, busca algo, o pide ver todo el catálogo.
let _categoryPickerDismissed = false;
// Activa un div/span con role="button" desde el teclado (Enter/Espacio) — reusado por
// todas las tarjetas clicables que no son <a>/<button> nativos (category picker,
// relacionados, miniaturas de galería/lightbox).
function activateOnKey(e, fn) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
}
// Función compartida entre los botones de filtro de la cabecera y las tarjetas de
// categoría de la primera pantalla — ambos caminos llevan al mismo resultado.
function selectCategory(cat) {
  _categoryPickerDismissed = true;
  activeFilter = cat;
  document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === cat));
  renderProducts();
  // Cada categoría pasa a tener su propia URL (?cat=), no solo un filtro visual —
  // así queda indexable y compartible por separado, no solo la tienda genérica.
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
    '<span role="alert">✕ ' + t('store.catalogError', 'No pudimos cargar el catálogo. Recarga la página o escríbenos por WhatsApp.') +
    ' <a href="https://wa.me/17867375336" target="_blank" rel="noopener" style="text-decoration:underline;color:inherit">WhatsApp</a></span>',
    9000
  );
}
// ─── LOAD DATA ──────────────────────────────────────────────
(async function loadData() {
  try {
    const res = await fetch(PRODUCTS_JSON_URL);
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
    if (cfg.texts && typeof cfg.texts === 'object') TEXTS = { ...TEXTS, ...cfg.texts };
    if (__LANG === 'en' && cfg.texts_en && typeof cfg.texts_en === 'object') TEXTS = { ...TEXTS, ...cfg.texts_en };
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
  // Apply per-product surcharges desde el worker (best-effort, non-blocking)
  try {
    const _srRes = await fetch(ADMIN_WORKER_URL + '/pub/surcharges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (_srRes.ok) {
      const _srData = await _srRes.json();
      const _sr = _srData.surcharges;
      if (_sr && typeof _sr === 'object') {
        PRODUCTS.forEach(p => {
          if (_sr[p.id] === true) {
            p.price = Math.round(p.basePrice * 1.04 * 100) / 100;
            p.hasSurcharge = true;
          }
        });
      }
    }
  } catch(_) {}
  // Apply active promos (overrides surcharge: promo price IS the final price)
  const _now = new Date();
  PRODUCTS.forEach(p => {
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
  // Apply per-product markets + detect visitor country via IP (best-effort, non-blocking)
  try {
    const [_mktRes, _ipRes] = await Promise.all([
      fetch(ADMIN_WORKER_URL + '/pub/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch('https://api.country.is/')
    ]);
    if (_mktRes.ok) {
      const _mktData = await _mktRes.json();
      const _mkt = _mktData.markets;
      if (_mkt && typeof _mkt === 'object') {
        window.__markets = _mkt;
        PRODUCTS.forEach(p => { p.market = _mkt[p.id] || 'both'; });
      }
    }
    if (_ipRes.ok) {
      const _ip = await _ipRes.json();
      if (_ip && _ip.country) window.__visitorCountry = _ip.country;
    }
  } catch(_) {}
  // Re-sincroniza el carrito con precios canónicos (evita precios obsoletos
  // o manipulados en localStorage; el cobro real igual se valida en el backend)
  reconcileCartPrices();
  applyTexts();
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
})();

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
  if (changed || cart.length !== JSON.parse(localStorage.getItem('cacusa-cart') || '[]').length) saveCart();
}

// ─── APLICAR CONFIG DINÁMICA ────────────────────────────────
function applyTexts() {
  const set = (sel, val) => { const el = document.querySelector(sel); if (el && val != null) el.textContent = val; };
  set('.store-hero-label', TEXTS.heroLabel);
  set('.store-hero-h', TEXTS.heroTitle);
  set('.store-hero-s', TEXTS.heroSubtitle);
  const ig = document.getElementById('igHandle');
  if (ig && TEXTS.instagram) ig.textContent = TEXTS.instagram;
  const perksEl = document.querySelector('.modal-perks');
  if (perksEl && Array.isArray(TEXTS.perks)) {
    perksEl.innerHTML = TEXTS.perks.map(p =>
      '<div class="perk"><div class="perk-dot"></div>' + p + '</div>').join('');
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
    ? 'Free shipping on orders over $' + threshold
    : 'Envío gratis en pedidos desde $' + threshold;
  el.style.display = 'block';
}
function renderFilters() {
  const wrap = document.getElementById('filterBtns');
  if (!wrap) return;
  wrap.innerHTML = '<button class="filter-btn active" data-filter="all">' + t('store.all', 'Todo') + '</button>' +
    CATEGORIES.map(c => '<button class="filter-btn" data-filter="' + c + '">' + t('cat.' + c.toLowerCase(), c) + '</button>').join('');
  wrap.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => selectCategory(btn.dataset.filter));
  });
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
    }
  }
}
function renderMaterials() {} // material fijo por producto, no seleccionable

// ─── CURSOR ─────────────────────────────────────────────────
const cur = document.getElementById('cursor');
const ring = document.getElementById('cursor-ring');
let mx = 0, my = 0, rx = 0, ry = 0;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  cur.style.left = (mx - 5) + 'px';
  cur.style.top = (my - 5) + 'px';
});
(function animRing() {
  rx += (mx - rx - 16) * .14;
  ry += (my - ry - 16) * .14;
  ring.style.left = rx + 'px';
  ring.style.top = ry + 'px';
  requestAnimationFrame(animRing);
})();

function refreshCursorTargets() {
  document.querySelectorAll('button,a,.pcard,.filter-btn').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-grow'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-grow'));
  });
}

// ─── IMAGE HELPERS ───────────────────────────────────────────
// Escapa texto/atributos antes de interpolar en innerHTML (evita romper el HTML y self-XSS)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// focalX/focalY/zoom vienen de products.json y van dentro de style= — forzar número y rango
function _focal(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50; }
function _zoom(v)  { const n = Number(v); return Number.isFinite(n) ? Math.max(0.5, Math.min(4, n)) : 1; }
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
// Barrido SEO (19 sep): las tarjetas de la tienda no tenían ningún <a href> real hacia el
// producto — todo era onclick sobre <div>/<button>, invisible para un rastreador que no
// ejecuta JS. _pcardHref() arma la URL real (misma que usa _injectProductSchema como
// canonical); _pcardNav() deja que un clic normal siga abriendo el modal al instante (sin
// recargar la página), pero un clic con Ctrl/Cmd/rueda del mouse navega de verdad a la URL
// real (nueva pestaña) — comportamiento estándar de cualquier enlace.
function _pcardHref(p) {
  return (__LANG === 'en' ? '/en' : '') + '/ui_kits/store/producto/' + _productParam(p) + '/';
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
    const altText = alt ? alt + ' — joyería artesanal personalizada CACUSA' : 'Joyería artesanal personalizada CACUSA';
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
  refreshCursorTargets();
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
function renderProducts() {
  const grid = document.getElementById('prodGrid');
  if (activeFilter === 'all' && !searchTerm && !_categoryPickerDismissed) { renderCategoryPicker(); return; }
  _clearCatTileTimers();
  grid.className = 'prod-grid';
  let filtered = activeFilter === 'all'
    ? PRODUCTS
    : PRODUCTS.filter(p => p.cat === activeFilter || (p.cat || '').startsWith(activeFilter));
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    filtered = filtered.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.name_en || '').toLowerCase().includes(q) ||
      (p.desc || '').toLowerCase().includes(q) ||
      (p.cat || '').toLowerCase().includes(q)
    );
  }
  const sort = document.getElementById('sortSelect').value;
  if (sort === 'price-asc') filtered = [...filtered].sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') filtered = [...filtered].sort((a, b) => b.price - a.price);
  else filtered = [...filtered].sort((a, b) => {
    const sa = a.available === false ? 2 : (a.badge === 'badge-sale' || a.badge === 'badge-promo' || a.isPromo) ? 0 : 1;
    const sb = b.available === false ? 2 : (b.badge === 'badge-sale' || b.badge === 'badge-promo' || b.isPromo) ? 0 : 1;
    return sa - sb;
  });
  if (filtered.length === 0) {
    const msg = searchTerm
      ? 'No hay productos que coincidan con "' + esc(searchTerm) + '".'
      : t('store.emptyCategory', 'No hay productos en esta categoría aún.');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 0;font-family:var(--fe);font-size:18px;font-style:italic;color:var(--ink-muted)">' + msg + '</div>';
    return;
  }
  grid.innerHTML = filtered.map((p, i) => `
    <div class="pcard${p.available === false ? ' pcard--soldout' : ''}" style="animation-delay:${i * 0.06}s" data-id="${p.id}">
      ${p.available === false ? `<div class="pcard-badge badge-soldout">${__LANG === 'en' ? 'Sold out' : 'Agotado'}</div>` : (p.badge ? `<div class="pcard-badge ${p.badge}">${esc(tagLabel(p.tag))}</div>` : '')}
      <button class="pcard-wish${_wish.has(p.id)?' liked':''}" aria-label="Guardar en lista de deseos" onclick="toggleWish(${p.id},this)">
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
            ${p.isPromo && p.originalPrice ? `<span class="price-old">$${(+p.originalPrice).toFixed(2)}</span>` : (p.oldPrice ? `<span class="price-old">$${p.oldPrice}</span>` : '')}
          </div>
          <button class="pcard-add" onclick="openModal(${p.id})">${t('store.viewBtn', '+ Ver')}</button>
        </div>
      </div>
    </div>
  `).join('');
  refreshCursorTargets();
}

// ─── COMBOS ─────────────────────────────────────────────────
function renderCombos() {
  const section = document.getElementById('comboSection');
  const scroll  = document.getElementById('comboScroll');
  if (!section || !scroll) return;
  if (COMBOS.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  scroll.innerHTML = COMBOS.map(c => {
    const items = (c.items || []).map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
    const origTotal = items.reduce((s, p) => s + p.basePrice, 0);
    const saving = origTotal > c.price ? (origTotal - c.price).toFixed(2) : null;
    const imgEl = c.imageUrl
      ? `<img class="combo-img" src="${esc(c.imageUrl)}" alt="${esc(c.name)}">`
      : `<div class="combo-img-ph">◇</div>`;
    return `
      <div class="combo-card" onclick="addComboToCart(${c.id})">
        ${imgEl}
        <div class="combo-body">
          <div class="combo-name">${esc(c.name)}</div>
          <div class="combo-desc">${esc(items.map(p => p.name).slice(0,3).join(' + '))}${items.length > 3 ? ' +más' : ''}</div>
          <div class="combo-prices">
            <span class="combo-price-now">$${(+c.price).toFixed(2)}</span>
            ${saving ? `<span class="combo-price-old">$${origTotal.toFixed(2)}</span><span class="combo-saving">Ahorras $${saving}</span>` : ''}
          </div>
          <button class="combo-add">${t('combo.add', 'Agregar combo')}</button>
        </div>
      </div>`;
  }).join('');
}

function addComboToCart(id) {
  const combo = COMBOS.find(c => c.id === id);
  if (!combo) return;
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
}

// ─── FILTERS (los botones se generan en renderFilters) ──────
document.getElementById('sortSelect').addEventListener('change', renderProducts);
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
let _wish = new Set(JSON.parse(localStorage.getItem('cacusa-wish') || '[]').map(Number));
function _saveWish() { localStorage.setItem('cacusa-wish', JSON.stringify([..._wish])); }
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
function trapFocus(modalEl, onClose) {
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const _prevFocused = document.activeElement;
  function getFocusable(){ return Array.from(modalEl.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null); }
  function onKeydown(e){
    if (e.key === 'Escape'){ onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKeydown);
  const items = getFocusable();
  if (items.length) items[0].focus();
  return function release(){
    document.removeEventListener('keydown', onKeydown);
    if (_prevFocused && _prevFocused.focus) _prevFocused.focus();
  };
}
let _modalReleaseTrap = null, _cartReleaseTrap = null, _checkoutReleaseTrap = null;

function openModal(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  currentProduct = p; qty = 1;
  initGallery(p);
  document.getElementById('modalCat').textContent = t('cat.' + (p.cat||'').toLowerCase(), p.cat || '');
  document.getElementById('modalName').textContent = __LANG === 'en' && p.name_en ? p.name_en : p.name;
  const _mLang = __LANG === 'en';
  const _matEN = {'Baño de oro 18k':'18k gold plated','Acero inoxidable':'Stainless steel','Plata 925':'Silver 925','Gold filled':'Gold filled'};
  const _origPrice = (p.isPromo && p.originalPrice) ? (+p.originalPrice).toFixed(2) : (p.oldPrice || null);
  document.getElementById('modalPrice').textContent = '$' + (+p.price).toFixed(2) + (_origPrice ? (_mLang ? ' — was $' : ' — antes $') + _origPrice : '');
  document.getElementById('modalDesc').textContent = (_mLang && p.description_en) ? p.description_en : (p.desc || '');
  const matEl = document.getElementById('modalMat');
  if (matEl) matEl.textContent = (_mLang && p.material && _matEN[p.material]) ? _matEN[p.material] : (p.material || '');
  document.getElementById('modalPersonField').style.display = p.personalized ? 'block' : 'none';
  document.getElementById('modalPersonText').value = '';
  document.getElementById('qtyNum').textContent = qty;
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
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _modalReleaseTrap = trapFocus(document.getElementById('modal-overlay'), closeModal);
  if (p.hasSurcharge) {
    showToast(__LANG === 'en'
      ? 'This product has <strong>4% off</strong> when paying by Zelle or bank transfer'
      : 'Este producto tiene <strong>4% de descuento</strong> pagando por Zelle o transferencia', 3000);
  }
  _syncModalWish();
  loadProductReviews(p.id);
  setRevRating(5);
  // Auditoría SEO externa (20 sep): si ya estamos en la página física de ESTE
  // MISMO producto (/producto/<slug>/), la URL ya es la correcta — agregar acá
  // ?p=... solo la ensuciaba con un parámetro redundante que ya no cumple
  // ninguna función (el canonical ya apunta a la URL limpia de todos modos).
  // Si se abre un producto DISTINTO (ej. desde "relacionados") sí hace falta
  // seguir agregando ?p= — si no, la URL visible quedaría apuntando al
  // producto viejo mientras se ve el modal de otro.
  if (String(window.__CACUSA_STATIC_PRODUCT_ID) !== String(p.id)) { const _u = new URL(window.location.href); _u.searchParams.set('p', _productParam(p)); history.pushState({productId: p.id}, '', _u.toString()); }
  _injectProductSchema(p);
  _renderRelatedProducts(p);
}
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  if (_modalReleaseTrap) { _modalReleaseTrap(); _modalReleaseTrap = null; }
  const _u = new URL(window.location.href); _u.searchParams.delete('p'); history.pushState({}, '', _u.toString());
  _updateListingSeo();
  dismissToast();
}

document.getElementById('qtyMinus').addEventListener('click', () => { if (qty > 1) { qty--; document.getElementById('qtyNum').textContent = qty; } });
document.getElementById('qtyPlus').addEventListener('click', () => { qty++; document.getElementById('qtyNum').textContent = qty; });

document.getElementById('modalAddBtn').addEventListener('click', () => {
  if (!currentProduct || currentProduct.available === false) return;
  // Recorta a 20 caracteres como respaldo del maxlength del input
  const personText = document.getElementById('modalPersonText').value.slice(0, 20);
  const material = currentProduct.material || '';
  const existingLine = cart.find(it => !it.isCombo && it.id === currentProduct.id && (it.personalization || '') === personText && (it.material || '') === material);
  if (existingLine) {
    existingLine.qty = (existingLine.qty || 1) + qty;
  } else {
    cart.push({ ...currentProduct, personalization: personText, material, cartId: Date.now(), qty });
  }
  saveCart(); updateCartUI();
  const btn = document.getElementById('modalAddBtn');
  btn.textContent = __LANG === 'en' ? '✓ Added' : '✓ Añadido';
  btn.classList.add('added');
  setTimeout(() => { closeModal(); openCart(); }, 800);
});

// ─── CART ───────────────────────────────────────────────────
// Email del lead de carrito abandonado que se registró en ESTA sesión (si se registró
// alguno) — lo pone registerLead() cuando el carrito llega al checkout, y saveCart() lo
// usa para saber a quién avisarle si el carrito termina vacío sin haber comprado.
let _abandonLeadEmail = null;
function saveCart() {
  localStorage.setItem('cacusa-cart', JSON.stringify(cart));
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
    itemsEl.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">✦</span><div class="cart-empty-text">' + t('store.cartEmpty', 'Tu carrito está vacío') + '</div></div>';
    footEl.style.display = 'none';
  } else {
    itemsEl.innerHTML = cart.map((item, i) => `
      <div class="cart-item">
        <div class="ci-img" style="${imgBgStyle(item)}">${imgInner(item, item.name)}</div>
        <div class="ci-body">
          <div class="ci-name">${esc(__LANG === 'en' && item.name_en ? item.name_en : item.name)}</div>
          ${item.personalization ? `<div class="ci-custom">"${esc(item.personalization)}"</div>` : ''}
          <div class="ci-mat">${(()=>{const _cEN={'Baño de oro 18k':'18k gold plated','Acero inoxidable':'Stainless steel','Plata 925':'Silver 925','Gold filled':'Gold filled'};const _m=item.material||'Plata 925';return localStorage.getItem('cacusa-lang')==='en'?(_cEN[_m]||_m):_m;})()}</div>
          <div class="ci-foot">
            <span class="ci-price">$${(item.price * (item.qty || 1)).toFixed(2)}</span>
            <div class="ci-qty">
              <button class="ci-qty-btn" onclick="changeQty(${item.cartId}, -1)" aria-label="Restar cantidad">−</button>
              <span class="ci-qty-num">${item.qty || 1}</span>
              <button class="ci-qty-btn" onclick="changeQty(${item.cartId}, 1)" aria-label="Sumar cantidad">+</button>
            </div>
            <button class="ci-remove" onclick="removeItem(${item.cartId})" aria-label="Quitar del carrito">✕</button>
          </div>
        </div>
      </div>`).join('');
    document.getElementById('cartTotal').textContent = '$' + total.toFixed(2);
    const free = _cpIsFreeShip() || total >= SHIPPING.freeThreshold;
    const _cL = localStorage.getItem('cacusa-lang') || 'es';
    document.getElementById('cartShipping').textContent = free
      ? t('store.shippingFree', '¡Envío gratis desbloqueado!')
      : (_cL === 'en'
          ? 'Add $' + (SHIPPING.freeThreshold - total).toFixed(2) + ' more for free shipping'
          : 'Agrega $' + (SHIPPING.freeThreshold - total).toFixed(2) + ' más para envío gratis');
    footEl.style.display = 'block';
  }
}
function removeItem(cartId) { cart = cart.filter(i => i.cartId !== cartId); saveCart(); updateCartUI(); }
function changeQty(cartId, delta) {
  const item = cart.find(i => i.cartId === cartId);
  if (!item) return;
  const next = (item.qty || 1) + delta;
  if (next <= 0) { removeItem(cartId); return; }
  item.qty = next;
  saveCart(); updateCartUI();
}

document.getElementById('coPais').addEventListener('change', function() {
  const isUS = this.value === 'US';
  document.getElementById('coEstadoWrap').style.display = isUS ? 'block' : 'none';
  document.getElementById('coZipWrap').style.display    = isUS ? 'block' : 'none';
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

  function closeList() { list.classList.remove('open'); list.innerHTML = ''; _items = []; }

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
        const res  = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=6&lang=en');
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
          return '<div class="addr-sugg-item" data-idx="' + i + '">'
               + '<div class="addr-sugg-main">' + esc(main) + '</div>'
               + (sub ? '<div class="addr-sugg-sub">' + esc(sub) + '</div>' : '')
               + '</div>';
        }).join('');
        list.classList.add('open');
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
      const next = focused ? (focused.nextElementSibling || items[0]) : items[0];
      if (focused) focused.classList.remove('focused');
      next.classList.add('focused');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = focused ? (focused.previousElementSibling || items[items.length - 1]) : items[items.length - 1];
      if (focused) focused.classList.remove('focused');
      prev.classList.add('focused');
    } else if (e.key === 'Enter' && focused) {
      e.preventDefault();
      fillFromFeature(_items[+focused.dataset.idx]);
    } else if (e.key === 'Escape') {
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
function openCheckout() {
  document.getElementById('checkout-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  coGoStep1();
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
  if (_checkoutReleaseTrap) { _checkoutReleaseTrap(); _checkoutReleaseTrap = null; }
}
document.getElementById('checkout-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('checkout-overlay')) closeCheckout();
});

// ─── ESCAPE KEY ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('success-overlay').classList.contains('open')) return;
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
  let taxAmt = 0, taxLabel = 'Impuesto';
  if (pais === 'EC') {
    taxAmt   = (adjustedSubtotal + shippingCost) * 0.15;
    taxLabel = 'IVA Ecuador (15%)';
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
  const taxLine = document.getElementById('coTaxLine');
  if (taxAmt > 0) {
    taxLine.style.display = '';
    document.getElementById('coTaxLabel').textContent   = taxLabel;
    document.getElementById('coImpuesto').textContent   = '$' + taxAmt.toFixed(2);
  } else {
    taxLine.style.display = 'none';
  }
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
  let first = null;
  (Array.isArray(ids) ? ids : [ids]).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.borderColor = '#C0336E'; el.setAttribute('aria-invalid', 'true'); if (!first) first = el; }
  });
  if (first) first.focus();
  if (errorEl) errorEl.textContent = msg;
}

// ─── CHECKOUT EN 2 PASOS ─────────────────────────────────────
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
  if (pais === 'US') {
    const estado = document.getElementById('coEstado').value;
    const zip     = document.getElementById('coZip').value.trim();
    if (!estado) { _markCoFieldError('coEstado', errorEl, t('store.coError2', 'Por favor selecciona tu estado.')); return; }
    if (!/^\d{5}$/.test(zip)) { _markCoFieldError('coZip', errorEl, t('store.coErrorZip', 'Por favor ingresa un código postal válido (5 dígitos).')); return; }
  }
  errorEl.textContent = '';
  document.getElementById('coStep1').classList.remove('active');
  document.getElementById('coStep2').classList.add('active');
  document.getElementById('coDot1').classList.remove('act');
  document.getElementById('coDot2').classList.add('act');
}
function coGoStep1() {
  document.getElementById('coStep2').classList.remove('active');
  document.getElementById('coStep1').classList.add('active');
  document.getElementById('coDot2').classList.remove('act');
  document.getElementById('coDot1').classList.add('act');
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
  const notas     = document.getElementById('coNotas').value.trim();
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
  const result = await submitOrder({
    numero:    _currentOrderNum,
    cliente:   { nombre: (nombre + ' ' + apellido).trim(), telefono: tel, ciudad: ciudad + (paisVal ? ', ' + paisVal : ''), direccion, apto, estado: estadoVal, zip: zipVal, email: zelleEmailVal, idioma: __LANG },
    productos: cart.map(i => ({ id: i.id, isCombo: !!i.isCombo, name: i.name, price: i.hasSurcharge ? i.basePrice : i.price, qty: i.qty || 1, personalization: i.personalization || undefined, material: i.material || undefined })),
    total:     totalConGC,
    subtotal:  zelleSubtotal,
    envio:     shippingCost,
    impuesto:  zelleTax,
    pago:      'Zelle',
    estado:    'Nuevo',
    notas:     [notas, zelleExtras].filter(Boolean).join(' | ') || undefined,
    giftcard:  zelleGcDiscount > 0 ? { code: _gcCode, amount: zelleGcDiscount } : undefined,
    cuponAplicado: _cpCode || undefined
  });
  if (!result.ok) {
    errorEl.textContent = t('store.coErrorOrderFailed', 'No pudimos guardar tu pedido — revisa tu conexión e intenta de nuevo.');
    return;
  }
  if (_cpCode) burnCoupon(_cpCode, tel, zelleEmailVal, result.id);
  window.open(buildWhatsAppUrl(), '_blank');
  closeCheckout();
  cart = []; saveCart(); updateCartUI();
  _gcCode=null; _gcBalance=0; _gcApplied=0;
  _cpCode=null; _cpType=null; _cpAmount=0; _cpDiscount=0;
  document.getElementById('gcCodeInput').value='';
  document.getElementById('gcMsg').textContent='';
  document.getElementById('cpCodeInput').value='';
  document.getElementById('cpMsg').textContent='';
  showSuccess();
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
    notes:    document.getElementById('coNotas').value.trim(),
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
      throw new Error(__LANG === 'en'
        ? 'Your gift card covers the full total — please finish via WhatsApp'
        : 'Tu tarjeta de regalo cubre el total — finaliza por WhatsApp');
    }
    if (!resp.ok || !data.checkoutUrl) {
      throw new Error(data.error || 'No se pudo crear el pago');
    }

    // El pedido ya no se arma ni se guarda acá — cacusa-square lo registra del lado del
    // servidor (con los mismos datos que ya le mandamos en este POST) recién cuando su
    // webhook confirma que Square procesó el pago de verdad.
    _gcCode=null; _gcBalance=0; _gcApplied=0;
    _cpCode=null; _cpType=null; _cpAmount=0; _cpDiscount=0;
    cart = []; saveCart(); updateCartUI();
    window.location.href = data.checkoutUrl;

  } catch (err) {
    errorEl.textContent = '! ' + err.message + (__LANG === 'en' ? '. Try again or use WhatsApp.' : '. Intenta de nuevo o usa WhatsApp.');
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

// ─── WHATSAPP FALLBACK ────────────────────────────────────────
function buildWhatsAppUrl() {
  const _waEN    = __LANG === 'en';
  const _waMat   = {'Baño de oro 18k':'18k gold plated','Acero inoxidable':'Stainless steel','Plata 925':'Silver 925','Gold filled':'Gold filled'};
  const payMethod = (document.querySelector('.pay-method-opt.selected') || {}).dataset?.method || 'square';
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

// ─── ENVIAR PEDIDO AL ADMIN (fire-and-forget) ─────────────────
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
  const notas      = document.getElementById('coNotas').value.trim();
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
  const result = await submitOrder({
    numero:  _currentOrderNum,
    cliente: { nombre: (nombre + ' ' + apellido).trim(), telefono: tel, ciudad: ciudad + (pais ? ', ' + pais : ''), direccion, apto, estado: waEstadoV, zip: waZipV, email: emailVal, idioma: __LANG },
    productos: cart.map(i => ({ id: i.id, isCombo: !!i.isCombo, name: i.name, price: i.price, qty: i.qty || 1, personalization: i.personalization || undefined, material: i.material || undefined })),
    total:  totalConGC,
    subtotal: total,
    envio:  waShip,
    impuesto: waTax,
    pago:   'WhatsApp',
    estado: 'Nuevo',
    notas:  [notas, waExtras].filter(Boolean).join(' | ') || undefined,
    giftcard: waGcDiscount > 0 ? { code: _gcCode, amount: waGcDiscount } : undefined,
    cuponAplicado: _cpCode || undefined
  });
  if (!result.ok) {
    errorEl.textContent = t('store.coErrorOrderFailed', 'No pudimos guardar tu pedido — revisa tu conexión e intenta de nuevo.');
    return;
  }
  if (_cpCode) burnCoupon(_cpCode, tel, emailVal, result.id);
  window.open(buildWhatsAppUrl(), '_blank');
  closeCheckout();
  cart = []; saveCart(); updateCartUI();
  _gcCode=null; _gcBalance=0; _gcApplied=0;
  _cpCode=null; _cpType=null; _cpAmount=0; _cpDiscount=0;
  document.getElementById('gcCodeInput').value='';
  document.getElementById('gcMsg').textContent='';
  document.getElementById('cpCodeInput').value='';
  document.getElementById('cpMsg').textContent='';
  showSuccess();
});

function showSuccess() {
  document.getElementById('success-overlay').classList.add('open');
}
document.getElementById('successBack').addEventListener('click', () => {
  document.getElementById('success-overlay').classList.remove('open');
});

// ─── LANG ───────────────────────────────────────────────────
window.cacusaLang = l => { localStorage.setItem('cacusa-lang', l); location.reload(); };

// ─── INIT ───────────────────────────────────────────────────
updateCartUI();
refreshCursorTargets();

// Detectar regreso desde Square (?paid=1) → solo mostrar success.
// El pedido, el cupón y la tarjeta de regalo ya NO se registran acá: este parámetro en la URL
// no prueba que el pago se haya completado (cualquiera puede escribir esta misma URL sin pagar).
// cacusa-square registra el pedido de verdad cuando su webhook recibe la confirmación real de
// Square — este código solo limpia el estado local y saluda a la clienta.
if (new URLSearchParams(window.location.search).get('paid') === '1') {
  history.replaceState({}, '', window.location.pathname);
  sessionStorage.removeItem('cacusa_order_pending');
  showSuccess();
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

// ─── REVIEW SUMMARIES (para las cards) ─────────────────────
async function loadReviewSummaries() {
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
    renderProducts();
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
      `<div class="gallery-thumb ${i===0?'active':''}" role="button" tabindex="0" aria-label="Foto ${i + 1}" onclick="switchGallerySlide(${i})" onkeydown="activateOnKey(event,()=>switchGallerySlide(${i}))"><img src="${esc(url)}" loading="lazy" width="52" height="52" alt="${esc(p.name || '')} — foto ${i + 1}"></div>`
    ).join('');
  } else {
    thumbs.classList.add('hidden');
  }
  const dots = document.getElementById('galleryDots');
  dots.innerHTML = multi ? _galleryImages.map((_, i) =>
    `<button class="gallery-dot ${i===0?'active':''}" aria-label="Foto ${i + 1}" onclick="event.stopPropagation();switchGallerySlide(${i})"></button>`
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
    imgBg.innerHTML = `<img src="${esc(url)}" alt="${esc(p.name + ' — joyería artesanal personalizada CACUSA')}" width="340" height="340" style="width:100%;height:100%;object-fit:cover;object-position:${pos};transform:scale(${zoom});transform-origin:${pos};display:block">`;
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
    `<div class="lb-thumb ${i===_lbIdx?'active':''}" role="button" tabindex="0" aria-label="Foto ${i + 1}" onclick="lbGoTo(${i})" onkeydown="activateOnKey(event,()=>lbGoTo(${i}))"><img src="${esc(url)}" loading="lazy" width="44" height="44" alt="${esc(_lbName)} — foto ${i + 1}"></div>`
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
  _lbI.alt = currentProduct ? (currentProduct.name + ' — joyería artesanal personalizada CACUSA') : '';
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

// ─── RELACIONADOS ──────────────────────────────────────────
function _renderRelatedProducts(p) {
  const container = document.getElementById('relatedProducts');
  const grid = document.getElementById('relatedGrid');
  if (!container || !grid) return;
  const related = PRODUCTS
    .filter(x => x.id !== p.id && x.cat === p.cat && x.available !== false)
    .sort((a, b) => {
      const sa = (a.badge === 'badge-sale' || a.badge === 'badge-promo' || a.isPromo) ? 0 : 1;
      const sb = (b.badge === 'badge-sale' || b.badge === 'badge-promo' || b.isPromo) ? 0 : 1;
      return sa - sb;
    })
    .slice(0, 4);
  if (related.length < 2) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  grid.innerHTML = related.map(r => {
    const rName = (__LANG === 'en' && r.name_en) ? r.name_en : r.name;
    const imgs = getProductImages(r);
    const imgStyle = imgs[0]
      ? `background-image:url('${imgs[0].replace(/'/g, '%27')}')`
      : imgBgStyle(r);
    return `<div class="related-card" role="button" tabindex="0" aria-label="${esc(rName)}" onclick="openModal(${r.id})" onkeydown="activateOnKey(event,()=>openModal(${r.id}))">
      <div class="related-card-img" style="${imgStyle}"></div>
      <div class="related-card-body">
        ${r.badge ? `<div class="related-card-tag">${esc(tagLabel(r.tag))}</div>` : ''}
        <div class="related-card-name">${esc(rName)}</div>
        <div class="related-card-price">$${(+r.price).toFixed(2)}</div>
      </div>
    </div>`;
  }).join('');
}

// ─── SEO: SCHEMA DINÁMICO ─────────────────────────────────
const _SEO_BASE = 'https://cacusabytaitus.com/ui_kits/store/';
const _SEO_ORG  = 'https://cacusabytaitus.com/#organization';
const _SEO_IMG_DEFAULT = 'https://cacusabytaitus.com/assets/og-image.jpg';
// Bases de las 2 tiendas (idénticas en el archivo ES y en el EN) — hacen falta las 2 para
// armar el par de hreflang recíproco sin importar en qué idioma esté el visitante actual.
const _STORE_BASE_ES = 'https://cacusabytaitus.com/ui_kits/store/';
const _STORE_BASE_EN = 'https://cacusabytaitus.com/en/ui_kits/store/';
// URLs con slug de texto (?p=anillo-doble-gg-ID) en vez de solo el ID largo —
// mejor para SEO sin cambiar el mecanismo de lectura (sigue siendo el ID, el
// slug es solo el prefijo). _productParam() arma el valor del query param;
// _extractProductId() lo revierte al leer la URL (todo lo que va después del
// último guion, porque el ID nunca lleva guiones).
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
  const desc = (__LANG === 'en' ? CATEGORY_DESC_EN : CATEGORY_DESC_ES)[key]
    || (__LANG === 'en'
      ? `Handmade ${label} — personalized jewelry in 925 silver, 18k gold plating and stainless steel.`
      : `${label} artesanales — joyería personalizada en plata 925, baño de oro 18k y acero inoxidable.`);
  const catSlug = _categorySlug(cat);
  const url = (__LANG === 'en' ? _STORE_BASE_EN : _STORE_BASE_ES) + 'categoria/' + catSlug + '/';
  const title = (__LANG === 'en' ? CATEGORY_TITLE_EN : CATEGORY_TITLE_ES)[key] || (label + ' — CACUSA by Taitus');
  const catProducts = PRODUCTS.filter(p => p.cat === cat && p.available !== false);
  const firstImg = catProducts.length ? getProductImages(catProducts[0])[0] : null;
  document.title = title;
  _setMeta('meta-desc', desc);
  _setCanonical(url);
  _setHreflang(_STORE_BASE_ES + 'categoria/' + catSlug + '/', _STORE_BASE_EN + 'categoria/' + catSlug + '/');
  const h1el = document.querySelector('.store-hero-h'); if (h1el) h1el.textContent = label;
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
function _updateListingSeo() {
  const catParam = new URLSearchParams(window.location.search).get('cat') || window.__CACUSA_STATIC_CATEGORY || null;
  const match = catParam && CATEGORIES.find(c => c.toLowerCase() === catParam.toLowerCase());
  if (match) _updateCategorySeo(match); else _clearProductSchema();
}
// Atrás/adelante del navegador entre categorías (no toca el modal de producto —
// abrir/cerrarlo con popstate es un caso aparte que ya se maneja distinto).
window.addEventListener('popstate', () => {
  if (document.getElementById('modal-overlay').classList.contains('open')) return;
  const catParam = new URLSearchParams(window.location.search).get('cat');
  const match = catParam && CATEGORIES.find(c => c.toLowerCase() === catParam.toLowerCase());
  activeFilter = match || 'all';
  document.querySelectorAll('#filterBtns .filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilter));
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
  document.title = 'Tienda de joyería personalizada | CACUSA by Taitus';
  _setMeta('meta-desc', 'Joyería y bisutería personalizada hecha a mano: anillos, collares, pulseras y aretes en plata 925 y oro 18k. Personalización disponible. Envíos a Ecuador y USA.');
  _setCanonical(_SEO_BASE);
  _setHreflang(_STORE_BASE_ES, _STORE_BASE_EN);
  { const h1el = document.querySelector('.store-hero-h'); if (h1el) h1el.textContent = TEXTS.heroTitle; }
  _setMeta('og-url', _SEO_BASE);
  _setMeta('og-title', 'Tienda de joyería personalizada | CACUSA by Taitus');
  _setMeta('og-description', 'Anillos, collares, pulseras y aretes hechos a mano con baño de oro 18k, plata 925 y acero inoxidable. Personalización a pedido. Envíos a Ecuador y USA.');
  _setMeta('og-image', _SEO_IMG_DEFAULT);
  _setMeta('tw-title', 'Tienda de joyería personalizada | CACUSA by Taitus');
  _setMeta('tw-description', 'Anillos, collares, pulseras y aretes hechos a mano. Personalización a pedido.');
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
  list.innerHTML = `<div class="no-reviews" style="color:var(--ink-muted)">…</div>`;
  try {
    const r = await fetch(_fbUrl(`https://cacusa-pos-default-rtdb.firebaseio.com/cacusa_reviews/${productId}.json`));
    if (!r.ok) throw new Error();
    const data = await r.json();
    if (!data || !Object.keys(data).length) {
      list.innerHTML = `<div class="no-reviews">${__LANG === 'en' ? 'No reviews yet. Be the first!' : 'Aún sin reseñas. ¡Sé el primero/a!'}</div>`;
      avgRow.style.display = 'none'; return;
    }
    // approved !== false: las reseñas anteriores a la moderación no tienen el campo
    // y siguen visibles; solo se ocultan las nuevas mientras esperan aprobación.
    const reviews = Object.values(data).filter(v => v && v.comment && v.approved !== false).sort((a, b) => (b.date||'').localeCompare(a.date||''));
    if (!reviews.length) { list.innerHTML = `<div class="no-reviews">${__LANG==='en'?'No reviews yet.':'Aún sin reseñas.'}</div>`; avgRow.style.display='none'; return; }
    const avg = reviews.reduce((s, v) => s + (v.rating || 5), 0) / reviews.length;
    avgRow.style.display = 'flex';
    document.getElementById('revScore').textContent = avg.toFixed(1);
    document.getElementById('revStarsDisplay').innerHTML = renderStars(avg);
    document.getElementById('revCountText').textContent = `(${reviews.length})`;
    _patchSchemaRating(avg, reviews.length, reviews);
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
    list.innerHTML = `<div class="no-reviews">${__LANG==='en'?'Could not load reviews.':'No se pudieron cargar las reseñas.'}</div>`;
    avgRow.style.display = 'none';
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
  const _lastRev = parseInt(localStorage.getItem('cacusa-last-review') || '0', 10);
  if (Date.now() - _lastRev < 30000) {
    showToast(__LANG==='en'?'Please wait a moment before submitting again.':'Espera un momento antes de enviar otra reseña.'); return;
  }
  const btn = document.getElementById('revSubmitBtn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch(_fbUrl(`https://cacusa-pos-default-rtdb.firebaseio.com/cacusa_reviews/${encodeURIComponent(currentProduct.id)}.json`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // approved:false — la reseña no se muestra hasta que Tita o Robin la aprueben
      // desde el panel. Las reglas de Firebase exigen este valor al crear, así que
      // nadie puede auto-aprobarse mandando la reseña por fuera del sitio.
      body: JSON.stringify({ name, rating, comment, approved: false, date: new Date().toISOString().slice(0,10) })
    });
    if (!res.ok) throw new Error();
    localStorage.setItem('cacusa-last-review', String(Date.now()));
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
    msgEl.textContent=(__LANG==='en' ? `✓ Applied: ${disc}` : `✓ Aplicado: ${disc} — confirma el uso desde el admin después de recibir el pago`);
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
    btn.setAttribute('aria-label','Cerrar menú');
    document.body.style.overflow='hidden';
    _navReleaseTrap = trapFocus(drawer, closeDrawer);
  }
  function closeDrawer(){
    drawer.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded','false');
    btn.setAttribute('aria-label','Abrir menú');
    document.body.style.overflow='';
    if (_navReleaseTrap) { _navReleaseTrap(); _navReleaseTrap = null; }
  }

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
  if (!localStorage.getItem('cacusa-vig') && (localStorage.getItem('cacusa-vig2') || localStorage.getItem('cacusa-vig-store'))) {
    localStorage.setItem('cacusa-vig', '1');
  }
  function openVig() {
    vig.classList.add('show');
    _vigReleaseTrap = trapFocus(vig, closeVig);
  }
  function closeVig() {
    vig.classList.remove('show');
    localStorage.setItem('cacusa-vig', '1');
    if (_vigReleaseTrap) { _vigReleaseTrap(); _vigReleaseTrap = null; }
  }
  if (!localStorage.getItem('cacusa-vig')) setTimeout(openVig, 3500);
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

// ── Captura de lead en checkout (recuperación de abandono) ──
(function(){
  const emailInput = document.getElementById('coEmail');
  if (!emailInput) return;
  let _leadSent = false;
  emailInput.addEventListener('blur', () => {
    const email = emailInput.value.trim();
    if (_leadSent || !email || !email.includes('@') || !cart.length) return;
    _leadSent = true;
    const cartData = cart.map(i => ({ name: i.name + (i.qty > 1 ? ' ×' + i.qty : ''), price: i.price * (i.qty || 1) }));
    const total = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
    registerLead(email, 'cart_checkout_start', cartData, total);
  });
})();
