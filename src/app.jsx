function App(){
  const now=new Date();
  const [year,setYear]  =useState(now.getFullYear());
  const [month,setMonth]=useState(now.getMonth()+1);
  const [role,setRole]  =useState(null);
  const [uname,setUname]=useState("");
  const [D,setD]=useState({settings:null,shifts:{},prefs:{},att:{},vconf:{},mcStaff:null,assistStaff:null,pantryStaff:null});
  const [busy,setBusy]  =useState(false);
  const [toast,setToast]=useState("");

  const ym =ymS(year,month);
  const raw=D.settings||{staff:DEFAULT_STAFF,clients:DEFAULT_CLIENTS,venues:DEFAULT_VENUES};
  // パイプ区切り文字列から配列に変換、なければsettings内を参照
  const parsePipe = (str,fallback) => {
    if(str && typeof str==="string") return str.split("|").filter(Boolean);
    return fallback;
  };
  const mcStaffData   = parsePipe(D.mcStaff,   ensureArray(raw.mcStaff));
  const assistStaffData = parsePipe(D.assistStaff, ensureArray(raw.assistStaff));
  const pantryStaffData = parsePipe(D.pantryStaff, ensureArray(raw.pantryStaff));
  const clients=normClients(raw.clients&&ensureArray(raw.clients).length?raw.clients:DEFAULT_CLIENTS);
  const cfg={...raw,
    clients,
    venues:clientsToVenues(clients),
    staff:ensureArray(raw.staff).length>0?ensureArray(raw.staff):DEFAULT_STAFF,
    mcStaff:mcStaffData.length>0?mcStaffData:DEFAULT_MC_STAFF,
    assistStaff:assistStaffData.length>0?assistStaffData:DEFAULT_ASSIST_STAFF,
    pantryStaff:pantryStaffData.length>0?pantryStaffData:DEFAULT_PANTRY_STAFF,
    staffRates:raw.staffRates||{}, // コンシェルジュ個人別時給
    payRates:{...DEFAULT_PAY_RATES,...(raw.payRates||{})},
    ashibeRates:raw.ashibeRates||{}, // あしべの杜単価
  };

  const flash=msg=>{setToast(msg);setTimeout(()=>setToast(""),2500);};

  const reload=useCallback(async()=>{
    setBusy(true);
    const [s,sh,pr,at,vc,mcs,asts,pans]=await Promise.all([
      stLoad("settings"),stLoad(`shift-${ym}`),stLoad(`pref-${ym}`),
      stLoad(`att-${ym}`),stLoad(`vconf-${ym}`),
      stLoad("mcStaff_str"),stLoad("assistStaff_str"),stLoad("pantryStaff_str"),
    ]);
    setD({
      settings:s,shifts:sh||{},prefs:pr||{},att:at||{},vconf:vc||{},
      mcStaff:mcs||null,assistStaff:asts||null,pantryStaff:pans||null,
    });
    setBusy(false);
  },[ym]);

  useEffect(()=>{reload();},[reload]);

  const sv={
    shifts:v=>{setD(d=>({...d,shifts:v}));stSave(`shift-${ym}`,v);flash("✅ シフトを保存しました");},
    prefs: v=>{setD(d=>({...d,prefs:v})); stSave(`pref-${ym}`,v); flash("✅ 希望を保存しました");},
    att:   v=>{setD(d=>({...d,att:v}));   stSave(`att-${ym}`,v);  flash("✅ 出勤記録を保存しました");},
    vconf: v=>{setD(d=>({...d,vconf:v})); stSave(`vconf-${ym}`,v);},
    sets: async v=>{
      setD(d=>({...d,settings:v}));
      await stSave("settings",v);
      flash("✅ 設定を保存しました");
    },
    updateSettings: v=>{setD(d=>({...d,settings:v}));}, // メモリのみ更新
    mcStaff: v=>{
      setD(d=>({...d,mcStaff:v.join("|")}));
      stSave("mcStaff_str",v.join("|")); // エラーが出ても止めない
    },
    assistStaff: v=>{
      setD(d=>({...d,assistStaff:v.join("|")}));
      stSave("assistStaff_str",v.join("|")); // エラーが出ても止めない
    },
    pantryStaff: v=>{
      setD(d=>({...d,pantryStaff:v.join("|")}));
      stSave("pantryStaff_str",v.join("|"));
    },
  };

  // 自動割り振り：希望者から選ぶ・会場ごとに均等
  const generate=()=>{
    const {staff,venues}=cfg;
    const days=getDays(year,month);
    const ns={...D.shifts};
    // 月全体の勤務カウント
    const totalCnt={}, venueCnt={};
    staff.forEach(s=>{totalCnt[s]=0;venueCnt[s]={};venues.forEach(v=>{venueCnt[s][v.name]=0;});});
    Object.entries(ns).forEach(([d,dd])=>Object.entries(dd).forEach(([vn,sn])=>{
      if(totalCnt[sn]!==undefined){totalCnt[sn]++;if(venueCnt[sn]?.[vn]!==undefined)venueCnt[sn][vn]++;}
    }));
    for(let d=1;d<=days;d++){
      if(!ns[d])ns[d]={};
      const used=new Set();
      for(const v of venues){
        if(ns[d][v.name]){used.add(ns[d][v.name]);continue;}
        const avail=staff.filter(s=>(D.prefs[s]||[]).includes(d)&&!used.has(s));
        if(!avail.length){ns[d][v.name]="";continue;}
        // 優先：この会場の勤務が少ない人 → 全体勤務が少ない人
        avail.sort((a,b)=>{
          const vd=(venueCnt[a]?.[v.name]||0)-(venueCnt[b]?.[v.name]||0);
          return vd!==0?vd:(totalCnt[a]||0)-(totalCnt[b]||0);
        });
        ns[d][v.name]=avail[0];
        used.add(avail[0]);
        totalCnt[avail[0]]=(totalCnt[avail[0]]||0)+1;
        if(venueCnt[avail[0]]?.[v.name]!==undefined)venueCnt[avail[0]][v.name]++;
      }
    }
    sv.shifts(ns);
  };

  if(!role) return <RoleSelect cfg={cfg} onSelect={(r,n)=>{setRole(r);setUname(n);}}/>;

  const P={year,month,setYear,setMonth,shifts:D.shifts,prefs:D.prefs,att:D.att,vconf:D.vconf,
    cfg,sv,generate,uname,role,busy,flash};

  return (
    <div style={{minHeight:"100vh",background:C.bg,
      fontFamily:"'Hiragino Kaku Gothic ProN','Yu Gothic UI',sans-serif",color:C.text}}>
      {toast&&<div style={{position:"fixed",top:16,right:16,zIndex:9999,background:C.navy,
        color:"#fff",padding:"10px 20px",borderRadius:10,fontSize:13,fontWeight:600,
        boxShadow:"0 4px 20px rgba(0,0,0,.2)"}}>{toast}</div>}
      <TopBar role={role} uname={uname} onBack={()=>setRole(null)} year={year} month={month}/>
      <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px"}}>
        {busy&&<div style={{textAlign:"center",padding:60,color:C.muted}}>読み込み中…</div>}
        {!busy&&role==="admin"  &&<AdminView  {...P}/>}
        {!busy&&role==="staff"  &&<StaffView  {...P}/>}
        {!busy&&role==="venue"  &&<VenueView  {...P}/>}
        {!busy&&role==="office" &&<OfficeView {...P}/>}
        {!busy&&(role==="mc"||role==="assist"||role==="pantry")&&<MCStaffView {...P}/>}
      </div>
    </div>
  );
}

// ─── ROLE SELECT ──────────────────────────────────────────────
