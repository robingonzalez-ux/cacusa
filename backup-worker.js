/**
 * Cacusa Backup Worker — respaldo diario de Firebase + Cloudflare KV a R2.
 * Deploy to Cloudflare Workers as: cacusa-backup.facturacioncacusa.workers.dev
 *
 * Por qué existe:
 *   Ni Firebase Realtime Database (suscriptoras de Cacusa Lovers, reseñas) ni Cloudflare
 *   KV (pedidos, gift cards, cupones) tienen ningún respaldo — a diferencia de
 *   data/products.json y el código de los Workers, que ya están cubiertos por el
 *   historial de git. KV además no tiene versionado ni papelera de reciclaje: un
 *   `delete` o un `put` que pisa un valor es irreversible. Este Worker es la única red
 *   de seguridad para esos dos.
 *
 *   Los backups van a un bucket R2 PRIVADO (nunca al repo de GitHub — ese repo es
 *   público, cualquier rama incluida workers-src es legible por cualquiera aunque
 *   GitHub Pages no la sirva como sitio; guardar ahí datos de clientas los expondría).
 *
 * Ningún Worker existente tiene a la vez acceso a Firebase y al binding de KV sin
 * ampliar su superficie de secretos fuera de su propósito actual (cacusa-admin y
 * cacusa-square tienen CACUSA_KV pero no Firebase; cacusa-lovers-webhook tiene Firebase
 * pero no KV) — por eso este es un Worker aparte, chico y de un solo propósito.
 *
 * Environment variables (Secrets in CF Dashboard):
 *   FB_DB_SECRET      — MISMO valor que ya tiene el Worker cacusa-lovers-webhook.
 *   FB_DB_URL         — MISMO valor (https://cacusa-pos-default-rtdb.firebaseio.com).
 *   ORDER_INGEST_KEY  — MISMO valor que los otros 3 Workers. Se usa para avisarle a
 *                       cacusa-admin (vía POST /push/notify) que un backup falló — sin
 *                       este secret, la alerta simplemente no se envía (el backup en sí
 *                       no depende de esto, solo la notificación de fallo).
 *   BACKUP_TRIGGER_KEY — nuevo, generar un valor random largo. Autentica a un humano
 *                       (vos, o una sesión de Claude) llamando POST /run o GET /status a
 *                       mano — NO es Worker-a-Worker como ORDER_INGEST_KEY, es un
 *                       secreto operativo tuyo. Nunca lo comparte con otro Worker.
 *
 * Bindings (Cloudflare → Settings → Bindings):
 *   CACUSA_KV  — el namespace EXISTENTE, el mismo que ya usan cacusa-admin/cacusa-square.
 *   BACKUP_R2  — bucket R2 nuevo, privado (crear "cacusa-backups", NO activar "Public
 *                access" en su configuración).
 *
 * Cron Trigger (Cloudflare → cacusa-backup → Triggers → Cron Triggers):
 *   0 9 * * *  (09:00 UTC = 04:00 Ecuador) — diario. Volumen de escritura bajo (no hay
 *   pedidos/suscriptoras por minuto), perder hasta 24h en el peor caso es aceptable a
 *   este tamaño de negocio; semanal dejaría una ventana de pérdida demasiado grande.
 *
 * Retención (Cloudflare → bucket cacusa-backups → Settings → Object Lifecycle Rules):
 *   Regla sobre el prefijo "backups/": borrar objetos con más de 90 días. Configurable
 *   desde el dashboard sin tocar código. NO debe aplicar a "_status.json" (vive en la
 *   raíz del bucket, fuera del prefijo "backups/", justamente para que la regla nunca
 *   lo toque).
 *
 * Rutas (nunca las llama un navegador — sin CORS, sin origin-check):
 *   POST /run     → dispara un backup manual on-demand (autenticado con BACKUP_TRIGGER_KEY)
 *   GET  /status  → resultado de la última corrida (mismo secret)
 *
 * ──────────────────────────────────────────────────────────────────────────────────
 * RESTAURACIÓN (manual, deliberada — nunca automática desde este Worker):
 *
 * 1. Cloudflare Dashboard → R2 → bucket cacusa-backups → carpeta backups/ → identificar
 *    el objeto correcto por fecha (el ÚLTIMO ANTES del incidente, no necesariamente el
 *    más reciente) → Download.
 *
 * 2. Abrir el JSON descargado. Estructura: { version, generatedAt, trigger,
 *    firebase: {...}, kv: {...} }.
 *
 * 3. Restaurar Firebase — elegir el alcance más chico posible:
 *
 *    a) Un solo registro (recomendado, más quirúrgico):
 *       PATCH ${FB_DB_URL}/cacusa_lovers/<key>.json?auth=${FB_DB_SECRET}
 *       body = backup.firebase.cacusa_lovers[<key>]
 *
 *    b) Una rama completa (ej. si se corrompió toda cacusa_reviews):
 *       PUT ${FB_DB_URL}/cacusa_reviews.json?auth=${FB_DB_SECRET}
 *       body = backup.firebase.cacusa_reviews
 *
 *    c) Todo el árbol (ÚLTIMO recurso, destructivo — pisa TODO lo escrito después de
 *       generatedAt). Antes de hacerlo, correr POST /run en este mismo Worker para
 *       respaldar el estado actual (aunque esté roto), por si hace falta algo de ahí
 *       después:
 *       PUT ${FB_DB_URL}/.json?auth=${FB_DB_SECRET}
 *       body = backup.firebase
 *
 * 4. Restaurar KV — por cada key en backup.kv.orders / .giftcards / .coupons /
 *    .webauthnCredentials:
 *       env.CACUSA_KV.put(key, JSON.stringify(value))
 *    (la key ya viene completa, ej. "order:1042" — poner tal cual).
 *    Para leads/surcharges/markets:
 *       env.CACUSA_KV.put('leads', JSON.stringify(backup.kv.leads)), etc.
 *
 *    IMPORTANTE: si se restauran keys order:*, borrar después la key orders_cache
 *    (env.CACUSA_KV.delete('orders_cache')) — si no, el panel admin sigue sirviendo la
 *    caché vieja hasta que algo la reconstruya (handleLoad en admin-worker.js solo
 *    reconstruye la caché cuando orders_cache NO existe).
 *
 *    El dashboard de Cloudflare permite editar keys de KV una por una (Workers → KV →
 *    namespace → buscar key) — para restaurar muchas de una, considerar un endpoint
 *    POST /restore/kv en este Worker (no construido todavía — YAGNI, solo agregarlo si
 *    un incidente real demuestra que restaurar a mano es demasiado lento).
 * ──────────────────────────────────────────────────────────────────────────────────
 */

const ADMIN_WORKER_URL = 'https://cacusa-admin.facturacioncacusa.workers.dev';
const STATUS_KEY = '_status.json'; // raíz del bucket, fuera de backups/ — la lifecycle rule no lo toca

// ── Avisa a cacusa-admin para que mande la notificación push — best-effort, nunca
// bloquea el flujo si falla. Copiado tal cual del mismo patrón en lovers-webhook-worker.js.
async function notifyAdminPush(title, body, env) {
  if (!env.ORDER_INGEST_KEY) {
    console.error('notifyAdminPush: ORDER_INGEST_KEY no está configurado en este Worker — la notificación no se envía.');
    return;
  }
  try {
    const r = await fetch(`${ADMIN_WORKER_URL}/push/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Ingest-Key': env.ORDER_INGEST_KEY },
      body: JSON.stringify({ title, body, url: 'https://cacusabytaitus.com/ui_kits/admin/' }),
    });
    if (!r.ok) console.error('push/notify failed:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('push/notify error:', e.message);
  }
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function isAuthorized(request, env) {
  return !!env.BACKUP_TRIGGER_KEY && safeEqual(request.headers.get('x-backup-key') || '', env.BACKUP_TRIGGER_KEY);
}
function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── Firebase completo, un solo llamado (árbol chico — texto corto, nada de fotos) ──
async function exportFirebase(env) {
  const r = await fetch(`${env.FB_DB_URL}/.json?auth=${env.FB_DB_SECRET}`);
  if (!r.ok) throw new Error('Firebase export ' + r.status);
  return r.json();
}

// ── KV: mismo patrón de paginación por prefijo ya usado en admin-worker.js (listAllOrders) ──
async function listKvPrefix(env, prefix) {
  const out = {};
  let cursor;
  do {
    const page = await env.CACUSA_KV.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.CACUSA_KV.get(k.name);
      if (raw != null) { try { out[k.name] = JSON.parse(raw); } catch (_) { out[k.name] = raw; } }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
async function getKvValue(env, key) {
  const raw = await env.CACUSA_KV.get(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

// Prefijos/llaves respaldadas: pedidos, gift cards, cupones, credenciales WebAuthn, y
// las 3 llaves sueltas de config/leads. Deliberadamente excluido: orders_cache (se
// reconstruye solo) y todo lo que es rate-limit/challenge de TTL corto (loginrl:,
// cpused:, wac:, walc:, refmonth:, push:) — ruido regenerable, no datos de negocio.
async function exportKv(env) {
  const [orders, giftcards, coupons, webauthnCredentials, leads, surcharges, markets] = await Promise.all([
    listKvPrefix(env, 'order:'),
    listKvPrefix(env, 'gc:'),
    listKvPrefix(env, 'coupon:'),
    listKvPrefix(env, 'wacred:'),
    getKvValue(env, 'leads'),
    getKvValue(env, 'surcharges'),
    getKvValue(env, 'markets'),
  ]);
  return { orders, giftcards, coupons, webauthnCredentials, leads, surcharges, markets };
}

function backupKey(iso, trigger) {
  return `backups/${iso.replace(/[:.]/g, '-')}${trigger === 'manual' ? '-manual' : ''}.json`;
}

async function writeStatus(env, result) {
  await env.BACKUP_R2.put(STATUS_KEY, JSON.stringify(result), { httpMetadata: { contentType: 'application/json' } });
}
async function readStatus(env) {
  const obj = await env.BACKUP_R2.get(STATUS_KEY);
  if (!obj) return null;
  return obj.json();
}

async function fail(env, stage, error, startedAt, meta) {
  const result = {
    ok: false, stage, error: String((error && error.message) || error),
    startedAt, finishedAt: new Date().toISOString(), trigger: meta.trigger,
  };
  console.error('cacusa-backup failed:', stage, result.error);
  await writeStatus(env, result).catch(() => {});
  await notifyAdminPush('Backup CACUSA falló', `Etapa: ${stage}. ${result.error}`.slice(0, 200), env);
  return result;
}

// ── Arma Firebase, después KV, y solo escribe a R2 si AMBAS partes salieron bien —
// mejor no tener el backup de hoy que tener uno incompleto que parece completo. ──────
async function runBackup(env, meta) {
  const startedAt = new Date().toISOString();

  let firebase;
  try { firebase = await exportFirebase(env); }
  catch (e) { return fail(env, 'firebase', e, startedAt, meta); }

  let kv;
  try { kv = await exportKv(env); }
  catch (e) { return fail(env, 'kv', e, startedAt, meta); }

  const payload = { version: 1, generatedAt: startedAt, trigger: meta.trigger, firebase, kv };
  const body = JSON.stringify(payload);
  const key = backupKey(startedAt, meta.trigger);
  try {
    await env.BACKUP_R2.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  } catch (e) { return fail(env, 'r2-put', e, startedAt, meta); }

  const result = { ok: true, key, bytes: body.length, startedAt, finishedAt: new Date().toISOString(), trigger: meta.trigger };
  await writeStatus(env, result).catch(() => {});
  return result;
}

export default {
  // Cloudflare no reintenta automáticamente un scheduled() que falla (a diferencia de
  // Queues) — la notificación push de fail() es la única red de seguridad.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBackup(env, { trigger: 'cron' }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/run') {
      if (!isAuthorized(request, env)) return json({ error: 'No permitido' }, 403);
      const result = await runBackup(env, { trigger: 'manual' });
      return json(result, result.ok ? 200 : 500);
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      if (!isAuthorized(request, env)) return json({ error: 'No permitido' }, 403);
      const status = await readStatus(env);
      return json(status || { error: 'Sin backups todavía' }, status ? 200 : 404);
    }

    return json({ error: 'Not found' }, 404);
  },
};
