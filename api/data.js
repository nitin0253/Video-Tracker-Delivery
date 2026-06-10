let videoCache = null, entCache = null, lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;
const VIDEO_URL = "https://metabase.spyne.ai/public/question/9bff7307-a936-4618-b179-0c2f898210a8.csv";
const ENT_URL   = "https://metabase.spyne.ai/public/question/b8f1271c-cc5a-470f-badf-807711f74af4.csv";

function splitRow(row) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') { if (q && row[i+1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim()); return out;
}
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitRow(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitRow(line), obj = {};
    headers.forEach((h, j) => { obj[h] = (vals[j] ?? '').trim(); });
    return obj;
  });
}
function pick(r, ...names) {
  for (const n of names) { const v = r[n]; if (v != null && String(v).trim()) return String(v).trim(); }
  return '';
}
function hoursAgo(ts, now) {
  if (!ts) return null;
  // handles DD/MM/YY HH:MM format from Metabase
  const m = ts.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  const d = m ? new Date(`20${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00Z`) : new Date(ts);
  if (isNaN(d)) return null;
  const h = (now - d) / 3600000; return h >= 0 ? h : null;
}

async function buildCache() {
  if (videoCache && Date.now() - lastFetch < CACHE_TTL) return { videoCache, entCache };
  const now = Date.now();

  const [videoResp, entResp] = await Promise.all([
    fetch(VIDEO_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
    fetch(ENT_URL,   { headers: { 'User-Agent': 'Mozilla/5.0' } }),
  ]);
  if (!videoResp.ok) throw new Error(`Video CSV ${videoResp.status}`);
  const rawVideo = parseCSV(await videoResp.text());

  const entMap = {};
  if (entResp.ok) {
    const rawEnt = parseCSV(await entResp.text());
    rawEnt.forEach(r => {
      const id = pick(r, 'dt.enterprise_id', 'enterprise_id', 'enterpriseId');
      if (id) {
        entMap[id] = {
          name:            pick(r, 'name', 'enterprise_name'),
          type:            pick(r, 'type'),
          stage:           pick(r, 'stage'),
          email:           pick(r, 'email_id', 'email', 'poc_email'),
          customerSegment: pick(r, 'customer_segment', 'customerSegment'),
        };
      }
    });
  }

  videoCache = rawVideo.map(r => {
    const eid = pick(r, 'Ent_ID');
    const tid = pick(r, 'Team_ID');
    const ent = entMap[eid] || {};
    const pocEmail = pick(r, 'POC_CS') || pick(r, 'POC_OB') || ent.email || '';
    const tempType = pick(r, 'Temp_Type');
    const viewMode  = pick(r, 'View_Mode');
    const source    = pick(r, 'source');
    return {
      vin:             pick(r, 'VIN'),
      videoId:         pick(r, 'Video_ID'),
      eid,
      entName:         ent.name || pick(r, 'Ent_Name') || eid,
      entStage:        ent.stage || '',
      entEmail:        ent.email || pocEmail,
      pocEmail,
      teamId:          tid,
      teamName:        pick(r, 'Team_Name') || tid,
      customerSegment: ent.customerSegment || '',
      crmStatus:       pick(r, 'CRM_Status'),
      rb:              'QC Pending',
      tempType,
      type:            source,
      holdReason:      pick(r, 'rejected_reason'),
      createdOn:       pick(r, 'Created_ON'),
      updatedOn:       pick(r, 'Updated_ON'),
      hrsRecv:         hoursAgo(pick(r, 'Created_ON'), now),
      videoUrl:        pick(r, 'video_url'),
      websiteLink:     pick(r, 'website_link'),
      logoUrl:         pick(r, 'logo_url'),
    };
  });

  entCache = Object.entries(entMap).map(([id, e]) => ({ id, ...e }));
  lastFetch = now;
  return { videoCache, entCache };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    if (req.query.force === '1') { videoCache = null; entCache = null; lastFetch = 0; }
    const { videoCache: rows, entCache: ents } = await buildCache();
    if (req.query.debug === '1') {
      return res.status(200).json({
        totalVideos: rows.length, totalEnts: ents.length,
        sampleRow:   rows[0],    sampleEnt: ents[0],
        uniqueType:  [...new Set(rows.map(r => r.type).filter(Boolean))],
        uniqueCrm:   [...new Set(rows.map(r => r.crmStatus).filter(Boolean))],
      });
    }
    res.status(200).json({ rows, ents, total: rows.length, lastSynced: new Date(lastFetch).toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
