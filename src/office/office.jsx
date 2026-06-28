function normalizeBillingVenue(venueName) {
  if (venueName === "小さな多治米") return "小さな多治米";
  if (venueName === "小さな蔵王") return "小さな蔵王";
  if (venueName === "花園") return "花園";
  if (venueName === "多治米") return "多治米";
  if (venueName === "春日" || venueName === "春日斎場") return "春日";
  if (venueName === "多or蔵") return "多or蔵（未振り分け）";
  return venueName;
}
function AccountingView({year,month,att,shifts,vconf,cfg}){
  const {staff,venues,staffRates={}}=cfg;
  const days=getDays(year,month);

  const actualVenue=(d,vName)=>{
    const isFlexVenue=cfg.venues.find(v=>v.name===vName)?.options?.length>0;
    if(isFlexVenue&&vconf&&vconf[d]){if(typeof vconf[d]==="string") return vconf[d];if(vconf[d][vName]) return vconf[d][vName];}
    return vName;
  };

  const staffRows=staff.map(name=>{
    let totalDays=0,totalHours=0,totalOT=0;
    for(let d=1;d<=days;d++) for(const v of venues){
      if(shifts[d]?.[v.name]===name){
        const key=`${d}-${v.name}`,rec=att[key];
        const h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):DEFAULT_HOURS;
        const ot=Math.max(0,Math.round((h-OVERTIME_HOURS)*100)/100);
        totalDays++;totalHours+=h;totalOT+=ot;
      }
    }
    totalHours=Math.round(totalHours*100)/100;
    totalOT=Math.round(totalOT*100)/100;
    const rate=staffRates[name]||RATE_STAFF;
    const pay=Math.round(totalHours*rate);
    return {name,totalDays,totalHours,totalOT,pay,rate};
  }).filter(r=>r.totalDays>0);

  const venueMap={};
  for(let d=1;d<=days;d++) for(const v of venues){
    const sn=shifts[d]?.[v.name];if(!sn)continue;
    const aVenue=actualVenue(d,v.name);
    const billingVenue=normalizeBillingVenue(aVenue);
    const key=`${d}-${v.name}`,rec=att[key];
    const h=rec?parseHours(rec.start,rec.end,rec.breakMin??60):DEFAULT_HOURS;
    if(!venueMap[billingVenue]) venueMap[billingVenue]={name:billingVenue,days:0,hours:0};
    venueMap[billingVenue].days++;venueMap[billingVenue].hours+=h;
  }
  const venueRows=Object.values(venueMap).map(r=>{
    r.hours=Math.round(r.hours*100)/100;
    r.sub=Math.round(r.hours*RATE_BILL);
    r.tax=Math.round(r.sub*TAX_RATE);
    r.total=r.sub+r.tax;
    return r;
  });

  const totalPay=staffRows.reduce((a,r)=>a+r.pay,0);
  const totalBill=venueRows.reduce((a,r)=>a+r.total,0);
  const margin=totalBill-totalPay;
  const totalOT=staffRows.reduce((a,r)=>a+r.totalOT,0);

  const dlStaffCSV=()=>{
    const rows=[[`${year}年${month}月 コンシェルジュ給与明細`],[""],
      ["コンシェルジュ名","時給","日数","実働時間","残業時間","支払額"],
      ...staffRows.map(r=>[r.name,r.rate,r.totalDays,r.totalHours,r.totalOT,r.pay]),
      ["合計","",staffRows.reduce((a,r)=>a+r.totalDays,0),staffRows.reduce((a,r)=>a+r.totalHours,0),totalOT,totalPay]];
    downloadCSV(`給与明細_${year}年${month}月.csv`,rows);
  };
  const dlVenueCSV=()=>{
    const rows=[[`${year}年${month}月 会場別請求明細`],[""],
      ["会場","日数","時間","小計(税抜)","消費税","請求額(税込)"],
      ...venueRows.map(r=>[r.name,r.days,r.hours,r.sub,r.tax,r.total]),
      ["合計",venueRows.reduce((a,r)=>a+r.days,0),venueRows.reduce((a,r)=>a+r.hours,0),
       venueRows.reduce((a,r)=>a+r.sub,0),venueRows.reduce((a,r)=>a+r.tax,0),totalBill]];
    downloadCSV(`請求書明細_${year}年${month}月.csv`,rows);
  };
  const dlDetailCSV=()=>{
    const rows=[[`${year}年${month}月 出勤詳細`],[""],
      ["名前","日付","曜日","会場","開始","終了","休憩(分)","実働(h)","残業(h)","時給","支払額","承認"]];
    for(let d=1;d<=days;d++) for(const v of venues){
      const sn=shifts[d]?.[v.name];if(!sn)continue;
      const key=`${d}-${v.name}`,rec=att[key];
      const s=rec?.start||"09:00",e=rec?.end||"16:00",bm=rec?.breakMin??60,h=parseHours(s,e,bm);
      const ot=Math.max(0,Math.round((h-OVERTIME_HOURS)*100)/100);
      const rate=staffRates[sn]||RATE_STAFF;
      rows.push([sn,`${year}/${month}/${d}`,getWday(year,month,d),actualVenue(d,v.name),s,e,bm,h,ot,rate,Math.round(h*rate),rec?.verified?"承認済":"未承認"]);
    }
    downloadCSV(`出勤詳細_${year}年${month}月.csv`,rows);
  };

  return <div>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      {[
        {label:"請求合計(税込)",val:yen(totalBill),color:C.navy},
        {label:"支払合計",val:yen(totalPay),color:C.blue},
        {label:"差引(粗利)",val:yen(margin),color:margin>=0?C.green:C.red},
        {label:"残業時間",val:`${totalOT}h`,color:totalOT>0?C.red:C.muted},
      ].map(({label,val,color})=>(
        <div key={label} style={{...GC,marginBottom:0,flex:"1 1 120px",textAlign:"center",padding:"14px 10px"}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{label}</div>
          <div style={{fontSize:17,fontWeight:800,color}}>{val}</div>
        </div>
      ))}
    </div>
    <div style={{...GC,background:C.amberL,border:`1px solid ${C.amber}`,padding:"10px 14px",fontSize:12,color:"#92400e"}}>
      ⚠️ 出勤記録未入力の日はデフォルト{DEFAULT_HOURS}時間。残業は{OVERTIME_HOURS}時間超えを赤表示。
    </div>
    <div style={GC}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <h3 style={{margin:0,fontSize:14}}>👤 コンシェルジュ支払い</h3>
        <button style={{...Btn(C.green),fontSize:12,padding:"6px 12px"}} onClick={dlStaffCSV}>📥 給与CSV</button>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:"#f8f9fb"}}>
            <th style={TH}>名前</th><th style={TH}>時給</th><th style={TH}>日数</th>
            <th style={TH}>時間</th><th style={{...TH,color:C.red}}>残業</th><th style={{...TH,color:C.blue}}>支払額</th>
          </tr></thead>
          <tbody>
            {staffRows.map(r=>(
              <tr key={r.name} style={{background:r.totalOT>0?"#fff5f5":"#fff"}}>
                <td style={{...TD,fontWeight:700}}>{r.name}</td>
                <td style={{...TD,textAlign:"right",color:C.muted}}>{r.rate.toLocaleString()}円</td>
                <td style={{...TD,textAlign:"center"}}>{r.totalDays}日</td>
                <td style={{...TD,textAlign:"center"}}>{r.totalHours}h</td>
                <td style={{...TD,textAlign:"center",color:r.totalOT>0?C.red:C.muted,fontWeight:r.totalOT>0?700:400}}>
                  {r.totalOT>0?`${r.totalOT}h`:"－"}
                </td>
                <td style={{...TD,textAlign:"right",fontWeight:800,color:C.blue}}>{yen(r.pay)}</td>
              </tr>
            ))}
            <tr style={{background:"#f8f9fb",fontWeight:700}}>
              <td style={TD}>合計</td><td style={TD}></td>
              <td style={{...TD,textAlign:"center"}}>{staffRows.reduce((a,r)=>a+r.totalDays,0)}日</td>
              <td style={{...TD,textAlign:"center"}}>{staffRows.reduce((a,r)=>a+r.totalHours,0)}h</td>
              <td style={{...TD,textAlign:"center",color:C.red}}>{totalOT>0?`${totalOT}h`:"－"}</td>
              <td style={{...TD,textAlign:"right",color:C.blue,fontSize:15}}>{yen(totalPay)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div style={GC}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <h3 style={{margin:0,fontSize:14}}>🏛️ 会場別請求</h3>
        <button style={{...Btn(C.navy),fontSize:12,padding:"6px 12px"}} onClick={dlVenueCSV}>📥 請求CSV</button>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{background:"#f8f9fb"}}>
            <th style={TH}>会場</th><th style={TH}>日数</th><th style={TH}>時間</th>
            <th style={TH}>小計(税抜)</th><th style={TH}>消費税</th><th style={{...TH,color:C.purple}}>請求額</th>
          </tr></thead>
          <tbody>
            {venueRows.map(r=>(
              <tr key={r.name}>
                <td style={{...TD,fontWeight:700}}>{r.name}</td>
                <td style={{...TD,textAlign:"center"}}>{r.days}日</td>
                <td style={{...TD,textAlign:"center"}}>{r.hours}h</td>
                <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(r.sub)}</td>
                <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(r.tax)}</td>
                <td style={{...TD,textAlign:"right",fontWeight:800,color:C.purple}}>{yen(r.total)}</td>
              </tr>
            ))}
            <tr style={{background:"#f8f9fb",fontWeight:700}}>
              <td style={TD}>合計</td>
              <td style={{...TD,textAlign:"center"}}>{venueRows.reduce((a,r)=>a+r.days,0)}日</td>
              <td style={{...TD,textAlign:"center"}}>{venueRows.reduce((a,r)=>a+r.hours,0)}h</td>
              <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(venueRows.reduce((a,r)=>a+r.sub,0))}</td>
              <td style={{...TD,textAlign:"right",color:C.muted}}>{yen(venueRows.reduce((a,r)=>a+r.tax,0))}</td>
              <td style={{...TD,textAlign:"right",color:C.purple,fontSize:15}}>{yen(totalBill)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div style={{...GC,textAlign:"center"}}>
      <button style={{...Btn(C.muted),fontSize:13,padding:"10px 20px"}} onClick={dlDetailCSV}>📥 出勤詳細CSV（freee用）</button>
    </div>
  </div>;
}

// ─── OFFICE VIEW ──────────────────────────────────────────────
function OfficeView(P){
  const [tab,setTab]=useState("calc");
  const tabs=[
    {id:"calc",    label:"💴 コンシェル"},
    {id:"attend",  label:"📋 出勤一覧"},
    {id:"mc",      label:"🎤 司会・記録"},
    {id:"study",   label:"📚 勉強会"},
    {id:"shift",   label:"📅 シフト"},
  ];
  return <div>
    <div style={{...GC,background:`linear-gradient(135deg,${C.office},#0c4a6e)`,color:"#fff",padding:"16px 20px"}}>
      <div style={{fontSize:13,opacity:.8,marginBottom:2}}>事務ダッシュボード</div>
      <div style={{fontSize:18,fontWeight:800}}>{P.year}年{P.month}月　月次計算レポート</div>
    </div>
    <MonthSel {...P}/>
    <Tabs tabs={tabs} active={tab} onChange={setTab}/>
    {tab==="calc"   &&<AccountingView {...P}/>}
    {tab==="attend" &&<AttendanceSummaryView {...P}/>}
    {tab==="mc"     &&<MCAccountingView {...P}/>}
    {tab==="study"  &&<StudySessionView {...P}/>}
    {tab==="shift"  &&<PublicShift {...P} uname=""/>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// STAFF VIEW
// ═══════════════════════════════════════════════════════════════
