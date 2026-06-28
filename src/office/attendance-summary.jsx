function AttendanceSummaryView({year,month,att,shifts,vconf,cfg}){
  const {staff,venues}=cfg;
  const days=getDays(year,month);
  const [view,setView]=useState("staff"); // "staff" or "venue"
  const [selected,setSelected]=useState(null);

  const actualVenue=(d,vName)=>{
    const isFlexVenue=cfg.venues.find(v=>v.name===vName)?.options?.length>0;
    if(isFlexVenue&&vconf&&vconf[d]){if(typeof vconf[d]==="string") return vconf[d];if(vconf[d][vName]) return vconf[d][vName];}
    return vName;
  };

  // スタッフ別データ
  const staffData=staff.map(name=>{
    const records=[];
    for(let d=1;d<=days;d++) for(const v of venues){
      if(shifts[d]?.[v.name]===name){
        const key=`${d}-${v.name}`,rec=att[key];
        const aVenue=actualVenue(d,v.name);
        const h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):DEFAULT_HOURS;
        const ot=Math.max(0,Math.round((h-OVERTIME_HOURS)*100)/100);
        records.push({
          d,venue:aVenue,
          start:rec?.start||"09:00",end:rec?.end||"16:00",
          break:rec?.breakMin??60,hours:h,ot,
          verified:!!rec?.verified,input:!!rec
        });
      }
    }
    const totalH=Math.round(records.reduce((a,r)=>a+r.hours,0)*100)/100;
    return {name,records,totalH};
  }).filter(r=>r.records.length>0);

  // 会場別データ
  const venueData={};
  for(let d=1;d<=days;d++) for(const v of venues){
    const sn=shifts[d]?.[v.name];if(!sn)continue;
    const aVenue=actualVenue(d,v.name);
    const key=`${d}-${v.name}`,rec=att[key];
    const h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):DEFAULT_HOURS;
    const billingVenue=normalizeBillingVenue(aVenue);if(!venueData[billingVenue]) venueData[billingVenue]=[];
    venueData[billingVenue].push({d,staff:sn,start:rec?.start||"09:00",end:rec?.end||"16:00",hours:h,verified:!!rec?.verified,input:!!rec});
  }

  const allVenues=Object.keys(venueData).sort();

  return <div>
    {/* 切替タブ */}
    <div style={{display:"flex",gap:8,padding:"0 4px 14px"}}>
      {[["staff","👤 スタッフ別"],["venue","🏛️ 会場別"]].map(([v,l])=>(
        <button key={v} onClick={()=>{setView(v);setSelected(null);}}
          style={{...Btn(view===v?C.navy:"#fff"),color:view===v?"#fff":C.muted,
            border:`1px solid ${view===v?C.navy:C.border}`,fontSize:13,padding:"8px 20px"}}>
          {l}
        </button>
      ))}
    </div>

    {/* スタッフ別 */}
    {view==="staff" && <div>
      {staffData.map(({name,records,totalH})=>(
        <div key={name} style={GC}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            marginBottom:10,cursor:"pointer"}} onClick={()=>setSelected(selected===name?null:name)}>
            <div>
              <span style={{fontWeight:800,fontSize:15}}>{name}</span>
              <span style={{color:C.muted,fontSize:13,marginLeft:10}}>{records.length}日勤務　合計 {totalH}h</span>
            </div>
            <span style={{color:C.muted,fontSize:18}}>{selected===name?"▲":"▼"}</span>
          </div>
          {selected===name&&(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:"#f8f9fb"}}>
                <th style={TH}>日付</th><th style={TH}>曜</th><th style={TH}>会場</th>
                <th style={TH}>時間</th><th style={TH}>実働</th><th style={TH}>残業</th><th style={TH}>状態</th>
              </tr></thead>
              <tbody>
                {records.map(r=>{
                  const wdi=getWdayI(year,month,r.d);
                  return <tr key={r.d+r.venue} style={{background:r.ot>0?"#fff5f5":"#fff"}}>
                    <td style={{...TD,fontWeight:700,whiteSpace:"nowrap"}}>{month}/{r.d}</td>
                    <td style={{...TD,textAlign:"center",color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,r.d)}</td>
                    <td style={{...TD,fontWeight:600}}>{r.venue}</td>
                    <td style={{...TD,color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>{r.start}〜{r.end}<br/>休憩{r.break}分</td>
                    <td style={{...TD,textAlign:"center",fontWeight:700}}>{r.hours}h</td>
                    <td style={{...TD,textAlign:"center",color:r.ot>0?C.red:C.muted,fontWeight:r.ot>0?700:400}}>
                      {r.ot>0?`${r.ot}h`:"－"}
                    </td>
                    <td style={{...TD,textAlign:"center",fontSize:12}}>
                      {r.verified?"✅":r.input?"⏳未承認":"📝未入力"}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          )}
          {selected!==name&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {records.map(r=>(
                <span key={r.d+r.venue} style={{
                  background:r.ot>0?"#fee2e2":r.verified?"#dcfce7":"#f0f9ff",
                  color:r.ot>0?C.red:r.verified?C.green:C.blue,
                  borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:600}}>
                  {month}/{r.d} {r.venue} {r.start}〜{r.end}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {staffData.length===0&&<div style={{...GC,textAlign:"center",color:C.muted}}>勤務記録がありません</div>}
    </div>}

    {/* 会場別 */}
    {view==="venue" && <div>
      {/* 会場ボタン */}
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14,padding:"0 4px"}}>
        {allVenues.map(v=>(
          <button key={v} onClick={()=>setSelected(selected===v?null:v)}
            style={{...Btn(selected===v?C.navy:"#fff"),color:selected===v?"#fff":C.text,
              border:`1px solid ${selected===v?C.navy:C.border}`,fontSize:13,padding:"8px 16px"}}>
            {v}
          </button>
        ))}
      </div>
      {selected&&venueData[selected]&&(
        <div style={GC}>
          <h3 style={{margin:"0 0 14px",fontSize:15}}>🏛️ {selected}　{month}月の出勤記録</h3>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#f8f9fb"}}>
              <th style={TH}>日付</th><th style={TH}>曜</th><th style={TH}>スタッフ</th>
              <th style={TH}>時間</th><th style={TH}>実働</th><th style={TH}>状態</th>
            </tr></thead>
            <tbody>
              {venueData[selected].sort((a,b)=>a.d-b.d).map(r=>{
                const wdi=getWdayI(year,month,r.d);
                return <tr key={r.d} style={{background:!r.input?"#fffbeb":"#fff"}}>
                  <td style={{...TD,fontWeight:700,whiteSpace:"nowrap"}}>{month}/{r.d}</td>
                  <td style={{...TD,textAlign:"center",color:wdi===0?C.sun:wdi===6?C.sat:C.muted}}>{getWday(year,month,r.d)}</td>
                  <td style={{...TD,fontWeight:700}}>{r.staff}</td>
                  <td style={{...TD,color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>{r.start}〜{r.end}</td>
                  <td style={{...TD,textAlign:"center",fontWeight:700}}>{r.hours}h</td>
                  <td style={{...TD,textAlign:"center",fontSize:12}}>
                    {r.verified?"✅":r.input?"⏳":"📝未入力"}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          <div style={{marginTop:12,textAlign:"right",color:C.muted,fontSize:12}}>
            合計 {venueData[selected].length}日 / {Math.round(venueData[selected].reduce((a,r)=>a+r.hours,0)*100)/100}h
          </div>
        </div>
      )}
      {!selected&&<div style={{...GC,textAlign:"center",color:C.muted,padding:30}}>上の会場名をタップすると詳細が表示されます</div>}
    </div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// 出勤表印刷（ファックス形式）
// ═══════════════════════════════════════════════════════════════
function PrintableSheet({year,month,shifts,att,vconf,cfg}){
  const {venues}=cfg;
  const days=getDays(year,month);

  const actualVenue=(d,vName)=>{
    const isFlexVenue=cfg.venues.find(v=>v.name===vName)?.options?.length>0;
    if(isFlexVenue&&vconf&&vconf[d]){if(typeof vconf[d]==="string") return vconf[d];if(vconf[d][vName]) return vconf[d][vName];}
    if(vName==="多or蔵") return "蔵王・多治米";
    return vName;
  };

  // 1日ごとに全会場のシフトをまとめる
  const rows=[];
  for(let d=1;d<=days;d++){
    const slots=[];
    for(const v of venues){
      const sn=shifts[d]?.[v.name];
      if(sn){
        const key=`${d}-${v.name}`,rec=att[key];
        const av=actualVenue(d,v.name);
        const h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):DEFAULT_HOURS;
        slots.push({staff:sn,venue:av,start:rec?.start||"9:00",end:rec?.end||"16:00",hours:h,verified:!!rec?.verified});
      }
    }
    rows.push({d,wday:getWday(year,month,d),wdayI:getWdayI(year,month,d),slots});
  }

  // スタッフ別合計
  const staffTotals={};
  rows.forEach(row=>row.slots.forEach(s=>{
    if(!staffTotals[s.staff]) staffTotals[s.staff]={name:s.staff,count:0,hours:0};
    staffTotals[s.staff].count++;
    staffTotals[s.staff].hours+=s.hours;
  }));

  const printStyle=`
    @media print {
      body * { visibility: hidden; }
      #print-sheet, #print-sheet * { visibility: visible; }
      #print-sheet { position: absolute; left: 0; top: 0; width: 100%; }
      .no-print { display: none !important; }
      @page { size: A4; margin: 10mm; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
    }
  `;

  return <div>
    <style dangerouslySetInnerHTML={{__html:printStyle}}/>
    <div style={{...GC,textAlign:"center"}} className="no-print">
      <p style={{color:C.muted,fontSize:13,marginBottom:12}}>A4サイズで印刷されます。ブラウザの印刷機能をお使いください。</p>
      <button onClick={()=>window.print()}
        style={{...Btn(C.navy),fontSize:15,padding:"12px 32px"}}>
        🖨️ 印刷する（A4）
      </button>
    </div>

    <div id="print-sheet" style={{background:"#fff",padding:"8px",fontFamily:"'MS Gothic','Hiragino Kaku Gothic ProN',monospace"}}>
      {/* ヘッダー */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:14,fontWeight:700}}>春日斎場　出勤表</div>
        <div style={{fontSize:14,fontWeight:700}}>{year}年 {month}月</div>
      </div>

      {/* メイン表 */}
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,tableLayout:"fixed"}}>
        <thead>
          <tr style={{background:"#f0f0f0"}}>
            <th style={{...PS.th,width:"5%"}}>日付</th>
            <th style={{...PS.th,width:"5%"}}>曜</th>
            <th style={{...PS.th,width:"10%"}}>名前</th>
            <th style={{...PS.th,width:"15%"}}>動務場所</th>
            <th style={{...PS.th,width:"13%"}}>動務時間</th>
            <th style={{...PS.th,width:"5%"}}>時間</th>
            <th style={{...PS.th,width:"10%"}}>名前</th>
            <th style={{...PS.th,width:"15%"}}>動務場所</th>
            <th style={{...PS.th,width:"13%"}}>動務時間</th>
            <th style={{...PS.th,width:"5%"}}>時間</th>
            <th style={{...PS.th,width:"9%"}}>押印</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({d,wday,wdayI,slots})=>{
            const s0=slots[0]||null;
            const s1=slots[1]||null;
            const wColor=wdayI===0?"#ff0000":wdayI===6?"#0000cc":"#000";
            return <tr key={d} style={{borderBottom:"1px solid #ccc",minHeight:18}}>
              <td style={{...PS.td,textAlign:"center",fontWeight:700}}>{d}</td>
              <td style={{...PS.td,textAlign:"center",color:wColor,fontWeight:700}}>{wday}</td>
              {s0?<>
                <td style={{...PS.td,fontWeight:600}}>{s0.staff}</td>
                <td style={PS.td}>{s0.venue}</td>
                <td style={{...PS.td,textAlign:"center"}}>{s0.start}〜{s0.end}</td>
                <td style={{...PS.td,textAlign:"center"}}>{s0.hours}</td>
              </>:<>
                <td style={PS.td}></td><td style={PS.td}></td>
                <td style={PS.td}></td><td style={PS.td}></td>
              </>}
              {s1?<>
                <td style={{...PS.td,fontWeight:600}}>{s1.staff}</td>
                <td style={PS.td}>{s1.venue}</td>
                <td style={{...PS.td,textAlign:"center"}}>{s1.start}〜{s1.end}</td>
                <td style={{...PS.td,textAlign:"center"}}>{s1.hours}</td>
              </>:<>
                <td style={PS.td}></td><td style={PS.td}></td>
                <td style={PS.td}></td><td style={PS.td}></td>
              </>}
              <td style={{...PS.td,borderLeft:"2px solid #999"}}>{s0?.verified||s1?.verified?"✓":""}</td>
            </tr>;
          })}
          {/* 空行（31日まで） */}
          {rows.length<31&&<tr style={{borderBottom:"1px solid #ccc"}}>
            <td style={{...PS.td,textAlign:"center",color:C.muted}}>31</td>
            <td colSpan={10} style={PS.td}></td>
          </tr>}
        </tbody>
      </table>

      {/* 合計表 */}
      <div style={{marginTop:12,display:"flex",gap:16,alignItems:"flex-start"}}>
        <table style={{borderCollapse:"collapse",fontSize:11,minWidth:200}}>
          <thead><tr style={{background:"#f0f0f0"}}>
            <th style={PS.th}>名前</th><th style={PS.th}>日数</th><th style={PS.th}>合計時間</th>
          </tr></thead>
          <tbody>
            {Object.values(staffTotals).map(s=>(
              <tr key={s.name}>
                <td style={PS.td}>{s.name}</td>
                <td style={{...PS.td,textAlign:"center"}}>{s.count}日</td>
                <td style={{...PS.td,textAlign:"center"}}>{Math.round(s.hours*100)/100}h</td>
              </tr>
            ))}
            <tr style={{background:"#f0f0f0",fontWeight:700}}>
              <td style={PS.td}>合計</td>
              <td style={{...PS.td,textAlign:"center"}}>{Object.values(staffTotals).reduce((a,s)=>a+s.count,0)}日</td>
              <td style={{...PS.td,textAlign:"center"}}>{Math.round(Object.values(staffTotals).reduce((a,s)=>a+s.hours,0)*100)/100}h</td>
            </tr>
          </tbody>
        </table>
        <div style={{flex:1,border:"1px solid #ccc",padding:"6px 12px",fontSize:11,minHeight:60}}>
          <div style={{fontWeight:700,marginBottom:4}}>備考</div>
        </div>
      </div>
    </div>
  </div>;
}
const PS={
  th:{border:"1px solid #999",padding:"3px 4px",textAlign:"center",fontWeight:700,fontSize:11},
  td:{border:"1px solid #ccc",padding:"2px 4px",fontSize:11,height:18},
};

// ═══════════════════════════════════════════════════════════════
// 勉強会管理
// ═══════════════════════════════════════════════════════════════
