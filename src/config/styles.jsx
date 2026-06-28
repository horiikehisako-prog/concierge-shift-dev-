const C={
  bg:"#fdf5f0", white:"#fff", border:"#f5ddd0",
  text:"#3d1a0a", muted:"#b08070", navy:"#c2613a",
  blue:"#e8784a",  blueL:"#fde8d8",
  green:"#16a34a", greenL:"#dcfce7",
  purple:"#d4766a",
  red:"#dc2626",   redL:"#fee2e2",
  amber:"#d4903a", amberL:"#fef3c7",
  teal:"#d4903a",  tealL:"#fef9c3",
  sat:"#e8914a",   sun:"#dc2626",
  office:"#b87040",
};
const GC={background:"rgba(255,255,255,.92)",borderRadius:14,padding:20,
  boxShadow:"0 2px 12px rgba(30,58,95,.08)",border:`1px solid ${C.border}`,marginBottom:14};
const Btn=(bg=C.blue,fg="#fff")=>({background:bg,color:fg,border:"none",borderRadius:8,
  padding:"9px 18px",cursor:"pointer",fontSize:13,fontWeight:700});
const TH={padding:"8px 6px",borderBottom:`2px solid ${C.border}`,fontWeight:700,
  textAlign:"center",fontSize:12,color:C.muted,whiteSpace:"nowrap"};
const TD={padding:"6px 8px",borderBottom:`1px solid ${C.border}`,fontSize:13};
