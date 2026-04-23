# CACUSA Design System

**Brand:** CACUSA by Taitus  
**Industry:** Personalized Artisan Jewelry  
**Markets:** Ecuador & United States  
**Primary Channel:** Instagram  
**Tagline:** *"creamos para que luzcas más bella de lo que ya eres"*  
("we create so you shine more beautiful than you already are")

---

## Sources

- `uploads/cacusa oficial.jpg` — Official logo provided (JPG)
- `uploads/logo final.ai` — Original Illustrator file (provided but binary; JPG used for color extraction)

---

## Brand Overview

CACUSA by Taitus is a handcrafted, personalized jewelry brand founded and operated in Ecuador with reach into the United States. They specialize in non-traditional, custom jewelry — pieces that tell a personal story. The brand has a strong Instagram-first identity, using the platform for product launches, lifestyle content, and direct customer engagement.

### Target Audience
- **Primary:** Women born 1990 and later (Millennials & Gen Z)
- **Persona:** Independent, brave, values-driven women who are unapologetically themselves
- **Secondary:** Men (separate section in the store)
- **Geographic:** Ecuador (primary), United States (secondary)

### Products
- Custom / personalized jewelry pieces
- Non-traditional jewelry (not classic fine jewelry; more expressive, artisanal)
- Women's collection (primary)
- Men's collection (secondary)

---

## CONTENT FUNDAMENTALS

### Voice & Tone
- **Warm, empowering, and intimate.** CACUSA speaks *with* the customer, not *at* them.
- **First person plural ("nosotros/we")** for brand statements: "creamos para que luzcas…" — it's a collaborative act.
- **Second person ("tú/you")** when addressing the customer directly — personal, direct, respectful.
- **Spanish first** for the Ecuadorian audience; English for the US audience. Bilingual where needed.
- **Tone:** Feminine but strong. Elegant but accessible. Celebratory without being excessive.

### Casing
- Brand name always: **CACUSA** (all caps, always)
- Sub-brand: **by Taitus** (lowercase "by", title case "Taitus")
- Headlines: Sentence case or all-caps for impact
- CTAs: Sentence case ("Ver colección", "Personaliza tu pieza")

### Copywriting Style
- Short, poetic phrases. Never corporate or stiff.
- Evokes emotion and self-worth: *"lleva contigo lo que te hace única"*
- Avoid technical jargon about materials — focus on feeling and meaning
- Emoji: Used sparingly on Instagram captions, never in formal brand materials ✨💫 (stars/sparkles only)
- Hashtags: Common on Instagram (#cacusa #joyeriapersonalizada #hechoamano)

### Examples
- "Cada pieza, una historia."
- "Hecha para ti. Pensada por nosotros."
- "Tu estilo. Tu identidad. Tu CACUSA."
- "Shine your way."

---

## VISUAL FOUNDATIONS

### Color System
See `colors_and_type.css` for full CSS variable definitions.

**Brand Palette (from logo):**
- **Rose Pink** `#E8508A` — Primary brand color, energy, femininity
- **Soft Violet** `#B07FEC` — Secondary, dreamy, creative
- **Sky Blue** `#6BBAED` — Tertiary, fresh, open
- **Peach** `#F5A97F` — Warmth, artisanal, human
- **Champagne Gold** `#C9A46A` — Luxury, jewelry, craft

**Neutrals:**
- Near-black `#1A1118` — Slightly warm/purple-tinted black for text
- Dark plum `#2D1B2E` — Rich dark for backgrounds/headers
- Warm white `#FDF8F5` — Off-white background
- Soft grey `#EDE8EA` — Subtle dividers

### Typography
- **Display / Logo:** "CACUSA" in **Bodoni Moda** 900 — alto contraste, editorial de lujo, estilo revista Vogue. Transmite elegancia no-tradicional y fuerza femenina.
- **Script / Accent:** "by Taitus" en **Pinyon Script** — caligrafía refinada, más delicada y premium que Dancing Script.
- **Body Editorial:** **Cormorant Garamond** — ligero, elegante, perfecto para joyería artesanal.
- **UI / Labels / Botones:** **Outfit** — geométrica moderna, muy legible, reemplaza DM Sans con más personalidad.
- **Sizes:** Jerarquía editorial amplia. Wordmark 52–72px; titulares 36–48px; cuerpo 15–18px.

### Backgrounds
- Watercolor gradient washes (pinks → purples → blues) used for hero imagery and key brand moments
- Otherwise: clean warm-white `#FDF8F5` backgrounds with generous white space
- Full-bleed product photography common on Instagram; lifestyle images warm-toned

### Animation & Motion
- Soft fade-ins (opacity 0→1, 400–600ms ease-out)
- Subtle vertical float on hero elements (translateY 8px, ease-in-out, 3s loop)
- No aggressive bounces; motion should feel graceful and slow
- Hover: gentle opacity drop to 0.85 or a soft scale to 1.03

### Hover & Press States
- Buttons: slight scale up (1.02) + shadow deepens on hover; scale down (0.98) on press
- Product cards: translateY(-4px) lift + soft shadow on hover
- Text links: color shift to rose pink; no underline on hover

### Borders & Corners
- **Cards:** 12–16px border radius
- **Buttons:** pill (999px) for primary CTAs; 8px for secondary
- **Images:** 12px radius or full-circle for profile/avatar
- **Borders:** 1px `rgba(232, 80, 138, 0.15)` for subtle pink-tinted borders

### Shadow System
- **Card shadow:** `0 4px 24px rgba(176, 127, 236, 0.12)` — soft violet glow
- **Hover shadow:** `0 8px 32px rgba(232, 80, 138, 0.18)` — rose lift
- **Button shadow:** `0 2px 12px rgba(232, 80, 138, 0.25)`
- No hard box shadows; always soft and diffused

### Imagery & Photography
- **Color vibe:** Warm, slightly desaturated, pastel-adjacent. Never cold or clinical.
- Jewelry on skin (hands, necks, wrists) in warm natural light
- Lifestyle shots: women in natural, confident poses
- Occasional flat-lay product shots on textured light backgrounds
- Never stock-photo-generic; always personal and artisanal-feeling

### Corner Radius Reference
| Element       | Radius       |
|---------------|-------------|
| Cards         | 16px        |
| Buttons (pill)| 999px       |
| Buttons (rect)| 8px         |
| Tags / Badges | 999px       |
| Images        | 12px        |
| Input fields  | 10px        |

### Spacing Scale (8-base)
`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`

### Layout
- Max content width: 1200px centered
- Mobile-first; Instagram-native proportions (1:1, 4:5, 9:16)
- Generous padding; let pieces breathe

---

## ICONOGRAPHY

- **Style:** No formal icon system; minimal line icons used sparingly
- **Icon source:** Lucide Icons (thin stroke, 1.5px weight) — loaded from CDN
- **Usage:** Navigation, utility (cart, search, profile), never decorative
- **Emoji:** ✨ and 💫 only, on Instagram copy; never in UI
- **No custom icon font** found; use Lucide from CDN: `https://unpkg.com/lucide@latest`

---

## File Index

```
/
├── README.md                    ← This file
├── SKILL.md                     ← Agent skill definition
├── colors_and_type.css          ← CSS variables: colors, type, spacing
├── assets/
│   ├── logo.jpg                 ← Official CACUSA logo (CACUSA by Taitus)
│   └── logo-bg.jpg              ← Full watercolor background logo card
├── preview/
│   ├── colors-brand.html        ← Brand color swatches
│   ├── colors-neutral.html      ← Neutral palette
│   ├── colors-semantic.html     ← Semantic color roles
│   ├── type-display.html        ← Display / headline type
│   ├── type-body.html           ← Body / UI type
│   ├── type-scale.html          ← Full type scale
│   ├── spacing.html             ← Spacing tokens
│   ├── shadows.html             ← Shadow system
│   ├── radii.html               ← Border radius tokens
│   ├── buttons.html             ← Button components
│   ├── cards.html               ← Card components
│   ├── badges.html              ← Badges & tags
│   ├── inputs.html              ← Form inputs
│   └── logo-brand.html          ← Logo & brand mark
└── ui_kits/
    └── store/
        ├── README.md            ← UI kit documentation
        └── index.html           ← Interactive store prototype
```
