function VenueView(P){
  const [tab,setTab]=useState("confirm");
  const tabs=[
    {id:"confirm",label:"📍 会場確定"},
    {id:"shift",  label:"📅 シフト確認"},
    {id:"att",    label:"✅ 出勤承認"},
    {id:"print",  label:"🖨️ 出勤表"},
  ];
  return <div><MonthSel {...P}/><Tabs tabs={tabs} active={tab} onChange={setTab}/>
    {tab==="confirm"&&<VenueConfirm {...P}/>}
    {tab==="shift"  &&<PublicShift {...P} uname=""/>}
    {tab==="att"    &&<VenueAtt {...P}/>}
    {tab==="print"  &&<PrintableSheet {...P}/>}
  </div>;
}

function VenueConfirm({year,month,shifts,vconf,sv,cfg,flash}){
  const today=new Date(),todayD=today.getDate();
  const isTM=year===today.getFullYear()&&month===today.getMonth()+1;
  const days=getDays(year,month);
  const flex=cfg.venues.filter(v=>v.options.length>0);
  const confirm=(d,c)=>{sv.vconf({...vconf,[d]:c});flash(`✅ ${month}/${d} → ${c} に確定しました`);};
  const unconfirm=d=>{const nv={...vconf};delete nv[d];sv.vconf(nv);flash("取消しました");};

  const rows=[];
  for(let d=1;d<=days;d++) for(const v of flex){
    const s=shifts[d]?.[v.name];
    if(s)rows.push({d,v,s,du:isTM?d-todayD:null,confirmed:vconf[d]||null});
  }
  const pending=rows.filter(r=>!r.confirmed);
  const done   =rows.filter(r=> r.confirmed);
  const urgent =pending.filter(r=>r.du!==null&&r.du>=0&&r.du<=1);
  const rest   =pending.filter(r=>!urgent.includes(r));

  return <div>
    {urgent.map(({d,v,s,du})=>(
      <div key={d} style={{background:"linear-gradient(135deg,#dc2626,#b91c1c)",color:"#fff",
        borderRadius:14,padding:20,marginBottom:12,boxShadow:"0 4px 20px rgba(220,38,38,.3)"}}>
        <div style={{fontSize:12,fontWeight:700,opacity:.8,marginBottom:4}}>
          ⚠️ {du===0?"【本日】":"【明日】"} 会場を確定してください
        </div>
        <div style={{fontSize:20,fontWeight:800,marginBottom:2}}>{month}/{d}({getWday(year,month,d)}) {s}さん</div>
        <div style={{fontSize:13,opacity:.8,marginBottom:16}}>どちらの会場に入りますか？</div>
        <div style={{display:"flex",gap:12}}>
          {v.options.map(opt=>(
            <button key={opt} onClick={()=>confirm(d,opt)}
              style={{flex:1,background:"#fff",color:C.red,border:"none",borderRadius:12,
                padding:"16px 10px",cursor:"pointer",fontSize:18,fontWeight:800,
                boxShadow:"0 2px 8px rgba(0,0,0,.2)"}}>📍 {opt}</button>
          ))}
        </div>
      </div>
    ))}
    {rest.length>0&&<div style={GC}>
      <h3 style={{margin:"0 0 12px",fontSize:14,color:C.amber}}>⏳ 未確定（{rest.length}件）</h3>
      {rest.map(({d,v,s,du})=>{
        const wdi=getWdayI(year,month,d);
        return <div key={d} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
          borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}>
          <span style={{fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.text}}>
            {month}/{d}({getWday(year,month,d)})
          </span>
          {du!==null&&du>1&&<span style={{fontSize:12,color:C.muted}}>あと{du}日</span>}
          {du!==null&&du<0&&<span style={{fontSize:11,color:C.red}}>（過去）</span>}
          <span style={{fontWeight:600}}>{s}</span>
          <div style={{marginLeft:"auto",display:"flex",gap:6}}>
            {v.options.map(opt=><button key={opt} onClick={()=>confirm(d,opt)}
              style={{...Btn(C.teal),fontSize:13,padding:"7px 16px"}}>📍 {opt}</button>)}
          </div>
        </div>;
      })}
    </div>}
    {done.length>0&&<div style={GC}>
      <h3 style={{margin:"0 0 12px",fontSize:14,color:C.green}}>✅ 確定済み（{done.length}件）</h3>
      {done.map(({d,s,confirmed})=>{
        const wdi=getWdayI(year,month,d);
        return <div key={d} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
          borderBottom:`1px solid ${C.border}`,padding:"10px 0"}}>
          <span style={{fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.text}}>{month}/{d}({getWday(year,month,d)})</span>
          <span style={{fontWeight:600}}>{s}</span>
          <span style={{background:C.tealL,color:C.teal,borderRadius:6,padding:"2px 10px",fontSize:13,fontWeight:700}}>📍 {confirmed}</span>
          <button onClick={()=>unconfirm(d)} style={{marginLeft:"auto",color:C.muted,background:"none",
            border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>取消</button>
        </div>;
      })}
    </div>}
{pending.length===0&&done.length===0&&
      <div style={{...GC,textAlign:"center",color:C.muted,padding:48}}>
        <div style={{fontSize:36,marginBottom:8}}>✅</div>
        <p style={{margin:0}}>この月の確定作業はありません</p>
      </div>}
  </div>;
}

function VenueAtt({year,month,att,shifts,cfg,sv,flash}){
  const {venues}=cfg,days=getDays(year,month);
  const rows=[];
  for(let d=1;d<=days;d++) for(const v of venues){
    const key=`${d}-${v.name}`,rec=att[key],sched=shifts[d]?.[v.name]||"";
    if(rec||sched)rows.push({d,venue:v.name,sched,rec,key});
  }
  const [showAll,setShowAll]=useState(false);
  const display=showAll?rows:rows.filter(r=>r.rec&&!r.rec.verified&&!r.rec.rejected);
  const approve=key=>{sv.att({...att,[key]:{...att[key],verified:true,rejected:false}});flash("✅ 承認しました");};
  const reject=key=>{sv.att({...att,[key]:{...att[key],verified:false,rejected:true}});flash("却下しました");};
  return <div>
    <div style={{...GC,display:"flex",gap:20,alignItems:"center"}}>
      {[["未承認",rows.filter(r=>r.rec&&!r.rec.verified&&!r.rec.rejected).length,C.red],
        ["承認済",rows.filter(r=>r.rec?.verified).length,C.green],
        ["却下",rows.filter(r=>r.rec?.rejected).length,C.muted]].map(([l,v,c])=>(
        <div key={l} style={{textAlign:"center"}}><div style={{fontSize:24,fontWeight:800,color:c}}>{v}</div>
          <div style={{fontSize:11,color:C.muted}}>{l}</div></div>))}
      <button onClick={()=>setShowAll(x=>!x)} style={{...Btn(C.bg,C.muted),border:`1px solid ${C.border}`,marginLeft:"auto",fontSize:12}}>{showAll?"未承認のみ":"全件表示"}</button>
    </div>
    <div style={{...GC,overflowX:"auto",padding:0}}>
      {display.length===0&&<p style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>未承認の記録はありません</p>}
      {display.length>0&&<table style={{width:"100%",borderCollapse:"collapse",minWidth:440}}>
        <thead><tr style={{background:"#f8f9fb"}}>
          <th style={TH}>日付</th><th style={TH}>曜</th><th style={TH}>会場</th>
          <th style={TH}>コンシェルジュ</th><th style={TH}>時間</th><th style={TH}>状態</th>
        </tr></thead>
        <tbody>{display.map(({d,venue,sched,rec,key})=>{
          const wdi=getWdayI(year,month,d);
          return <tr key={key} style={{background:rec?.verified?"#f0fdf4":"#fff"}}>
            <td style={{...TD,textAlign:"center",fontWeight:700}}>{month}/{d}</td>
            <td style={{...TD,textAlign:"center",fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,d)}</td>
            <td style={TD}>{venue}</td>
            <td style={{...TD,fontWeight:600}}>{rec?.staff||sched||"−"}</td>
            <td style={{...TD,color:C.muted}}>{rec?`${rec.start}〜${rec.end}`:"未入力"}</td>
            <td style={{...TD,textAlign:"center"}}>
              {!rec&&<span style={{color:C.amber,fontSize:12,fontWeight:600}}>未入力</span>}
              {rec&&!rec.verified&&!rec.rejected&&<div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
                <button onClick={()=>approve(key)} style={{...Btn(C.purple),fontSize:12,padding:"5px 12px"}}>承認</button>
                <button onClick={()=>reject(key)} style={{...Btn(C.muted),fontSize:12,padding:"5px 12px"}}>却下</button>
              </div>}
              {rec?.verified&&<span style={{color:C.green,fontSize:12,fontWeight:700}}>✅ 承認済</span>}
              {rec?.rejected&&<span style={{color:C.muted,fontSize:12,fontWeight:700}}>却下</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// 司会・アシスタント専用ビュー
// ═══════════════════════════════════════════════════════════════
