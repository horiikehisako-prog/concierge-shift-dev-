function MCRecordTab({ year, month, cfg, uname, flash }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    company:"飛鳥会館", venue:"春日", role:"司会", type:"2日葬",
    date:`${year}/${p2(month)}/${p2(new Date().getDate())}`,
  });
  const [saving, setSaving] = useState(false);

  const storageKey = `mc-${year}-${p2(month)}-${uname}`;

  useEffect(() => {
    stLoad(storageKey).then(d => {
      setRecords(d||[]);
      setLoading(false);
    });
  }, [storageKey]);

  const save = async () => {
    setSaving(true);
    const newRec = { ...form, id: Date.now(), staff: uname, createdAt: new Date().toISOString() };
    const updated = [...records, newRec];
    await stSave(storageKey, updated);
    setRecords(updated);
    setSaving(false);
    flash("✅ 記録しました");
  };

  const del = async (id) => {
    const updated = records.filter(r => r.id !== id);
    await stSave(storageKey, updated);
    setRecords(updated);
    flash("削除しました");
  };

  const venues = MC_COMPANIES[form.company] || [];

  const roleRateKey = form.role==="司会"?"mcDaily":form.role==="パントリー"?"pantryDaily":"assistantDaily";
  const staffRate = (cfg.mcRates||{})[uname]?.[form.company]?.[form.role] || cfg.payRates?.[roleRateKey] || 0;

  return (
    <div>
      <div style={GC}>
        <h3 style={{margin:"0 0 14px",fontSize:15}}>📝 出勤を記録する</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* 日付 */}
          <div>
            <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>日付</label>
            <input type="date" value={form.date.replace(/\//g,"-")}
              onChange={e=>setForm({...form,date:e.target.value.replace(/-/g,"/")})}
              style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:14,width:"100%",boxSizing:"border-box"}}/>
          </div>
          {/* 会社 */}
          <div>
            <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>会社</label>
            <div style={{display:"flex",gap:8}}>
              {Object.keys(MC_COMPANIES).map(c=>(
                <button key={c} onClick={()=>setForm({...form,company:c,venue:MC_COMPANIES[c][0]})}
                  style={{flex:1,border:`2px solid ${form.company===c?"#e8784a":C.border}`,
                    borderRadius:8,padding:"8px 4px",cursor:"pointer",fontSize:12,fontWeight:700,
                    background:form.company===c?"#fff8f0":"#fff",
                    color:form.company===c?"#e8784a":C.muted}}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          {/* 会場 */}
          <div>
            <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>会場</label>
            <select value={form.venue} onChange={e=>setForm({...form,venue:e.target.value})}
              style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",fontSize:14}}>
              {venues.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* 役割 */}
          <div>
            <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>役割</label>
            <div style={{display:"flex",gap:6}}>
              {MC_ROLES.map(r=>(
                <button key={r} onClick={()=>setForm({...form,role:r})}
                  style={{flex:1,border:`2px solid ${form.role===r?C.blue:C.border}`,
                    borderRadius:8,padding:"8px 4px",cursor:"pointer",fontSize:12,fontWeight:700,
                    background:form.role===r?C.blueL:"#fff",
                    color:form.role===r?C.blue:C.muted}}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          {/* 種別（パントリー以外） */}
          {form.role!=="パントリー"&&(
            <div>
              <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>種別</label>
              <div style={{display:"flex",gap:6}}>
                {MC_TYPES.map(t=>(
                  <button key={t} onClick={()=>setForm({...form,type:t})}
                    style={{flex:1,border:`2px solid ${form.type===t?C.purple:C.border}`,
                      borderRadius:8,padding:"8px 4px",cursor:"pointer",fontSize:11,fontWeight:700,
                      background:form.type===t?C.purpleLight||"#ede9fe":"#fff",
                      color:form.type===t?C.purple:C.muted}}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* 単価プレビュー */}
          {staffRate>0&&(
            <div style={{background:C.greenL,borderRadius:8,padding:"8px 12px",fontSize:13,color:C.green,fontWeight:600}}>
              💴 あなたの単価: {staffRate.toLocaleString()}円
            </div>
          )}
          {staffRate===0&&(
            <div style={{background:C.amberL,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.amber}}>
              ⚠️ 単価は管理者が設定します
            </div>
          )}
          <button onClick={save} disabled={saving}
            style={{...Btn(C.green),padding:"12px",fontSize:14,opacity:saving?0.6:1}}>
            {saving?"保存中…":"✅ この内容で記録する"}
          </button>
        </div>
      </div>

      {/* 履歴 */}
      <div style={GC}>
        <h3 style={{margin:"0 0 14px",fontSize:15}}>{year}年{month}月の記録</h3>
        {loading&&<p style={{color:C.muted,fontSize:13}}>読み込み中…</p>}
        {!loading&&records.length===0&&<p style={{color:C.muted,fontSize:13}}>まだ記録がありません</p>}
        {!loading&&records.sort((a,b)=>a.date>b.date?1:-1).map(r=>(
          <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
            borderBottom:`1px solid ${C.border}`,padding:"10px 0"}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13}}>{r.date}　{r.company}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                {r.venue}　{r.role}{r.role!=="パントリー"?`（${r.type}）`:""}
              </div>
            </div>
            <button onClick={()=>del(r.id)}
              style={{color:C.red,background:"none",border:`1px solid ${C.border}`,
                borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>削除</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// MC集計（事務・管理者用）
function MCAccountingView({ year, month, cfg }) {
  const staff = Array.from(new Set([...(cfg.mcStaff||[]),...(cfg.assistStaff||[]),...(cfg.pantryStaff||[]),...(cfg.staff||[])]));
  const [allRecords, setAllRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const billing = cfg.mcBilling || DEFAULT_MC_BILLING;
  const rates   = cfg.mcRates   || {};
  const payRates= cfg.payRates  || DEFAULT_PAY_RATES;

  useEffect(() => {
    Promise.all(
      staff.map(s => stLoad(`mc-${year}-${p2(month)}-${s}`).then(d=>(d||[]).map(r=>({...r,staff:s}))))
    ).then(all => {
      setAllRecords(all.flat());
      setLoading(false);
    });
  }, [year, month, staff]);

  if (loading) return <div style={{padding:40,textAlign:"center",color:C.muted}}>読み込み中…</div>;

  // スタッフ別集計
  const staffSummary = staff.map(name => {
    const recs = allRecords.filter(r=>r.staff===name);
    let pay = 0;
    recs.forEach(r => {
      const rateKey = r.training ? "研修" : r.role;
      const roleRateKey = r.role==="司会"?"mcDaily":r.role==="パントリー"?"pantryDaily":"assistantDaily";
      const rate = rates[name]?.[r.company]?.[rateKey] || payRates[roleRateKey] || 0;
      pay += rate;
    });
    return { name, count:recs.length, pay, recs };
  }).filter(s=>s.count>0);

  // 葬儀場別請求集計
  const billByCompany = {};
  Object.keys(MC_COMPANIES).forEach(company => {
    let total=0, tax=0;
    allRecords.filter(r=>r.company===company).forEach(r => {
      const t = r.role==="パントリー"?"2日葬":(r.type||"2日葬");
      const amt = billing[company]?.[r.role]?.[t] || 0;
      total += amt;
      tax   += Math.round(amt * TAX_RATE);
    });
    billByCompany[company] = { sub:total, tax, total:total+tax, count:allRecords.filter(r=>r.company===company).length };
  });

  const totalPay  = staffSummary.reduce((a,s)=>a+s.pay,0);
  const totalBill = Object.values(billByCompany).reduce((a,b)=>a+b.total,0);

  const dlCSV = () => {
    const rows = [
      [`${year}年${month}月 司会・アシスタント出勤記録`],[``],
      ["スタッフ","日付","会社","会場","役割","種別","支払単価(円)","請求単価(円)","請求額税抜","消費税"],
    ];
    allRecords.sort((a,b)=>a.date>b.date?1:-1).forEach(r=>{
      const roleRateKey = r.role==="司会"?"mcDaily":r.role==="パントリー"?"pantryDaily":"assistantDaily";
      const pay = rates[r.staff]?.[r.company]?.[r.role] || payRates[roleRateKey] || 0;
      const t   = r.role==="パントリー"?"2日葬":(r.type||"2日葬");
      const bill= billing[r.company]?.[r.role]?.[t] || 0;
      rows.push([r.staff,r.date,r.company,r.venue,r.role,r.role==="パントリー"?"－":t,
        pay,bill,bill,Math.round(bill*TAX_RATE)]);
    });
    downloadCSV(`MC出勤記録_${year}年${month}月.csv`,rows);
  };

  return (
    <div>
      {/* サマリ */}
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        {[
          {label:"葬儀場への請求合計",val:yen(totalBill),color:C.navy},
          {label:"スタッフへの支払合計",val:yen(totalPay),color:C.blue},
          {label:"差引（粗利）",val:yen(totalBill-totalPay),color:(totalBill-totalPay)>=0?C.green:C.red},
        ].map(({label,val,color})=>(
          <div key={label} style={{...GC,marginBottom:0,flex:"1 1 130px",textAlign:"center",padding:"14px 10px"}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{label}</div>
            <div style={{fontSize:17,fontWeight:800,color}}>{val}</div>
          </div>
        ))}
      </div>

      {/* スタッフ別 */}
      <div style={GC}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
          <h3 style={{margin:0,fontSize:14}}>👤 スタッフ別集計</h3>
          <button style={{...Btn(C.green),fontSize:12,padding:"6px 14px"}} onClick={dlCSV}>📥 CSV出力</button>
        </div>
        {staffSummary.length===0&&<p style={{color:C.muted,fontSize:13}}>記録がありません</p>}
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#f8f9fb"}}>
              <th style={TH}>スタッフ</th><th style={TH}>回数</th><th style={TH}>支払額</th>
            </tr></thead>
            <tbody>
              {staffSummary.map(s=>(
                <tr key={s.name}>
                  <td style={{...TD,fontWeight:700}}>{s.name}</td>
                  <td style={{...TD,textAlign:"center"}}>{s.count}回</td>
                  <td style={{...TD,textAlign:"right",fontWeight:800,color:C.blue}}>{yen(s.pay)}</td>
                </tr>
              ))}
              <tr style={{background:"#f8f9fb"}}>
                <td style={{...TD,fontWeight:800}}>合計</td>
                <td style={{...TD,textAlign:"center",fontWeight:700}}>{staffSummary.reduce((a,s)=>a+s.count,0)}回</td>
                <td style={{...TD,textAlign:"right",fontWeight:800,color:C.blue,fontSize:15}}>{yen(totalPay)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 葬儀場別請求 */}
      <div style={GC}>
        <h3 style={{margin:"0 0 12px",fontSize:14}}>🏛️ 葬儀場別請求</h3>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#f8f9fb"}}>
              <th style={TH}>会社</th><th style={TH}>件数</th>
              <th style={TH}>小計(税抜)</th><th style={TH}>消費税</th><th style={TH}>請求額(税込)</th>
            </tr></thead>
            <tbody>
              {Object.entries(billByCompany).map(([company,b])=>(
                <tr key={company}>
                  <td style={{...TD,fontWeight:700}}>{company}</td>
                  <td style={{...TD,textAlign:"center"}}>{b.count}件</td>
                  <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(b.sub)}</td>
                  <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(b.tax)}</td>
                  <td style={{...TD,textAlign:"right",fontWeight:800,color:C.purple}}>{yen(b.total)}</td>
                </tr>
              ))}
              <tr style={{background:"#f8f9fb"}}>
                <td style={{...TD,fontWeight:800}}>合計</td>
                <td style={{...TD,textAlign:"center",fontWeight:700}}>{allRecords.length}件</td>
                <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(Object.values(billByCompany).reduce((a,b)=>a+b.sub,0))}</td>
                <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(Object.values(billByCompany).reduce((a,b)=>a+b.tax,0))}</td>
                <td style={{...TD,textAlign:"right",fontWeight:800,color:C.purple,fontSize:15}}>{yen(totalBill)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 明細 */}
      <div style={{...GC,overflowX:"auto",padding:0}}>
        <div style={{padding:"14px 16px",fontWeight:700,fontSize:14,borderBottom:`1px solid ${C.border}`}}>📋 全件明細</div>
        {allRecords.length===0&&<p style={{padding:20,textAlign:"center",color:C.muted,fontSize:13}}>記録がありません</p>}
        {allRecords.length>0&&(
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:480}}>
            <thead><tr style={{background:"#f8f9fb"}}>
              <th style={TH}>日付</th><th style={TH}>スタッフ</th>
              <th style={TH}>会社</th><th style={TH}>会場</th>
              <th style={TH}>役割</th><th style={TH}>種別</th>
            </tr></thead>
            <tbody>
              {allRecords.sort((a,b)=>a.date>b.date?1:-1).map(r=>(
                <tr key={r.id}>
                  <td style={{...TD,fontWeight:600,whiteSpace:"nowrap"}}>{r.date}</td>
                  <td style={{...TD,fontWeight:600}}>{r.staff}</td>
                  <td style={TD}>{r.company}</td>
                  <td style={TD}>{r.venue}</td>
                  <td style={{...TD,fontWeight:600}}>{r.role}</td>
                  <td style={{...TD,color:C.muted}}>{r.role==="パントリー"?"－":(r.type||"－")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// MC設定（管理者設定画面に追加）
