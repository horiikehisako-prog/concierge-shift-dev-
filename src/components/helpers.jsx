const getDays  = (y,m) => new Date(y,m,0).getDate();
const getWday  = (y,m,d) => WEEKDAYS[new Date(y,m-1,d).getDay()];
const getWdayI = (y,m,d) => new Date(y,m-1,d).getDay();
const p2   = n => String(n).padStart(2,"0");
const ymS  = (y,m) => `${y}-${p2(m)}`;
const normV= vs => vs.map(v => typeof v==="string"?{name:v,options:[]}:v);
const normClients = clients => ensureArray(clients).map(c => {
  if(typeof c==="string") return {name:c,locations:[]};
  return {name:c.name,locations:ensureArray(c.locations)};
}).filter(c=>c.name);
const clientsToVenues = clients => normClients(clients).flatMap(client =>
  client.locations.map(location => ({name:location,client:client.name,options:[]}))
);
const venuesToClients = venues => {
  const map={};
  normV(ensureArray(venues)).forEach(v=>{
    const client=v.client||"飛鳥会館";
    if(!map[client]) map[client]=[];
    const locations=v.options&&v.options.length?v.options:[v.name];
    locations.forEach(location=>{ if(location&&!map[client].includes(location)) map[client].push(location); });
  });
  return Object.entries(map).map(([name,locations])=>({name,locations}));
};
// Firebaseが配列をオブジェクトに変換する問題を防ぐ
const ensureArray = v => {
  if(!v) return [];
  if(Array.isArray(v)) return v;
  return Object.values(v); // Firebase が {0:"a",1:"b"} に変換した場合の対応
};
const yen  = n => n.toLocaleString("ja-JP")+"円";

const parseHours = (s="09:00",e="16:00",breakMin=60) => {
  const [sh,sm]=s.split(":").map(Number);
  const [eh,em]=e.split(":").map(Number);
  const total=(eh*60+em)-(sh*60+sm);
  return Math.round((total-breakMin)/60*100)/100;
};

const downloadCSV = (filename, rows) => {
  const bom="\uFEFF";
  const csv=bom+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=filename;a.click();
  URL.revokeObjectURL(url);
};

const PREF_OK = "ok";
const PREF_MAYBE = "maybe";
const PREF_NG = "ng";
const PREF_LABELS = {[PREF_OK]:"○", [PREF_MAYBE]:"△", [PREF_NG]:"×"};

const normalizePrefMap = value => {
  const map = {};
  if(Array.isArray(value)){
    value.forEach(d => { map[d] = PREF_OK; });
    return map;
  }
  if(value && typeof value === "object"){
    Object.entries(value).forEach(([d,status]) => {
      if(status === PREF_OK || status === PREF_MAYBE || status === PREF_NG) map[d] = status;
      else if(status === true) map[d] = PREF_OK;
    });
  }
  return map;
};

const prefStatus = (prefs, staffName, day) => normalizePrefMap((prefs||{})[staffName])[day] || PREF_NG;
const prefIsOk = (prefs, staffName, day) => prefStatus(prefs, staffName, day) === PREF_OK;
const prefIsMaybe = (prefs, staffName, day) => prefStatus(prefs, staffName, day) === PREF_MAYBE;
const prefLabel = (prefs, staffName, day) => PREF_LABELS[prefStatus(prefs, staffName, day)] || "×";

