function StaffView(P){
  const [tab,setTab]=useState("wish");
  const tabs=[
    {id:"wish", label:"🙋 出勤希望"},
    {id:"shift",label:"📅 全体シフト"},
    {id:"mine", label:"👤 マイシフト"},
    {id:"rec",  label:"🕐 出勤記録"},
    {id:"mc",   label:"🎤 司会・記録"},
  ];
  return <div><MonthSel {...P}/><Tabs tabs={tabs} active={tab} onChange={setTab}/>
    {tab==="wish" &&<StaffWish  {...P}/>}
    {tab==="shift"&&<PublicShift {...P}/>}
    {tab==="mine" &&<MyShift    {...P}/>}
    {tab==="rec"  &&<MyRecord   {...P}/>}
    {tab==="mc"   &&<MCRecordTab {...P}/>}
  </div>;
}

function StaffWish({year,month,prefs,sv,uname}){
  const days=getDays(year,month);
  const myDays=prefs[uname]||[];
  const firstDow=new Date(year,month-1,1).getDay();
  const today=new Date();

  // 締め切り：翌月分の希望は当月16日まで
  // 例：6月分希望 → 5月16日が締め切り
  const deadlineMonth = month===1?12:month-1;
  const deadlineYear  = month===1?year-1:year;
  const deadline      = new Date(deadlineYear, deadlineMonth-1, 16, 23, 59, 59);
  const isLocked      = today > deadline;

  // 残り日数
  const diffMs   = deadline - today;
  const diffDays = Math.ceil(diffMs / (1000*60*60*24));

  const toggle=d=>{
    if(isLocked) return;
    const cur=prefs[uname]||[];
    sv.prefs({...prefs,[uname]:cur.includes(d)?cur.filter(x=>x!==d):[...cur,d]});
  };

  return <div style={GC}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4,flexWrap:"wrap",gap:8}}>
      <h3 style={{margin:0,fontSize:15}}>出勤希望日の登録</h3>
      {/* 締め切りバナー */}
      {isLocked
        ? <span style={{background:C.redL,color:C.red,borderRadius:8,padding:"4px 12px",
            fontSize:12,fontWeight:700}}>🔒 締め切り済み（{deadlineMonth}月16日）</span>
        : diffDays<=3
          ? <span style={{background:"#fee2e2",color:C.red,borderRadius:8,padding:"4px 12px",
              fontSize:12,fontWeight:700}}>⚠️ 締め切りまであと{diffDays}日！</span>
          : diffDays<=7
            ? <span style={{background:C.amberL,color:C.amber,borderRadius:8,padding:"4px 12px",
                fontSize:12,fontWeight:700}}>⏰ 締め切りまであと{diffDays}日</span>
            : <span style={{background:C.greenL,color:C.green,borderRadius:8,padding:"4px 12px",
                fontSize:12,fontWeight:700}}>📅 締め切り: {deadlineMonth}月16日</span>
      }
    </div>
    <p style={{color:C.muted,fontSize:12,margin:"0 0 14px"}}>
      {isLocked
        ? `${year}年${month}月分の希望受付は終了しました`
        : "出勤できる日をタップ → 緑になったら登録されます"}
    </p>

    {isLocked && (
      <div style={{background:"#f9f9f9",borderRadius:10,padding:"12px 16px",marginBottom:12,
        border:`1px dashed ${C.border}`}}>
        <div style={{fontSize:13,color:C.muted,marginBottom:6}}>登録済み希望日（変更不可）</div>
        {myDays.length===0
          ? <span style={{fontSize:13,color:C.muted}}>希望なし</span>
          : <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {myDays.sort((a,b)=>a-b).map(d=>(
                <span key={d} style={{background:C.greenL,color:C.green,borderRadius:6,
                  padding:"3px 10px",fontSize:13,fontWeight:600}}>
                  {d}日({getWday(year,month,d)})
                </span>
              ))}
            </div>
        }
      </div>
    )}

    {!isLocked && (
      <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:12}}>
          {WEEKDAYS.map((w,i)=><div key={w} style={{textAlign:"center",fontSize:11,fontWeight:700,
            padding:"4px 0",color:i===0?C.sun:i===6?C.sat:C.muted}}>{w}</div>)}
          {Array.from({length:firstDow},(_,i)=><div key={`e${i}`}/>)}
          {Array.from({length:days},(_,i)=>i+1).map(d=>{
            const wdi=getWdayI(year,month,d),ok=myDays.includes(d);
            return <button key={d} onClick={()=>toggle(d)}
              style={{padding:"10px 4px",border:ok?`2px solid ${C.green}`:`1px solid ${C.border}`,
                borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700,
                background:ok?C.greenL:"#fff",color:ok?C.green:wdi===0?C.sun:wdi===6?C.sat:C.text}}>
              {d}</button>;
          })}
        </div>
        <div style={{fontSize:12,color:C.muted}}>
          希望日（{myDays.length}日）:&nbsp;
  
          {myDays.length===0?"なし":myDays.sort((a,b)=>a-b).map(d=>`${d}日(${getWday(year,month,d)})`).join("・")}
        </div>
      </>
    )}
  </div>;
}

// ─── 全体シフト（コンシェルジュ・ディレクター・事務 共通）─────────────
function PublicShift({year,month,shifts,vconf,cfg,uname=""}){
  const printShift=()=>window.print();

  const days=getDays(year,month);
  const {venues}=cfg;
  const today=new Date();
  const todayD=today.getDate();
  const isTM=year===today.getFullYear()&&month===today.getMonth()+1;

  return <div>
 
    
    <div style={{marginBottom:8}}>
  <button onClick={printShift} style={{...Btn(C.navy),fontSize:13,padding:"8px 18px"}}>🖨️ 印刷する</button>
</div>
<div style={{...GC,padding:"10px 16px",fontSize:12,color:C.muted,display:"flex",gap:16,flexWrap:"wrap"}}>
      <span>🟢 自分のシフト</span><span>📍 会場確定済</span><span>⏳ 前日確定待ち</span>
    </div>
    <div style={{...GC,overflowX:"auto",padding:0}}>
      <table style={{width:"100%",borderCollapse:"collapse",minWidth:340}}>
        <thead>
          <tr style={{background:C.navy}}>
            <th style={{...TH,color:"rgba(255,255,255,.8)",borderBottom:"none",width:32}}>日</th>
            <th style={{...TH,color:"rgba(255,255,255,.8)",borderBottom:"none",width:24}}>曜</th>
            {venues.map(v=><th key={v.name} style={{...TH,color:"rgba(255,255,255,.8)",borderBottom:"none"}}>{v.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({length:days},(_,i)=>i+1).map(d=>{
            const wdi=getWdayI(year,month,d);
            const isToday=isTM&&d===todayD;
            const bg=isToday?"#fffbeb":wdi===0?"#fff5f5":wdi===6?"#f0f4ff":"#fff";
            return <tr key={d} style={{background:bg}}>
              <td style={{...TD,textAlign:"center",fontWeight:700,fontSize:13,
                background:isToday?C.amber:undefined,color:isToday?"#fff":undefined}}>{d}</td>
              <td style={{...TD,textAlign:"center",fontWeight:700,fontSize:12,
                color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,d)}</td>
              {venues.map(v=>{
                const assigned=shifts[d]?.[v.name]||"";
                const isMe=uname&&assigned===uname;
                const needConf=v.options.length>0;
                const confirmed=needConf?vconf[d]:null;
                return <td key={v.name} style={{...TD,padding:"4px 6px"}}>
                  {!assigned?<span style={{color:"#ccc",fontSize:12}}>−</span>:
                  <div style={{background:isMe?C.greenL:"transparent",
                    border:isMe?`1px solid ${C.green}`:"1px solid transparent",
                    borderRadius:7,padding:"4px 7px"}}>
                    <div style={{fontWeight:700,fontSize:13,color:isMe?C.green:C.text}}>{assigned}{isMe?" 👤":""}</div>
                    {needConf&&<div style={{fontSize:11,marginTop:1,fontWeight:600,
                      color:confirmed?C.teal:C.amber}}>
                      {confirmed?`📍 ${confirmed}`:"⏳ 確定待ち"}</div>}
                  </div>}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

function MyShift({year,month,shifts,vconf,uname,cfg}){
  const days=getDays(year,month);
  const myDays=[];
  for(let d=1;d<=days;d++) for(const v of cfg.venues){
    if(shifts[d]?.[v.name]===uname){
      const confirmed=v.options.length>0?vconf[d]:null;
      myDays.push({d,isPending:v.options.length>0&&!confirmed,display:confirmed||v.name});
    }
  }
  return <div style={GC}>
    <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:16}}>
      <h3 style={{margin:0,fontSize:15}}>{year}年{month}月 マイシフト</h3>
      <span style={{color:C.blue,fontSize:13,fontWeight:700}}>計{myDays.length}日</span>
    </div>
    {myDays.length===0?<p style={{color:C.muted,fontSize:13}}>シフトが確定していません</p>:
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr style={{background:"#f8f9fb"}}>
          <th style={TH}>日付</th><th style={TH}>曜</th><th style={TH}>勤務場所</th><th style={TH}>時間</th>
        </tr></thead>
        <tbody>{myDays.map(({d,display,isPending})=>{
          const wdi=getWdayI(year,month,d);
          return <tr key={d}>
            <td style={{...TD,textAlign:"center",fontWeight:700}}>{month}/{d}</td>
            <td style={{...TD,textAlign:"center",fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,d)}</td>
            <td style={TD}>{isPending
              ?<span style={{color:C.amber,fontWeight:700}}>⏳ {display}（前日確定待ち）</span>
              :<span style={{fontWeight:600}}>{display}</span>}</td>
            <td style={{...TD,color:C.muted}}>9:00〜16:00</td>
          </tr>;
        })}</tbody>
      </table>}
  </div>;
}

function MyRecord({year,month,shifts,att,sv,uname,cfg}){
  const days=getDays(year,month),today=new Date();
  const [ed,setEd]=useState(null);
  const myS=[];
  for(let d=1;d<=days;d++){
    if(year===today.getFullYear()&&month===today.getMonth()+1&&d>today.getDate())continue;
    for(const v of cfg.venues){
      if(shifts[d]?.[v.name]===uname){const key=`${d}-${v.name}`;myS.push({d,venue:v.name,key,rec:att[key]});}
    }
  }
  const submit=()=>{
    if(!ed)return;
    sv.att({...att,[ed.key]:{staff:uname,start:ed.s,end:ed.e,breakMin:ed.b,submittedAt:new Date().toISOString(),verified:false}});
    setEd(null);
  };
  return <div style={GC}>
    <h3 style={{margin:"0 0 4px",fontSize:15}}>出勤記録の入力</h3>
    <p style={{color:C.muted,fontSize:12,margin:"0 0 16px"}}>出勤した日の実際の時間を入力してください</p>
    {myS.length===0&&<p style={{color:C.muted,fontSize:13}}>入力できる記録がありません</p>}
    {myS.map(({d,venue,key,rec})=>{
      const wdi=getWdayI(year,month,d),isE=ed?.key===key;
      const h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):null;
      return <div key={key} style={{borderBottom:`1px solid ${C.border}`,padding:"12px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontWeight:700,color:wdi===0?C.sun:wdi===6?C.sat:C.text}}>{month}/{d}({getWday(year,month,d)})</span>
          <span style={{color:C.muted,fontSize:13}}>{venue}</span>
          {rec?.verified&&<span style={{color:C.green,fontSize:12,fontWeight:700}}>✅ 承認済</span>}
          {rec&&!rec.verified&&<span style={{color:C.blue,fontSize:12}}>{rec.start}〜{rec.end}（休憩{rec.breakMin??60}分・実働{h}h）</span>}
          {!rec?.verified&&<button onClick={()=>setEd({key,s:rec?.start||"09:00",e:rec?.end||"16:00",b:rec?.breakMin??60})}
            style={{...Btn(isE?C.muted:C.blue),marginLeft:"auto",fontSize:12,padding:"5px 12px"}}>{rec?"修正":"入力"}</button>}
        </div>
        {isE&&<div style={{display:"flex",gap:8,alignItems:"center",marginTop:10,flexWrap:"wrap"}}>
          <label style={{fontSize:12,fontWeight:600}}>開始</label>
          <input type="time" value={ed.s} onChange={e=>setEd({...ed,s:e.target.value})}
            style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",fontSize:14}}/>
          <label style={{fontSize:12,fontWeight:600}}>終了</label>
          <input type="time" value={ed.e} onChange={e=>setEd({...ed,e:e.target.value})}
            style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",fontSize:14}}/>
          <label style={{fontSize:12,fontWeight:600}}>休憩</label>
          <select value={ed.b} onChange={e=>setEd({...ed,b:Number(e.target.value)})}
            style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",fontSize:14}}>
            {[0,15,30,45,60].map(m=>(
              <option key={m} value={m}>{m}分</option>
            ))}
          </select>
          <div style={{fontSize:12,color:C.green,fontWeight:700}}>
            実働 {parseHours(ed.s,ed.e,ed.b)}h
          </div>
          <button onClick={submit} style={Btn(C.green)}>保存</button>
          <button onClick={()=>setEd(null)} style={{...Btn("transparent",C.muted),border:`1px solid ${C.border}`}}>キャンセル</button>
        </div>}
      </div>;
    })}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// VENUE VIEW
// ═══════════════════════════════════════════════════════════════
