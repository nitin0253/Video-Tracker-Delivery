import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const data = await kv.get('vin-tracker:data');
    if (!data) {
      return res.status(503).json({ error: 'Cache not yet populated — waiting for first sync' });
    }
    if (req.query.debug === '1') {
      return res.status(200).json({
        totalVideos: data.rows.length,
        totalEnts:   data.ents.length,
        sampleRow:   data.rows[0],
        sampleEnt:   data.ents[0],
        uniqueType:  [...new Set(data.rows.map(r => r.type).filter(Boolean))],
        uniqueCrm:   [...new Set(data.rows.map(r => r.crmStatus).filter(Boolean))],
        lastSynced:  data.lastSynced,
      });
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
