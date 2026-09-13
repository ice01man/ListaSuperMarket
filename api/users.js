// ================================================================
//  POST /api/users
//  Body: { name, device_key }
//  Busca-o-crea (upsert) el usuario por device_key. Si el correo no
//  existía en la DB, lo inserta y devuelve al usuario nuevo.
//  Devuelve: { id, name, device_key }
// ================================================================
import { getDb } from '../lib/mongodb.js';

// Lee el body venga como venga (objeto ya parseado, string, o stream).
// En algunos entornos Vercel no entrega req.body listo; esto lo cubre.
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const body = await readBody(req);
    const name       = (body.name || '').trim();
    const device_key = (body.device_key || '').trim().toLowerCase();

    if (!name || !device_key) {
      res.status(400).json({ error: 'Faltan datos (name, device_key)' });
      return;
    }

    const db    = await getDb();
    const users = db.collection('users');

    // Upsert atómico: si no existe el device_key, lo crea; si existe, lo devuelve.
    const result = await users.findOneAndUpdate(
      { device_key },
      { $setOnInsert: { name, device_key, created_at: new Date() } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    );

    // Compatibilidad entre versiones del driver (v6 devuelve el doc; v5, { value })
    const user = (result && result.value) ? result.value : result;

    res.status(200).json({
      id:         user._id.toString(),
      name:       user.name,
      device_key: user.device_key
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
