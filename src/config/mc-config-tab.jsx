function MCConfigTab({ cfg, sv }) {
  const staff = Array.from(new Set([...(cfg.mcStaff||[]),...(cfg.assistStaff||[]),...(cfg.pantryStaff||[]),...(cfg.staff||[])]));
  const [billing, setBilling] = useState(
    JSON.parse(JSON.stringify(cfg.mcBilling || DEFAULT_MC_BILLING))
  );
  const [rates, setRates] = useState(
    JSON.parse(JSON.stringify(cfg.mcRates || {}))
  );
  const [saved, setSaved] = useState(false);

  const setRate = (name, company, role, val) => {
    const n = {...rates};
    if(!n[name]) n[name]={};
    if(!n[name][company]) n[name][company]={};
    n[name][company][role] = Number(val)||0;
    setRates(n);
  };

  const setBill = (company, role, type, val) => {
    const n = JSON.parse(JSON.stringify(billing));
    if(!n[company]) n[company]={};
    if(!n[company][role]) n[company][role]={};
    n[company][role][type] = Number(val)||0;
    setBilling(n);
  };

  const save = () => {
    sv.sets({...cfg, mcBilling:billing, mcRates:rates});
    setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  };

  return (
    <div>
      {/* 葬儀場への請求単価 */}
      {Object.keys(MC_COMPANIES).map(company=>(
        <div key={company} style={GC}>
          <h3 style={{margin:"0 0 14px",fontSize:14,color:C.navy}}>🏛️ {company}　葬儀場への請求単価（税抜）</h3>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:360}}>
              <thead><tr style={{background:"#f8f9fb"}}>
                <th style={TH}>役割</th>
                {MC_TYPES.map(t=><th key={t} style={TH}>{t}</th>)}
              </tr></thead>
              <tbody>
                {MC_ROLES.map(role=>(
                  <tr key={role}>
                    <td style={{...TD,fontWeight:700}}>{role}</td>
                    {MC_TYPES.map(type=>(
                      <td key={type} style={TD}>
                        {role==="パントリー"&&type!=="2日葬"
                          ? <span style={{color:C.muted,fontSize:12}}>－</span>
                          : <input type="number" value={billing[company]?.[role]?.[type]||0}
                              onChange={e=>setBill(company,role,type,e.target.value)}
                              style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:6,
                                padding:"5px 8px",fontSize:13,boxSizing:"border-box"}}/>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* スタッフ個人単価 */}
      <div style={GC}>
        <h3 style={{margin:"0 0 14px",fontSize:14,color:C.navy}}>👤 スタッフへの支払い単価（1回あたり）</h3>
        <p style={{fontSize:12,color:C.muted,marginBottom:12}}>🎓「研修」列はあしべの杜の研修期間中の単価です</p>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:500}}>
            <thead><tr style={{background:"#f8f9fb"}}>
              <th style={{...TH,fontSize:11}}>スタッフ</th>
              {Object.keys(MC_COMPANIES).flatMap(c=>
                [...MC_ROLES,...(c==="あしべの杜"?["研修"]:[])].map(r=>(
                  <th key={`${c}-${r}`} style={{...TH,fontSize:10,color:r==="研修"?"#92400e":undefined}}>
                    {c==="飛鳥会館"?"飛鳥":c==="あしべの杜"?"あしべ":"ふかしな"}<br/>{r}
                  </th>
                ))
              )}
            </tr></thead>
            <tbody>
              {staff.map(name=>(
                <tr key={name}>
                  <td style={{...TD,fontWeight:700,whiteSpace:"nowrap",fontSize:12}}>{name}</td>
                  {Object.keys(MC_COMPANIES).flatMap(company=>
                    [...MC_ROLES,...(company==="あしべの杜"?["研修"]:[])].map(role=>(
                      <td key={`${company}-${role}`} style={TD}>
                        <input type="number"
                          value={rates[name]?.[company]?.[role]||""}
                          onChange={e=>setRate(name,company,role,e.target.value)}
                          placeholder="0"
                          style={{width:"100%",minWidth:55,border:`1px solid ${role==="研修"?"#f59e0b":C.border}`,
                            borderRadius:6,padding:"4px 6px",fontSize:12,boxSizing:"border-box",
                            background:role==="研修"?"#fffbeb":"#fff"}}/>
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button style={{...Btn(saved?C.green:C.navy),padding:"12px 24px",fontSize:14}} onClick={save}>
        {saved?"✅ 保存しました":"保存する"}
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
