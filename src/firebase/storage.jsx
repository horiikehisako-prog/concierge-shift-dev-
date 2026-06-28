const stLoad=async k=>{try{const snap=await firebase.database().ref('/data/'+k).get();if(!snap.exists())return null;const val=snap.val();if(typeof val==="string"){try{return JSON.parse(val);}catch{return val;}}return val;}catch(e){return null;}};
const stSave=async(k,v)=>{await firebase.database().ref('/data/'+k).set(JSON.stringify(v));};
