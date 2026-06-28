const getDays  = (y,m) => new Date(y,m,0).getDate();
const getWday  = (y,m,d) => WEEKDAYS[new Date(y,m-1,d).getDay()];
const getWdayI = (y,m,d) => new Date(y,m-1,d).getDay();
const p2   = n => String(n).padStart(2,"0");
const ymS  = (y,m) => `${y}-${p2(m)}`;
const normV= vs => vs.map(v => typeof v==="string"?{name:v,options:[]}:v);
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

