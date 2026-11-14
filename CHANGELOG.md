# Changelog — CACUSA by Taitus

Este repo es público, así que este archivo es deliberadamente un resumen —
el historial completo y técnico de cada cambio (incluyendo arreglos de
seguridad) vive en el repo privado **`robingonzalez-ux/roggi-notas`**.

No incluye los cientos de commits automáticos `[Admin] Productos` /
`Imagen:` que se generan cada vez que Tita o Robin agregan, editan o suben
fotos de un producto desde el panel admin — eso es mantenimiento normal del
catálogo, no versionamiento del sitio.

Para el historial detallado de cualquier cambio, ver el repo privado o el
historial de git de este repositorio (`git log`).

## 2026-09-27 — SEO y presencia online

- Bing recibe las URLs del sitemap por IndexNow automáticamente.
- Guías con versión en inglés propia (`en/<guía>.html`) y enlaces a categorías/productos con URLs limpias.
- Páginas de producto con foto, precio, descripción y migas en el HTML; categorías con texto de introducción y títulos por búsqueda.
- Títulos de home y tienda, ficha de la marca unificada (teléfono), buscador `?q=`, sin "personalización gratis".
- 45 fotos que eran PNG con nombre .webp recomprimidas (~31 MB → ~1.3 MB); el panel ya no las genera así desde iPhone.
