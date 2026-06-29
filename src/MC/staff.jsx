function MCStaffView(P) {
  const { year, month, setYear, setMonth, role, uname, cfg, flash } = P;
  const [tab, setTab] = useState("record");
  const jobRole = role === "mc" ? "司会" : role === "pantry" ? "パントリー" : "アシスタント";
  const tabs = [
    { id:"record", label:"📝 出勤を記録" },
    { id:"history",label:"📋 履歴確認" },
  ];
  return (
    <div>
      <MonthSel year={year} month={month} setYear={setYear} setMonth={setMonth}/>
      <Tabs tabs={tabs} active={tab} onChange={setTab}/>
      {tab==="record"  && <MCStaffRecord  {...P} jobRole={jobRole}/>}
      {tab==="history" && <MCStaffHistory {...P} jobRole={jobRole}/>}
    </div>
  );
}

function MCStaffRecord({ year, month, uname, role, cfg, flash }) {
  const jobRole = role==="mc"?"司会":role==="pantry"?"パントリー":"アシスタント";
  const today = new Date();
  const [form, setForm] = useState({
    company:"", venue:"", type:"2日葬", assistRole:"アシスタント", training:false,
    date:`${year}-${p2(month)}-${p2(today.getDate())}`,
  });
  const [saving, setSaving] = useState(false);

  const storageKey = `mc-${year}-${p2(month)}-${uname}`;

  const rates = cfg.mcRates || {};
  const actualRole = jobRole==="アシスタント" ? form.assistRole : jobRole;
  const roleRateKey = actualRole==="司会"?"mcDaily":actualRole==="パントリー"?"pantryDaily":"assistantDaily";
  const trainingKey = form.training ? "研修" : null;
  const myRate = trainingKey
    ? (rates[uname]?.[form.company]?.["研修"] || 0)
    : (rates[uname]?.[form.company]?.[actualRole] || cfg.payRates?.[roleRateKey] || 0);

  const reset = () => { setForm({company:"",venue:"",type:"2日葬",assistRole:"アシスタント",training:false,date:`${year}-${p2(month)}-${p2(today.getDate())}`}); };

  const save = async () => {
    setSaving(true);
    const existing = await stLoad(storageKey) || [];
    const newRec = {
      id: Date.now(), staff: uname, role: actualRole,
      company: form.company, venue: form.venue,
      type: (actualRole==="パントリー"||actualRole==="アシスタント")?"－":form.type,
      date: form.date.replace(/-/g,"/"),
      training: form.training,
      createdAt: new Date().toISOString(),
    };
    await stSave(storageKey, [...existing, newRec]);
    setSaving(false);
    flash("✅ 記録しました！");
    reset();
  };

  const colors = { "飛鳥会館":"#e8784a", "あしべの杜":"#6b8fb0", "ふかしな葬祭":"#7c8a5a" };
  const canSave = form.venue && (jobRole==="司会" ? !!form.type : true);

  return (
    <div style={GC}>
      <h3 style={{margin:"0 0 16px",fontSize:15}}>🤝 {uname}さんの出勤を記録</h3>

      {/* 日付 */}
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>📅 勤務日</label>
        <input type="date" value={form.date}
          onChange={e=>setForm({...form,date:e.target.value})}
          style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",fontSize:15,width:"100%",boxSizing:"border-box"}}/>
      </div>

      {/* STEP 1: 会社選択 */}
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:8}}>🏢 STEP 1　会社</label>
        <div style={{display:"flex",gap:10}}>
          {Object.keys(MC_COMPANIES).map(company=>(
            <button key={company} onClick={()=>setForm({...form,company,venue:MC_COMPANIES[company][0]})}
              style={{flex:1,border:`2px solid ${form.company===company?colors[company]:C.border}`,
                borderRadius:12,padding:"14px 8px",cursor:"pointer",fontSize:13,fontWeight:800,
                background:form.company===company?colors[company]:"#fff",
                color:form.company===company?"#fff":C.muted}}>
              {company==="飛鳥会館"?"⛩️":company==="あしべの杜"?"🌿":"🏛️"}<br/>{company}
            </button>
          ))}
        </div>
      </div>

      {/* STEP 2: 会場選択 */}
      {form.company && (
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:8}}>📍 STEP 2　会場</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {MC_COMPANIES[form.company].map(venue=>(
              <button key={venue} onClick={()=>setForm({...form,venue})}
                style={{border:`2px solid ${form.venue===venue?colors[form.company]:C.border}`,
                  borderRadius:10,padding:"10px 14px",cursor:"pointer",fontSize:13,fontWeight:700,
                  background:form.venue===venue?colors[form.company]+"22":"#fff",
                  color:form.venue===venue?colors[form.company]:C.text}}>
                {venue}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 研修トグル（あしべの杜のみ） */}
      {form.venue && form.company==="あしべの杜" && (
        <div style={{marginBottom:16}}>
          <button onClick={()=>setForm({...form,training:!form.training})}
            style={{width:"100%",border:`2px solid ${form.training?"#f59e0b":C.border}`,
              borderRadius:12,padding:"12px 16px",cursor:"pointer",fontSize:14,fontWeight:700,
              background:form.training?"#fffbeb":"#fff",
              color:form.training?"#92400e":C.muted,
              display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span>🎓 研修中として記録する</span>
            <span style={{fontSize:18}}>{form.training?"✅":"⬜"}</span>
          </button>
          {form.training&&<div style={{fontSize:12,color:"#92400e",marginTop:6,padding:"0 4px"}}>
            研修単価が適用されます（管理者設定で変更可）
          </div>}
        </div>
      )}

      {/* STEP 3: アシスタント/パントリー選択 */}
      {form.venue && jobRole==="アシスタント" && (
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:8}}>🎭 STEP 3　役割</label>
          <div style={{display:"flex",gap:8}}>
            {["アシスタント","パントリー"].map(r=>(
              <button key={r} onClick={()=>setForm({...form,assistRole:r})}
                style={{flex:1,border:`2px solid ${form.assistRole===r?C.blue:C.border}`,
                  borderRadius:10,padding:"12px 8px",cursor:"pointer",fontSize:13,fontWeight:700,
                  background:form.assistRole===r?"#eff6ff":"#fff",
                  color:form.assistRole===r?C.blue:C.muted}}>
                {r==="アシスタント"?"🤝":"🍽️"} {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3: 種別選択（司会のみ） */}
      {form.venue && jobRole==="司会" && (
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:8}}>📋 STEP 3　種別</label>
          <div style={{display:"flex",gap:8}}>
            {MC_TYPES.map(t=>(
              <button key={t} onClick={()=>setForm({...form,type:t})}
                style={{flex:1,border:`2px solid ${form.type===t?C.purple:C.border}`,
                  borderRadius:10,padding:"10px 6px",cursor:"pointer",fontSize:12,fontWeight:700,
                  background:form.type===t?"#ede9fe":"#fff",
                  color:form.type===t?C.purple:C.muted}}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 確認・保存 */}
      {canSave && (
        <div style={{background:"#f8f0ff",borderRadius:12,padding:16,marginBottom:14}}>
          <div style={{fontSize:12,color:C.muted,marginBottom:8,fontWeight:600}}>📋 確認</div>
          {[
            ["日付",form.date.replace(/-/g,"/")],
            ["会社",form.company],
            ["会場",form.venue],
            ["役割",actualRole],
            ...(jobRole==="司会"?[["種別",form.type]]:[]),
            ...(form.training?[["研修","🎓 研修単価適用"]]:
               myRate>0?[["支払い単価",yen(myRate)]]:[[" ","（単価は管理者が設定します）"]]),
          ].map(([k,v])=>(
            <div key={k} style={{display:"flex",gap:8,marginBottom:4}}>
              <span style={{fontSize:12,color:C.muted,minWidth:64}}>{k}</span>
              <span style={{fontSize:13,fontWeight:600}}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {canSave && (
        <button onClick={save} disabled={saving}
          style={{...Btn(saving?C.muted:C.green),width:"100%",padding:"14px",fontSize:15,fontWeight:800}}>
          {saving?"保存中…":"✅ この内容で記録する"}
        </button>
      )}
    </div>
  );
}

function MCStaffHistory({ year, month, uname, role, cfg }) {
  const jobRole = role==="mc"?"司会":role==="pantry"?"パントリー":"アシスタント";
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const rates = cfg.mcRates || {};

  useEffect(()=>{
    stLoad(`mc-${year}-${p2(month)}-${uname}`).then(d=>{
      const all = d||[];
      // アシスタントログインの場合はアシスタント・パントリー両方表示
      const filtered = jobRole==="アシスタント"
        ? all.filter(r=>r.role==="アシスタント"||r.role==="パントリー")
        : all.filter(r=>r.role===jobRole);
      setRecords(filtered);
      setLoading(false);
    });
  },[year,month,uname,jobRole]);

  const rateFor = r => {
    const key = r.role==="司会"?"mcDaily":r.role==="パントリー"?"pantryDaily":"assistantDaily";
    return rates[uname]?.[r.company]?.[r.role] || cfg.payRates?.[key] || 0;
  };
  const totalPay = records.reduce((a,r)=>a+rateFor(r),0);

  if(loading) return <div style={{padding:40,textAlign:"center",color:C.muted}}>読み込み中…</div>;

  return (
    <div style={GC}>
      <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <h3 style={{margin:0,fontSize:15}}>{year}年{month}月の記録</h3>
        <span style={{color:C.blue,fontWeight:700,fontSize:13}}>{records.length}件</span>
        {totalPay>0&&<span style={{color:C.green,fontWeight:700,fontSize:13}}>合計 {yen(totalPay)}</span>}
      </div>
      {records.length===0&&<p style={{color:C.muted,fontSize:13}}>この月の記録はありません</p>}
      {records.sort((a,b)=>a.date>b.date?1:-1).map(r=>{
        const pay = rateFor(r);
        return (
          <div key={r.id} style={{borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{r.date}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:3}}>
                  {r.company}　{r.venue}
                  {r.role==="司会"&&<span style={{marginLeft:6,color:C.purple,fontWeight:600}}>（{r.type}）</span>}
                </div>
              </div>
              {pay>0&&<span style={{color:C.green,fontWeight:700,fontSize:13}}>{yen(pay)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


