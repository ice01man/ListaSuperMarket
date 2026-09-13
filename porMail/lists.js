// ================================================================
//  /api/lists
//
//  GET    ?userId=X&scope=done      → todas las listas guardadas (con items)
//  GET    ?userId=X&scope=draft     → último borrador del usuario (o null)
//  GET    ?id=Y&scope=detail        → una lista puntual (con items)
//  POST                             → crear lista (draft o done). Body completo.
//  PUT    ?id=Y                     → actualizar borrador (total, super, items)
//  DELETE ?id=Y                     → borrar una lista
//
//  Los items van EMBEBIDOS dentro de cada documento de lista.
// ================================================================
import { ObjectId } from 'mongodb';
import { getDb }    from '../lib/mongodb.js';

// Lee el body venga como venga (objeto, string o stream).
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
  try {
    const db    = await getDb();
    const lists = db.collection('shopping_lists');

    // ---------- GET ----------
    if (req.method === 'GET') {
      const { userId, scope, id } = req.query;

      if (scope === 'detail') {
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const doc = await lists.findOne({ _id: toId(id) });
        if (!doc) return res.status(404).json({ error: 'No encontrada' });
        return res.status(200).json(serialize(doc));
      }

      if (!userId) return res.status(400).json({ error: 'Falta userId' });

      if (scope === 'draft') {
        const doc = await lists
          .find({ user_id: userId, status: 'draft' })
          .sort({ created_at: -1 })
          .limit(1)
          .next();
        return res.status(200).json(doc ? serialize(doc) : null);
      }

      // scope 'done' (por defecto)
      const docs = await lists
        .find({ user_id: userId, status: 'done' })
        .sort({ created_at: -1 })
        .limit(200)
        .toArray();
      return res.status(200).json(docs.map(serialize));
    }

    // ---------- POST (crear) ----------
    if (req.method === 'POST') {
      const b = await readBody(req);
      const doc = {
        user_id:     b.userId,
        label:       b.label,
        month:       b.month,
        year:        b.year,
        supermarket: b.supermarket || null,
        total:       Number(b.total) || 0,
        status:      b.status || 'draft',
        items:       cleanItems(b.items),
        created_at:  new Date()
      };
      const result = await lists.insertOne(doc);
      return res.status(201).json({ id: result.insertedId.toString() });
    }

    // ---------- PUT (actualizar borrador) ----------
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta id' });
      const b = await readBody(req);
      await lists.updateOne(
        { _id: toId(id) },
        { $set: {
            total:       Number(b.total) || 0,
            supermarket: b.supermarket || null,
            items:       cleanItems(b.items),
            status:      b.status || 'draft'
        } }
      );
      return res.status(200).json({ ok: true });
    }

    // ---------- DELETE ----------
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta id' });
      await lists.deleteOne({ _id: toId(id) });
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// ---------- helpers ----------
function toId(id) {
  return new ObjectId(String(id));
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(i => ({
    product_name: i.product_name,
    quantity:     Number(i.quantity)    || 0,
    unit_price:   Number(i.unit_price)  || 0,
    total_price:  Number(i.total_price) || 0
  }));
}

function serialize(doc) {
  return {
    id:          doc._id.toString(),
    user_id:     doc.user_id,
    label:       doc.label,
    month:       doc.month,
    year:        doc.year,
    supermarket: doc.supermarket || null,
    total:       doc.total || 0,
    status:      doc.status,
    created_at:  doc.created_at,
    items:       cleanItems(doc.items)
  };
}
