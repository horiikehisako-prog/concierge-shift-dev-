function AdminView(P){
  const [tab,setTab]=useState("pref");
  const tabs=[
    {id:"pref",  label:"📋 希望一覧"},
    {id:"shift", label:"📅 シフト確定"},
    {id:"att",   label:"🕐 出勤記録"},
    {id:"mc",    label:"🎤 司会設定"},
    {id:"config",label:"⚙️ 設定"},
  ];
  return <div><MonthSel {...P}/><Tabs tabs={tabs} active={tab} onChange={setTab}/>
    {tab==="pref"  &&<AdminPrefView  {...P}/>}
    {tab==="shift" &&<AdminShiftView {...P}/>}
    {tab==="att"   &&<AdminAttView   {...P}/>}
    {tab==="mc"    &&<MCConfigTab    {...P}/>}
    {tab==="config"&&<AdminConfig    {...P}/>}
  </div>;
}

function AdminPrefView({year,month,prefs,shifts,cfg}){
  const days=getDays(year,month);
  const {staff,venues}=cfg;
  const need=venues.length;
  const today=new Date();
  const deadlineMonth=month===1?12:month-1;
  const deadlineYear =month===1?year-1:year;
  const deadline=new Date(deadlineYear,deadlineMonth-1,16,23,59,59);
  const isLocked=today>deadline;
  const diffDays=Math.ceil((deadline-today)/(1000*60*60*24));
  const dayInfo=Array.from({length:days},(_,i)=>{
    const d=i+1;
    const applicants=staff.filter(s=>(prefs[s]||[]).includes(d));
    const assigned=venues.map(v=>shifts[d]?.[v.name]).filter(Boolean);
    return {d,applicants,assigned};
  });
  const over =dayInfo.filter(x=>x.applicants.length>need);
  const under=dayInfo.filter(x=>x.applicants.length>0&&x.applicants.length<need);
  const empty=dayInfo.filter(x=>x.applicants.length===0);
  return <div>
    {/* 締め切りバナー */}
    <div style={{...GC,
      background:isLocked?"#fff0f0":diffDays<=3?"#fff0f0":diffDays<=7?C.amberL:C.greenL,
      border:`1px solid ${isLocked?C.red:diffDays<=3?C.red:diffDays<=7?C.amber:C.green}`,
      padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:20}}>{isLocked?"🔒":diffDays<=3?"⚠️":"📅"}</span>
      <div>
        <div style={{fontWeight:700,fontSize:13,
          color:isLocked?C.red:diffDays<=7?C.amber:C.green}}>
          {year}年{month}月分　希望締め切り: {deadlineMonth}月16日
        </div>
        <div style={{fontSize:12,color:C.muted,marginTop:2}}>
          {isLocked?"受付終了 — シフト作成可能です":
           diffDays<=0?"本日締め切りです！":
           `あと${diffDays}日で締め切り`}
        </div>
      </div>
    </div>
    <div style={{...GC,display:"flex",gap:20,flexWrap:"wrap"}}>
      {[["⚠️ 要調整",over.length,C.red],["⚡ 不足",under.length,C.amber],
        ["❌ 希望なし",empty.length,C.muted],["✅ 正常",dayInfo.filter(x=>x.applicants.length>=need).length,C.green]
      ].map(([l,v,c])=><div key={l} style={{textAlign:"center",minWidth:70}}>
        <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
        <div style={{fontSize:11,color:C.muted}}>{l}</div>
      </div>)}
    </div>
    {over.length>0&&<div style={{...GC,border:`2px solid ${C.red}`}}>
      <h3 style={{margin:"0 0 10px",color:C.red,fontSize:14}}>⚠️ 調整が必要な日（{need}名を超えています）</h3>
      {over.map(({d,applicants,assigned})=>{
        const wdi=getWdayI(year,month,d);
        return <div key={d} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
          borderBottom:`1px solid ${C.border}`,padding:"8px 0"}}>
          <span style={{fontWeight:700,minWidth:72,color:wdi===0?C.sun:wdi===6?C.sat:C.text}}>
            {month}/{d}({getWday(year,month,d)})
          </span>
          <div style={{display:"flex",gap:4,flex:1,flexWrap:"wrap"}}>
            {applicants.map(s=><span key={s} style={{background:C.redL,color:C.red,borderRadius:5,
              padding:"2px 8px",fontSize:12,fontWeight:600}}>{s}</span>)}
          </div>
          <span style={{fontSize:12,color:C.red,fontWeight:700}}>{applicants.length}名 → {need}名に絞る</span>
        </div>;
      })}
    </div>}
    <div style={{...GC,overflowX:"auto",padding:0}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:400}}>
        <thead><tr style={{background:"#f8f9fb"}}>
          <th style={TH}>日</th><th style={TH}>曜</th>
          <th style={TH}>出勤希望者</th><th style={TH}>確定コンシェルジュ</th><th style={TH}>状況</th>
        </tr></thead>
        <tbody>{dayInfo.map(({d,applicants,assigned})=>{
          const wdi=getWdayI(year,month,d);
          const st=applicants.length===0?"empty":applicants.length>need?"over":applicants.length<need?"under":"ok";
          return <tr key={d} style={{background:wdi===0?"#fff5f5":wdi===6?"#f0f4ff":"#fff"}}>
            <td style={{...TD,textAlign:"center",fontWeight:700}}>{d}</td>
            <td style={{...TD,textAlign:"center",fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,d)}</td>
            <td style={TD}><div style={{display:"flex",flexWrap:"wrap",gap:3}}>
              {applicants.map(s=><span key={s} style={{background:assigned.includes(s)?C.greenL:C.blueL,
                color:assigned.includes(s)?C.green:C.blue,borderRadius:4,padding:"1px 6px",fontSize:12,fontWeight:600}}>{s}</span>)}
              {!applicants.length&&<span style={{color:C.muted,fontSize:12}}>なし</span>}
            </div></td>
            <td style={TD}><div style={{display:"flex",flexWrap:"wrap",gap:3}}>
              {assigned.map(s=><span key={s} style={{background:C.greenL,color:C.green,borderRadius:4,padding:"1px 6px",fontSize:12,fontWeight:600}}>{s}</span>)}
              {!assigned.length&&<span style={{color:C.muted,fontSize:12}}>未確定</span>}
            </div></td>
            <td style={{...TD,textAlign:"center"}}>
              {{over:<span style={{color:C.red,fontSize:11,fontWeight:700}}>⚠️ 絞る</span>,
                under:<span style={{color:C.amber,fontSize:11,fontWeight:700}}>⚡ 不足</span>,
                empty:<span style={{color:C.muted,fontSize:11}}>―</span>,
                ok:<span style={{color:C.green,fontSize:11,fontWeight:700}}>✅</span>}[st]}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function AdminShiftView({year,month,shifts,prefs,cfg,sv,generate}){
  const days=getDays(year,month);
  const {staff,venues}=cfg;
  // ローカル編集バッファ（保存ボタン押すまで確定しない）
  const [local,setLocal]=useState(shifts);
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{setLocal(shifts);setDirty(false);},[shifts]);

  // 会場別カウント
  const vCnt={};
  staff.forEach(s=>{vCnt[s]={};venues.forEach(v=>{vCnt[s][v.name]=0;});});
  Object.values(local).forEach(dd=>Object.entries(dd).forEach(([vn,sn])=>{
    if(vCnt[sn]?.[vn]!==undefined)vCnt[sn][vn]++;
  }));
  const totalCnt={};
  staff.forEach(s=>totalCnt[s]=venues.reduce((a,v)=>a+(vCnt[s]?.[v.name]||0),0));

  const setCell=(d,vn,v)=>{
    setLocal(prev=>({...prev,[d]:{...(prev[d]||{}),[vn]:v}}));
    setDirty(true);
  };
  const saveNow=()=>{ sv.shifts(local); setDirty(false); };
  const onGenerate=()=>{ generate(); setDirty(false); };
  return <div>
    <div style={{...GC,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <button style={Btn(C.blue)} onClick={onGenerate}>🔄 自動割り振り</button>
      <button style={{...Btn(dirty?C.green:"#94a3b8"),fontSize:13,padding:"9px 18px"}}
        onClick={saveNow} disabled={!dirty}>
        {dirty?"💾 保存する":"✅ 保存済み"}
      </button>
      {dirty&&<span style={{fontSize:12,color:C.amber,fontWeight:600}}>⚠️ 未保存の変更があります</span>}
    </div>
    {/* 会場別カウント表 */}
    <div style={{...GC,overflowX:"auto",padding:0}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr style={{background:"#f8f9fb"}}>
          <th style={TH}>コンシェルジュ</th>
          {venues.map(v=><th key={v.name} style={TH}>{v.name}</th>)}
          <th style={TH}>合計</th>
        </tr></thead>
        <tbody>{staff.map(s=><tr key={s}>
          <td style={{...TD,fontWeight:700}}>{s}</td>
          {venues.map(v=><td key={v.name} style={{...TD,textAlign:"center",
            color:(vCnt[s]?.[v.name]||0)>0?C.blue:C.muted}}>
            {vCnt[s]?.[v.name]||0}日</td>)}
          <td style={{...TD,textAlign:"center",fontWeight:700,color:C.navy}}>{totalCnt[s]||0}日</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{...GC,overflowX:"auto",padding:"4px 0"}}>
      {Object.keys(local).length===0&&<p style={{padding:20,textAlign:"center",color:C.muted}}>
        まだシフトがありません。「自動割り振り」を押してください。</p>}
      {Object.keys(local).length>0&&<table style={{width:"100%",borderCollapse:"collapse",minWidth:380}}>
        <thead><tr>
          <th style={{...TH,width:32}}>日</th><th style={{...TH,width:26}}>曜</th>
          {venues.map(v=><th key={v.name} style={TH}>{v.name}</th>)}
        </tr></thead>
        <tbody>{Array.from({length:days},(_,i)=>i+1).map(d=>{
          const wdi=getWdayI(year,month,d);
          const bg=wdi===0?"#fff5f5":wdi===6?"#f0f4ff":"#fff";
          const opted=new Set(staff.filter(s=>(prefs[s]||[]).includes(d)));
          return <tr key={d} style={{background:bg}}>
            <td style={{...TD,textAlign:"center",fontWeight:700}}>{d}</td>
            <td style={{...TD,textAlign:"center",fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,d)}</td>
            {venues.map(v=>{
              const val=local[d]?.[v.name]||"";
              const notOpted=val&&!opted.has(val);
              return <td key={v.name} style={TD}>
                <select value={val} onChange={e=>setCell(d,v.name,e.target.value)}
                  style={{width:"100%",border:`1px solid ${notOpted?C.amber:!val?"#fca5a5":C.border}`,
                    borderRadius:6,padding:"4px 6px",fontSize:13,background:"#fff"}}>
                  <option value="">-- 未定 --</option>
                  {staff.map(s=><option key={s} value={s} style={{color:opted.has(s)?"inherit":"#aaa"}}>
                    {s}{opted.has(s)?"":" ※希望外"}</option>)}
                </select>
                {notOpted&&<div style={{fontSize:10,color:C.amber}}>⚡ 希望外</div>}
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>}
    </div>
  </div>;
}

function AdminAttView({year,month,att:attProp,shifts,vconf,cfg,sv}){
  const {venues}=cfg,days=getDays(year,month);
  const [localAtt,setLocalAtt]=useState(attProp);
  useEffect(()=>{setLocalAtt(attProp);},[attProp]);
  const att=localAtt;
  const [ed,setEd]=useState(null);
  const [venueFilter,setVenueFilter]=useState("all");
  const actualVenue=(d,vName)=>{
    const isFlexVenue = cfg.venues.find(v=>v.name===vName)?.options?.length>0;
    if(isFlexVenue && vconf&&vconf[d]){
      if(typeof vconf[d]==="string") return vconf[d];
      if(vconf[d][vName]) return vconf[d][vName];
    }
    return vName;
  };
  const allRows=[];
  for(let d=1;d<=days;d++) for(const v of venues){
    const key=`${d}-${v.name}`,rec=att[key],sched=shifts[d]?.[v.name]||"";
    if(rec||sched)allRows.push({d,venue:actualVenue(d,v.name),venueKey:v.name,sched,rec,key});
  }
  const rows=venueFilter==="all"?allRows:allRows.filter(r=>r.venueKey===venueFilter);
  const verify=key=>sv.att({...att,[key]:{...att[key],verified:true,rejected:false}});
  const saveEdit=()=>{
    if(!ed)return;
    const existing=att[ed.key]||{staff:ed.newStaff||"",submittedAt:new Date().toISOString()};
    const newAtt={...att,[ed.key]:{...existing,start:ed.s,end:ed.e,breakMin:ed.b,venue:ed.venue||existing.venue,verified:false,rejected:false}};
    setLocalAtt(newAtt);
    sv.att(newAtt);
    setEd(null);
  };
  return <div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      <button onClick={()=>setVenueFilter("all")}
        style={{...Btn(venueFilter==="all"?C.navy:"#fff"),color:venueFilter==="all"?"#fff":C.muted,
          border:`1px solid ${venueFilter==="all"?C.navy:C.border}`,fontSize:13,padding:"7px 16px"}}>
        全会場
      </button>
      {venues.map(v=>(
        <button key={v.name} onClick={()=>setVenueFilter(v.name)}
          style={{...Btn(venueFilter===v.name?C.navy:"#fff"),color:venueFilter===v.name?"#fff":C.muted,
            border:`1px solid ${venueFilter===v.name?C.navy:C.border}`,fontSize:13,padding:"7px 16px"}}>
          {v.name}
        </button>
      ))}
    </div>
    <div style={{...GC,display:"flex",gap:20}}>
      {[["入力済",rows.filter(r=>r.rec).length,C.blue],["承認済",rows.filter(r=>r.rec?.verified).length,C.green],
        ["未入力",rows.filter(r=>!r.rec&&r.sched).length,C.amber]].map(([l,v,c])=>(
        <div key={l} style={{textAlign:"center"}}><div style={{fontSize:24,fontWeight:800,color:c}}>{v}</div>
          <div style={{fontSize:11,color:C.muted}}>{l}</div></div>))}
    </div>
    <div style={{...GC,overflowX:"auto",padding:0}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
        <thead><tr style={{background:"#f8f9fb"}}>
          <th style={TH}>日付</th><th style={TH}>曜</th><th style={TH}>会場</th>
          <th style={TH}>予定</th><th style={TH}>実際</th><th style={TH}>時間</th><th style={TH}>状態</th>
        </tr></thead>
        <tbody>{rows.map(({d,venue,sched,rec,key})=>{
          const wdi=getWdayI(year,month,d),h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):null;
          const isEd=ed?.key===key;
          return <React.Fragment key={key}>
            <tr style={{background:rec?.verified?"#f0fdf4":"#fff",cursor:rec?"pointer":"default"}}
              onClick={()=>rec&&!isEd&&setEd({key,s:rec.start,e:rec.end,b:rec.breakMin??60,venue:venue})}>
              <td style={{...TD,textAlign:"center",fontWeight:700}}>{month}/{d}</td>
              <td style={{...TD,textAlign:"center",fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,d)}</td>
              <td style={TD}>{venue}</td><td style={TD}>{sched||"-"}</td>
              <td style={{...TD,fontWeight:600}}>{rec?.staff||<span style={{color:C.muted,fontWeight:400}}>未入力</span>}</td>
              <td style={{...TD,color:C.muted}}>{rec?`${rec.start}〜${rec.end} 休憩${rec.breakMin??60}分（実働${h}h)`:"−"}</td>
              <td style={{...TD,textAlign:"center"}}>
                {!rec&&<button onClick={e=>{e.stopPropagation();setEd({key,s:"09:00",e:"16:00",b:60,newStaff:sched,venue:venue});}} style={{...Btn(C.amber),fontSize:11,padding:"4px 8px"}}>入力</button>}
                {rec&&!rec.verified&&<div style={{display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap"}}>
                  <button onClick={e=>{e.stopPropagation();setEd({key,s:rec.start,e:rec.end,b:rec.breakMin??60,venue:venue});}} style={{...Btn(C.blue),fontSize:11,padding:"4px 8px"}}>修正</button>
                  <button onClick={e=>{e.stopPropagation();verify(key);}} style={{...Btn(C.purple),fontSize:11,padding:"4px 8px"}}>承認</button>
                </div>}
                {rec?.verified&&<div style={{display:"flex",gap:4,justifyContent:"center",flexWrap:"wrap"}}>
                  <button onClick={e=>{e.stopPropagation();setEd({key,s:rec.start,e:rec.end,b:rec.breakMin??60,venue:venue});}} style={{...Btn(C.muted),fontSize:11,padding:"4px 8px"}}>修正</button>
                  <span style={{color:C.green,fontSize:12,fontWeight:700}}>✅</span>
                </div>}
              </td>
            </tr>
            {isEd&&<tr><td colSpan={7} style={{padding:"12px 16px",background:"#f0f7ff",borderBottom:`2px solid ${C.blue}`}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:700,color:C.blue}}>✏️ 編集中</span>
                <label style={{fontSize:12}}>会場</label>
<select value={ed.venue||venue} onChange={e=>{const v=e.target.value;setEd(prev=>({...prev,venue:v}));}}
  style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",fontSize:13}}>
  {cfg.venues.flatMap(v=>v.options&&v.options.length>0?v.options.map(o=>({name:o})):[v]).map(v=>(
    <option key={v.name} value={v.name}>{v.name}</option>
  ))}
</select>
<label style={{fontSize:12}}>開始</label>
                <input type="time" value={ed.s} onChange={e=>setEd({...ed,s:e.target.value})}
                  style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",fontSize:13}}/>
                <label style={{fontSize:12}}>終了</label>
                <input type="time" value={ed.e} onChange={e=>setEd({...ed,e:e.target.value})}
                  style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",fontSize:13}}/>
                <label style={{fontSize:12}}>休憩</label>
                <select value={ed.b} onChange={e=>setEd({...ed,b:Number(e.target.value)})}
                  style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",fontSize:13}}>
                  {[0,15,30,45,60].map(m=><option key={m} value={m}>{m}分</option>)}
                </select>
                <span style={{fontSize:12,color:C.green,fontWeight:700}}>実働{parseHours(ed.s,ed.e,ed.b)}h</span>
                <button onClick={saveEdit} style={{...Btn(C.green),fontSize:12,padding:"5px 12px"}}>保存</button>
                <button onClick={()=>setEd(null)} style={{...Btn(C.muted),fontSize:12,padding:"5px 12px"}}>キャンセル</button>
              </div>
            </td></tr>}
          </React.Fragment>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function AdminConfig({cfg,sv}){
  const formatClients = clients => normClients(clients).map(c=>[c.name,...c.locations.map(l=>`- ${l}`)].join("\n")).join("\n\n");
  const parseClients = txt => {
    const clients=[];
    txt.split("\n").map(s=>s.trim()).filter(Boolean).forEach(line=>{
      if(line.startsWith("-")||line.startsWith("・")){
        if(!clients.length) return;
        const location=line.replace(/^[-・]\s*/,"").trim();
        if(location) clients[clients.length-1].locations.push(location);
      }else{
        clients.push({name:line,locations:[]});
      }
    });
    return clients.map(c=>({...c,locations:c.locations.length?c.locations:[c.name]}));
  };
  const [staffTxt,setStaffTxt]=useState(cfg.staff.join("\n"));
  const [mcStaffTxt,setMcStaffTxt]=useState((cfg.mcStaff||DEFAULT_MC_STAFF).join("\n"));
  const [assistStaffTxt,setAssistStaffTxt]=useState((cfg.assistStaff||DEFAULT_ASSIST_STAFF).join("\n"));
  const [pantryStaffTxt,setPantryStaffTxt]=useState((cfg.pantryStaff||DEFAULT_PANTRY_STAFF).join("\n"));
  const [clientsTxt,setClientsTxt]=useState(formatClients(cfg.clients||DEFAULT_CLIENTS));
  const [newPass,setNewPass]=useState(cfg.officePass||DEFAULT_OFFICE_PASS);
  const [newAdminPass,setNewAdminPass]=useState(cfg.adminPass||DEFAULT_OFFICE_PASS);
  const [newStaffPass,setNewStaffPass]=useState(cfg.staffPass||DEFAULT_STAFF_PASS);
  const [newMcPass,setNewMcPass]=useState(cfg.mcPass||DEFAULT_MC_PASS);
  const [newAssistPass,setNewAssistPass]=useState(cfg.assistPass||DEFAULT_ASSIST_PASS);
  const [newPantryPass,setNewPantryPass]=useState(cfg.pantryPass||DEFAULT_PANTRY_PASS);
  const [payRates,setPayRates]=useState({...DEFAULT_PAY_RATES,...(cfg.payRates||{})});
  const [staffRates,setStaffRates]=useState(()=>{
    const r={};
    (cfg.staff||DEFAULT_STAFF).forEach(n=>{r[n]=cfg.staffRates?.[n]||payRates.conciergeHourly||RATE_STAFF;});
    return r;
  });
  const [saved,setSaved]=useState(false);
  const [errMsg,setErrMsg]=useState("");
  const toList = txt => txt.split("\n").map(s=>s.trim()).filter(Boolean);
  const save=async()=>{
    setErrMsg("");
    const clients=parseClients(clientsTxt);
    const newSettings={
      ...cfg,
      staff:toList(staffTxt),
      mcStaff:toList(mcStaffTxt),
      assistStaff:toList(assistStaffTxt),
      pantryStaff:toList(pantryStaffTxt),
      clients,
      venues:clientsToVenues(clients),
      staffRates,
      payRates,
      officePass:newPass.trim()||DEFAULT_OFFICE_PASS,
      adminPass:newAdminPass.trim()||DEFAULT_OFFICE_PASS,
      staffPass:newStaffPass.trim()||DEFAULT_STAFF_PASS,
      mcPass:newMcPass.trim()||DEFAULT_MC_PASS,
      assistPass:newAssistPass.trim()||DEFAULT_ASSIST_PASS,
      pantryPass:newPantryPass.trim()||DEFAULT_PANTRY_PASS,
    };
    try{
      await stSave("settings", newSettings);
      sv.updateSettings(newSettings);
      setSaved(true);
      setTimeout(()=>setSaved(false),2500);
    }catch(e){
      setErrMsg("❌ 保存エラー: "+String(e.message||e));
    }
  };
  return <div style={{...GC,maxWidth:440}}>
    <h3 style={{margin:"0 0 16px",fontSize:15}}>⚙️ システム設定</h3>

    {/* メンバー一覧 */}
    {[
      {label:"👤 コンシェルジュ一覧（1行1名）", val:staffTxt,   set:setStaffTxt,   rows:10},
      {label:"🎤 司会メンバー一覧（1行1名）",   val:mcStaffTxt, set:setMcStaffTxt, rows:6},
      {label:"🤝 アシスタントメンバー一覧（1行1名）", val:assistStaffTxt, set:setAssistStaffTxt, rows:6},
      {label:"☕ パントリーメンバー一覧（1行1名）", val:pantryStaffTxt, set:setPantryStaffTxt, rows:6},
    ].map(({label,val,set,rows})=>(
      <div key={label} style={{marginBottom:16}}>
        <label style={{display:"block",fontWeight:700,fontSize:13,marginBottom:6}}>{label}</label>
        <textarea value={val} onChange={e=>set(e.target.value)} rows={rows}
          style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",
            fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
      </div>
    ))}
    <div style={{...GC,background:"#f8f9fb",marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,color:C.navy,marginBottom:10}}>📍 クライアント / ロケーション設定</div>
      <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>クライアント名の下に「- ロケーション名」で入力</label>
      <textarea value={clientsTxt} onChange={e=>setClientsTxt(e.target.value)} rows={12}
        style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:6,padding:"7px 10px",
          fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
    </div>
    {/* パスワード設定 */}
    <div style={{...GC,background:"#fffaf5",border:`1px solid #e8784a`,marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,color:"#e8784a",marginBottom:14}}>🔒 ログインパスワード設定</div>
      {[
        {label:"⚙️ 管理者",    val:newAdminPass, set:setNewAdminPass},
        {label:"👤 コンシェルジュ", val:newStaffPass, set:setNewStaffPass},
        {label:"🎤 司会",      val:newMcPass,    set:setNewMcPass},
        {label:"🤝 アシスタント", val:newAssistPass,set:setNewAssistPass},
        {label:"☕ パントリー", val:newPantryPass,set:setNewPantryPass},
        {label:"📊 事務",      val:newPass,      set:setNewPass},
      ].map(({label,val,set})=>(
        <div key={label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:600,minWidth:110}}>{label}</span>
          <input value={val} onChange={e=>set(e.target.value)} type="text"
            style={{flex:1,border:`1px solid ${C.border}`,borderRadius:6,padding:"7px 10px",
              fontSize:14,letterSpacing:2,fontWeight:700}}/>
        </div>
      ))}
      <p style={{fontSize:11,color:C.muted,margin:"4px 0 0"}}>初期値はすべて「1234」です。「保存する」で反映されます。</p>
    </div>
    {/* 役割別給与設定 */}
    <div style={{...GC,background:"#eef6ff",border:`1px solid ${C.blue}`,marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,color:C.blue,marginBottom:12}}>💴 役割別給与設定</div>
      {[
        ["Concierge（時給）","conciergeHourly","円/h"],
        ["MC（日給）","mcDaily","円/日"],
        ["Assistant（日給）","assistantDaily","円/日"],
        ["Pantry（日給）","pantryDaily","円/日"],
      ].map(([label,key,unit])=>(
        <div key={key} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:600,minWidth:130,flex:1}}>{label}</span>
          <input type="number" value={payRates[key]||0}
            onChange={e=>setPayRates({...payRates,[key]:Number(e.target.value)||0})}
            style={{width:100,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 10px",fontSize:14,textAlign:"right"}}/>
          <span style={{fontSize:12,color:C.muted}}>{unit}</span>
        </div>
      ))}
    </div>
    {/* 個人別時給 */}
    <div style={{...GC,background:"#f0fdf4",border:`1px solid ${C.green}`,marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,color:C.green,marginBottom:12}}>💴 コンシェルジュ個人別時給（未設定時は役割別時給）</div>
      {toList(staffTxt).map(name=>(
        <div key={name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:600,minWidth:120,flex:1}}>{name}</span>
          <input type="number" value={staffRates[name]||payRates.conciergeHourly||RATE_STAFF}
            onChange={e=>setStaffRates({...staffRates,[name]:Number(e.target.value)||payRates.conciergeHourly||RATE_STAFF})}
            style={{width:90,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 10px",fontSize:14,textAlign:"right"}}/>
          <span style={{fontSize:12,color:C.muted}}>円/h</span>
        </div>
      ))}
    </div>
    <button style={{...Btn(saved?C.green:C.navy),width:"100%",padding:"12px"}} onClick={save}>
      {saved?"✅ 保存しました！Firebase書き込み成功":"保存する"}
    </button>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNTING VIEW（事務・管理者共通）
// ═══════════════════════════════════════════════════════════════
