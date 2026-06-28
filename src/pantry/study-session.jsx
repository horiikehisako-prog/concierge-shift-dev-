function StudySessionView({year,month}){
  const [sessions,setSessions]=useState([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({date:`${year}-${p2(month)}-01`,start:"16:00",end:"18:00"});
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    stLoad(`study-${year}-${p2(month)}`).then(d=>{setSessions(d||[]);setLoading(false);});
  },[year,month]);

  const save=async()=>{
    setSaving(true);
    const [sh,sm]=form.start.split(":").map(Number);
    const [eh,em]=form.end.split(":").map(Number);
    const h=Math.round(((eh*60+em)-(sh*60+sm))/60*100)/100;
    const sub=Math.round(h*STUDY_RATE);
    const tax=Math.round(sub*TAX_RATE);
    const newRec={id:Date.now(),date:form.date.replace(/-/g,"/"),start:form.start,end:form.end,hours:h,sub,tax,total:sub+tax};
    const updated=[...sessions,newRec];
    await stSave(`study-${year}-${p2(month)}`,updated);
    setSessions(updated);setSaving(false);
  };

  const del=async(id)=>{
    const updated=sessions.filter(s=>s.id!==id);
    await stSave(`study-${year}-${p2(month)}`,updated);
    setSessions(updated);
  };

  const totalH=Math.round(sessions.reduce((a,s)=>a+s.hours,0)*100)/100;
  const totalTotal=sessions.reduce((a,s)=>a+s.total,0);

  return <div>
    <div style={GC}>
      <h3 style={{margin:"0 0 14px",fontSize:15}}>📚 勉強会記録　<span style={{fontWeight:400,fontSize:13,color:C.muted}}>{STUDY_RATE.toLocaleString()}円/h + 消費税</span></h3>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <div style={{flex:"1 1 100px"}}>
          <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>日付</label>
          <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}
            style={{width:"100%",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",fontSize:14,boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>開始</label>
          <input type="time" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}
            style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",fontSize:14}}/>
        </div>
        <div>
          <label style={{fontSize:12,color:C.muted,display:"block",marginBottom:4}}>終了</label>
          <input type="time" value={form.end} onChange={e=>setForm({...form,end:e.target.value})}
            style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",fontSize:14}}/>
        </div>
      </div>
      <div style={{fontSize:13,color:C.green,fontWeight:700,marginBottom:10}}>
        費用: {yen(Math.round(((new Date(`2000-01-01T${form.end}`)-new Date(`2000-01-01T${form.start}`))/3600000)*STUDY_RATE))}（税抜）
      </div>
      <button onClick={save} disabled={saving} style={{...Btn(C.navy),padding:"10px 20px",fontSize:14}}>
        {saving?"保存中…":"✅ 追加する"}
      </button>
    </div>
    <div style={GC}>
      <div style={{display:"flex",gap:20,marginBottom:14,flexWrap:"wrap"}}>
        {[["合計時間",`${totalH}h`,C.blue],["合計費用(税込)",yen(totalTotal),C.purple]].map(([l,v,c])=>(
          <div key={l} style={{textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:11,color:C.muted}}>{l}</div>
          </div>
        ))}
      </div>
      {loading&&<p style={{color:C.muted,fontSize:13}}>読み込み中…</p>}
      {!loading&&sessions.length===0&&<p style={{color:C.muted,fontSize:13}}>記録がありません</p>}
      {[...sessions].sort((a,b)=>a.date>b.date?1:-1).map(s=>(
        <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,borderBottom:`1px solid ${C.border}`,padding:"10px 0",flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14}}>{s.date}　{s.start}〜{s.end}　{s.hours}時間</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
              {yen(s.sub)}（税抜）+ 税 {yen(s.tax)} = <strong style={{color:C.purple}}>{yen(s.total)}</strong>
            </div>
          </div>
          <button onClick={()=>del(s.id)} style={{color:C.red,background:"none",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12}}>削除</button>
        </div>
      ))}
    </div>
  </div>;
}

// MC記録タブ（スタッフ画面に追加）
