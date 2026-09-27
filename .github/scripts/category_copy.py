"""Títulos SEO y textos de introducción por categoría (ES/EN).

Los usa generate_product_pages.py para las páginas físicas de categoría
(ui_kits/store/categoria/<slug>/ y en/). CATEGORY_TITLE_ES/EN está duplicado
a propósito en ui_kits/store/app.js y
en/ui_kits/store/app.js (_updateCategorySeo), igual que CATEGORY_DESC_*:
si se edita un título acá, editar también esas dos copias — si no, el JS
pisa el <title> con otro texto apenas carga la página.

Reglas del copy (CLAUDE.md, "Convenciones de marca"): sin emojis; el precio
de personalizar NO está incluido (se cotiza por WhatsApp); envío gratis desde
$90; personalización 5–10 días hábiles. Una categoría nueva que no esté acá
cae al título/intro genérico de generate_product_pages.py.
"""

CATEGORY_TITLE_ES = {
    "cadenas": "Cadenas y collares personalizados | CACUSA by Taitus",
    "aretes": "Aretes artesanales y personalizados | CACUSA by Taitus",
    "anillos": "Anillos personalizados y ajustables | CACUSA by Taitus",
    "hombres": "Joyería para hombre en acero y oro 18k | CACUSA by Taitus",
    "pulseras": "Pulseras artesanales personalizadas | CACUSA by Taitus",
    "ear cuff": "Ear cuffs sin perforación | CACUSA by Taitus",
    "parejas": "Joyas para parejas a juego | CACUSA by Taitus",
    "juegos": "Sets de joyería para regalar | CACUSA by Taitus",
    "hand chain": "Hand chains artesanales | CACUSA by Taitus",
}
CATEGORY_TITLE_EN = {
    "cadenas": "Personalized Necklaces & Chains | CACUSA by Taitus",
    "aretes": "Handmade Personalized Earrings | CACUSA by Taitus",
    "anillos": "Personalized & Adjustable Rings | CACUSA by Taitus",
    "hombres": "Men's Jewelry in Steel & 18k Gold | CACUSA by Taitus",
    "pulseras": "Handmade Personalized Bracelets | CACUSA by Taitus",
    "ear cuff": "No-Piercing Ear Cuffs | CACUSA by Taitus",
    "parejas": "Matching Couples Jewelry | CACUSA by Taitus",
    "juegos": "Jewelry Gift Sets | CACUSA by Taitus",
    "hand chain": "Handmade Hand Chains | CACUSA by Taitus",
}

CATEGORY_INTRO_ES = {
    "cadenas": (
        "Cadenas y collares hechos a mano en baño de oro 18k, gold filled y acero inoxidable, "
        "pensados para usarse todos los días y para combinarse entre sí. Encuentras cadenas finas "
        "para llevar solas, collares con dijes y piezas con perlas. Muchas se pueden personalizar "
        "con una inicial, un nombre o una fecha: escríbenos por WhatsApp contándonos qué quieres y "
        "te damos el precio final. Las piezas personalizadas toman de 5 a 10 días hábiles. "
        "Enviamos a Ecuador y a todo Estados Unidos, con envío gratis en compras desde $90."
    ),
    "aretes": (
        "Aretes artesanales en baño de oro 18k, gold filled y acero inoxidable: argollas, topos, "
        "aretes largos y piezas con perlas para el día a día o para una ocasión especial. Son "
        "livianos y cómodos para usar muchas horas. Si buscas un diseño con inicial o un detalle "
        "propio, escríbenos por WhatsApp y te cotizamos la personalización. Enviamos a Ecuador y "
        "a todo Estados Unidos, con envío gratis en compras desde $90."
    ),
    "anillos": (
        "Anillos hechos a mano en baño de oro 18k, acero inoxidable, baño de rodio y plata 925. "
        "Hay modelos ajustables, que se adaptan a casi cualquier dedo, y modelos de talla fija; "
        "si tienes dudas con tu medida, revisa nuestra guía de tallas o escríbenos por WhatsApp. "
        "Muchos se pueden grabar con iniciales, nombres o fechas: te damos el precio de la "
        "personalización por WhatsApp y la pieza está lista en 5 a 10 días hábiles. Enviamos a "
        "Ecuador y a todo Estados Unidos, con envío gratis desde $90."
    ),
    "hombres": (
        "Joyería para hombre en acero inoxidable y baño de oro 18k: piezas sobrias y resistentes "
        "para el uso diario, que no se oscurecen con el agua ni con el sudor. Son una buena idea "
        "de regalo para papá, pareja o amigo, y se pueden personalizar con iniciales o una fecha "
        "importante; escríbenos por WhatsApp y te cotizamos. Enviamos a Ecuador y a todo Estados "
        "Unidos, con envío gratis en compras desde $90."
    ),
    "pulseras": (
        "Pulseras artesanales en gold filled, baño de oro 18k y acero inoxidable: cadenas finas, "
        "pulseras tejidas y piezas con dijes para llevar solas o combinar varias en la misma "
        "muñeca. El gold filled tiene una capa de oro mucho más gruesa que un baño común, así que "
        "dura años con el cuidado adecuado. Muchas se pueden personalizar con iniciales o un "
        "nombre: escríbenos por WhatsApp y te damos el precio. Envío gratis a Ecuador y Estados "
        "Unidos en compras desde $90."
    ),
    "ear cuff": (
        "Ear cuffs artesanales que se colocan en el borde de la oreja sin necesidad de "
        "perforación. Dan un toque moderno y combinan con aretes pequeños o se usan solos. Si "
        "tienes dudas sobre cómo ponerlo o quieres un diseño propio, escríbenos por WhatsApp. "
        "Enviamos a Ecuador y a todo Estados Unidos, con envío gratis en compras desde $90."
    ),
    "parejas": (
        "Joyas a juego para parejas: anillos, cadenas y pulseras que se complementan, en acero "
        "inoxidable y baño de oro 18k. Son un regalo ideal para aniversarios, San Valentín o para "
        "celebrar una fecha importante, y se pueden personalizar con sus iniciales o esa fecha; "
        "escríbenos por WhatsApp y te cotizamos. Enviamos a Ecuador y a todo Estados Unidos, con "
        "envío gratis en compras desde $90."
    ),
    "juegos": (
        "Sets de joyería que ya vienen combinados, en baño de oro 18k, listos para regalar o "
        "para estrenar completos. Son la forma más fácil de acertar con un regalo: todo el "
        "conjunto va junto y combina. Si quieres cambiar una pieza o agregar una inicial, "
        "escríbenos por WhatsApp. Enviamos a Ecuador y a todo Estados Unidos, con envío gratis en "
        "compras desde $90."
    ),
    "hand chain": (
        "Hand chains artesanales que unen anillo y pulsera en una sola pieza, en baño de oro 18k. "
        "Son delicadas, llaman la atención en fotos y eventos, y se ajustan a la mano. Si "
        "tienes dudas con la medida, escríbenos por WhatsApp. Enviamos a Ecuador y a todo "
        "Estados Unidos, con envío gratis en compras desde $90."
    ),
}
CATEGORY_INTRO_EN = {
    "cadenas": (
        "Handmade chains and necklaces in 18k gold plating, gold filled and stainless steel, made "
        "to be worn every day and layered together. You'll find fine chains to wear on their own, "
        "charm necklaces and pieces with pearls. Many can be personalized with an initial, a name "
        "or a date: message us on WhatsApp with what you have in mind and we'll send you the final "
        "price. Personalized pieces take 5 to 10 business days. We ship to Ecuador and across the "
        "United States, with free shipping on orders over $90."
    ),
    "aretes": (
        "Handmade earrings in 18k gold plating, gold filled and stainless steel: hoops, studs, "
        "drop earrings and pearl pieces for every day or a special occasion. They're lightweight "
        "and comfortable to wear for hours. If you'd like a design with an initial or your own "
        "detail, message us on WhatsApp and we'll quote the personalization. We ship to Ecuador "
        "and across the United States, with free shipping on orders over $90."
    ),
    "anillos": (
        "Handmade rings in 18k gold plating, stainless steel, rhodium plating and 925 silver. "
        "Some are adjustable and fit almost any finger, others come in fixed sizes; if you're "
        "unsure about your size, check our size guide or message us on WhatsApp. Many can be "
        "engraved with initials, names or dates: we'll give you the personalization price on "
        "WhatsApp and your piece is ready in 5 to 10 business days. We ship to Ecuador and across "
        "the United States, with free shipping over $90."
    ),
    "hombres": (
        "Men's jewelry in stainless steel and 18k gold plating: understated, durable pieces for "
        "everyday wear that won't tarnish with water or sweat. A great gift for a dad, partner or "
        "friend, and they can be personalized with initials or a meaningful date; message us on "
        "WhatsApp for a quote. We ship to Ecuador and across the United States, with free "
        "shipping on orders over $90."
    ),
    "pulseras": (
        "Handmade bracelets in gold filled, 18k gold plating and stainless steel: fine chains, "
        "woven bracelets and charm pieces to wear alone or stack on the same wrist. Gold filled "
        "has a much thicker layer of gold than regular plating, so it lasts for years with proper "
        "care. Many can be personalized with initials or a name: message us on WhatsApp for the "
        "price. Free shipping to Ecuador and the United States on orders over $90."
    ),
    "ear cuff": (
        "Handmade ear cuffs that sit on the edge of your ear with no piercing needed. They add a "
        "modern touch and pair well with small earrings or look great alone. If you have "
        "questions about wearing one or want your own design, message us on WhatsApp. We ship to "
        "Ecuador and across the United States, with free shipping on orders over $90."
    ),
    "parejas": (
        "Matching jewelry for couples: rings, chains and bracelets that go together, in stainless "
        "steel and 18k gold plating. A perfect gift for anniversaries, Valentine's Day or any "
        "special date, and they can be personalized with your initials or that date; message us "
        "on WhatsApp for a quote. We ship to Ecuador and across the United States, with free "
        "shipping on orders over $90."
    ),
    "juegos": (
        "Jewelry sets that come already matched, in 18k gold plating, ready to gift or to wear "
        "together. They're the easiest way to get a gift right: the whole set goes together. If "
        "you'd like to swap a piece or add an initial, message us on WhatsApp. We ship to Ecuador "
        "and across the United States, with free shipping on orders over $90."
    ),
    "hand chain": (
        "Handmade hand chains that join a ring and a bracelet in one piece, in 18k gold plating. "
        "They're delicate, stand out in photos and at events, and adjust to your hand. If you're "
        "unsure about sizing, message us on WhatsApp. We ship to Ecuador and across the United "
        "States, with free shipping on orders over $90."
    ),
}
