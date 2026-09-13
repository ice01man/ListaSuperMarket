// ================================================================
//  CONEXIÓN A MONGODB (reutilizable entre invocaciones serverless)
//  En Vercel cada función se ejecuta muchas veces; si abriéramos una
//  conexión nueva cada vez, saturaríamos Atlas. Por eso cacheamos la
//  promesa del cliente en `global`.
// ================================================================
import { MongoClient } from 'mongodb';

const uri    = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'SuperMarket';

if (!uri) {
  throw new Error('Falta la variable de entorno MONGODB_URI');
}

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri);
  global._mongoClientPromise = client.connect();
}
const clientPromise = global._mongoClientPromise;

export async function getDb() {
  const client = await clientPromise;
  return client.db(dbName);
}
