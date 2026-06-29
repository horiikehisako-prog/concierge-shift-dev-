function RoleSelect({cfg,onSelect}){
  const [mode,setMode]=useState(null);
  const [pw,setPw]=useState("");
  const [pwErr,setPwErr]=useState(false);
  const officePass =cfg.officePass ||DEFAULT_OFFICE_PASS;
  const adminPass  =cfg.adminPass  ||DEFAULT_OFFICE_PASS;
  const staffPass  =cfg.staffPass  ||DEFAULT_STAFF_PASS;
  const mcPass     =cfg.mcPass     ||DEFAULT_MC_PASS;
  const assistPass =cfg.assistPass ||DEFAULT_ASSIST_PASS;
  const pantryPass =cfg.pantryPass ||DEFAULT_PANTRY_PASS;

  const passMap = {admin:adminPass, office:officePass, staff:staffPass, mc:mcPass, assist:assistPass, pantry:pantryPass};
  const nameMap = {admin:"Administrator", office:"Office"};

  const tryLogin=(role)=>{
    const correct=passMap[role];
    if(pw===correct){
      // 管理者・事務はそのままログイン、他は名前選択へ
      if(role==="admin"||role==="office"){ onSelect(role, nameMap[role]||""); }
      else{ setMode(role+"-name"); setPw(""); }
    }
    else{ setPwErr(true); setPw(""); setTimeout(()=>setPwErr(false),2000); }
  };

  const bgWarm="linear-gradient(160deg,#fde8d4 0%,#fbd4b4 50%,#f9c4a0 100%)";

  // ホーム画面
  if(!mode) return (
    <div style={{minHeight:"100vh",background:bgWarm,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <img src={LOGO_SRC} alt="logo" style={{width:130,display:"block",margin:"0 auto 12px",filter:"drop-shadow(0 2px 8px rgba(180,80,20,.25))"}}/>
        <h1 style={{color:"#7c2d0a",margin:"0 0 6px",fontSize:22,fontWeight:800,textAlign:"center"}}>コンシェルシフト</h1>
        <p style={{color:"#c2784a",fontSize:13,margin:0,textAlign:"center"}}>シフト管理システム</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%",maxWidth:300}}>
        {[
          {r:"admin", i:"👑", l:"Administrator",s:"設定・シフト調整",    bg:"#e8784a"},
          {r:"office",i:"📋", l:"Office",       s:"月次計算・CSV出力",   bg:"#c4855a"},
          {r:"staff", i:"😊", l:"Concierge",    s:"出勤希望・記録入力",  bg:"#e8a050"},
          {r:"venue", i:"🏛️", l:"Director",     s:"会場確定・出勤承認",  bg:"#d4766a"},
          {r:"mc",    i:"🎤", l:"MC",           s:"出勤記録・履歴確認",  bg:"#a0785a"},
          {r:"assist",i:"🤝", l:"Assistant",    s:"出勤記録・履歴確認",  bg:"#b08060"},
          {r:"pantry",i:"☕", l:"Pantry",       s:"出勤記録・履歴確認",  bg:"#8f7a5a"},
        ].map(({r,i,l,s,bg})=>(
          <button key={r} onClick={()=>setMode(r)}
            style={{background:bg,border:"none",color:"#fff",borderRadius:14,padding:"16px 20px",
              cursor:"pointer",display:"flex",alignItems:"center",gap:14,textAlign:"left",
              boxShadow:`0 4px 20px ${bg}88`}}>
            <span style={{fontSize:26}}>{i}</span>
            <div><div style={{fontWeight:800,fontSize:15}}>{l}</div><div style={{fontSize:12,opacity:.9}}>{s}</div></div>
          </button>
        ))}
      </div>
    </div>
  );

  // パスワード画面（管理者・事務・コンシェルジュ・司会・アシスタント）
  const needsPw = ["admin","office","staff","mc","assist","pantry"];
  const pwTitleMap = {
    admin:"👑 Administrator ログイン", office:"📋 Office ログイン",
    staff:"😊 Concierge", mc:"🎤 MC", assist:"🤝 Assistant", pantry:"☕ Pantry"
  };
  if(needsPw.includes(mode)) return (
    <div style={{minHeight:"100vh",background:bgWarm,
      display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:16,padding:32,width:"100%",maxWidth:300,
        boxShadow:"0 8px 40px rgba(180,80,20,.2)",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:8}}>🔒</div>
        <h3 style={{margin:"0 0 6px",color:"#7c2d0a"}}>{pwTitleMap[mode]}</h3>
        <p style={{fontSize:13,color:C.muted,margin:"0 0 20px"}}>パスワードを入力してください</p>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&tryLogin(mode)}
          placeholder="パスワード"
          style={{width:"100%",border:`2px solid ${pwErr?C.red:C.border}`,borderRadius:10,
            padding:"12px 14px",fontSize:16,textAlign:"center",boxSizing:"border-box",
            outline:"none",marginBottom:8,letterSpacing:4}}/>
        {pwErr&&<p style={{color:C.red,fontSize:13,margin:"0 0 8px",fontWeight:600}}>パスワードが違います</p>}
        <button onClick={()=>tryLogin(mode)}
          style={{...Btn("#e8784a"),width:"100%",padding:"12px",fontSize:15,marginBottom:12}}>
          ログイン
        </button>
        <button onClick={()=>{setMode(null);setPw("");}}
          style={{color:C.muted,background:"none",border:"none",cursor:"pointer",fontSize:13}}>← 戻る</button>
      </div>
    </div>
  );

  // 名前選択画面（コンシェルジュ・ディレクター・司会・アシスタント）
  const titleMap={
    "staff-name":"😊 Concierge を選択","venue":"🏛️ Director を選択",
    "mc-name":"🎤 MC を選択","assist-name":"🤝 Assistant を選択","pantry-name":"☕ Pantry を選択"
  };
  const baseRole = mode.replace("-name","");
  const nameList=mode==="venue"?cfg.venues.map(v=>v.name):
                 baseRole==="mc"?cfg.mcStaff:
                 baseRole==="assist"?cfg.assistStaff:
                 baseRole==="pantry"?cfg.pantryStaff:
                 cfg.staff;
  return (
    <div style={{minHeight:"100vh",background:bgWarm,
      display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:320,
        boxShadow:"0 8px 40px rgba(180,80,20,.2)"}}>
        <h3 style={{margin:"0 0 16px",color:"#7c2d0a"}}>{titleMap[mode]||"選択"}</h3>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {nameList.map(n=>(
            <button key={n} onClick={()=>onSelect(baseRole,n)}
              style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,
                padding:"12px 16px",cursor:"pointer",textAlign:"left",fontSize:14,fontWeight:600}}>
              {n}
            </button>
          ))}
          {mode==="venue"&&(
            <button onClick={()=>onSelect("venue","全会場")}
              style={{background:C.navy,color:"#fff",border:"none",borderRadius:8,
                padding:"12px 16px",cursor:"pointer",fontSize:14,fontWeight:600,textAlign:"left"}}>
              🏢 全会場まとめて確認
            </button>
          )}
        </div>
        <button onClick={()=>setMode(null)}
          style={{marginTop:16,color:C.muted,background:"none",border:"none",cursor:"pointer",fontSize:13}}>← 戻る</button>
      </div>
    </div>
  );
}


function TopBar({role,uname,onBack,year,month}){
  const lbl={admin:"👑 Administrator",staff:`😊 ${uname}`,venue:`🏛️ ${uname}`,office:"📋 Office",mc:`🎤 ${uname}`,assist:`🤝 ${uname}`,pantry:`☕ ${uname}`};
  return (
    <div style={{background:"linear-gradient(90deg,#c2613a,#d4785a)",color:"#fff",padding:"12px 20px",display:"flex",alignItems:"center",
      gap:12,position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(180,80,20,.25)"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"rgba(255,255,255,.7)",cursor:"pointer",fontSize:22,padding:0}}>‹</button>
      <img src={LOGO_SRC} alt="logo" style={{height:28,filter:"brightness(0) invert(1)"}}/>
      <span style={{fontSize:15,fontWeight:800}}>コンシェルシフト</span>
      <span style={{marginLeft:"auto",fontSize:13,color:"rgba(255,255,255,.75)",fontWeight:600}}>
        {year}年{month}月 · {lbl[role]}
      </span>
    </div>
  );
}

function MonthSel({year,month,setYear,setMonth}){
  const prev=()=>{if(month===1){setYear(y=>y-1);setMonth(12);}else setMonth(m=>m-1);};
  const next=()=>{if(month===12){setYear(y=>y+1);setMonth(1);}else setMonth(m=>m+1);};
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
      <button onClick={prev} style={{...Btn(C.white,C.text),border:`1px solid ${C.border}`,padding:"6px 14px"}}>‹</button>
      <span style={{fontWeight:800,fontSize:18}}>{year}年{month}月</span>
      <button onClick={next} style={{...Btn(C.white,C.text),border:`1px solid ${C.border}`,padding:"6px 14px"}}>›</button>
    </div>
  );
}

function Tabs({tabs,active,onChange}){
  return (
    <div style={{display:"flex",gap:2,marginBottom:16,background:"rgba(0,0,0,.05)",borderRadius:10,padding:4,flexWrap:"wrap"}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{flex:1,minWidth:60,border:"none",borderRadius:8,padding:"8px 4px",cursor:"pointer",
            fontSize:12,fontWeight:700,background:active===t.id?"#fff":"transparent",
            color:active===t.id?C.navy:C.muted,
            boxShadow:active===t.id?"0 1px 4px rgba(0,0,0,.1)":"none"}}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADMIN VIEW
// ═══════════════════════════════════════════════════════════════
