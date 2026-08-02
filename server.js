
import express from "express";
import cors from "cors";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 10000;
const ORIGINS = (process.env.ALLOWED_ORIGIN || "https://sallymiia72-prog.github.io")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || ORIGINS.includes("*") || ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Origin is not allowed"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"]
}));
app.use(express.json({ limit: "32kb" }));

const PALETTE = {
  1:["#ff163f","#ff9aae","#740018"],2:["#ff7200","#ffbd70","#842800"],
  3:["#ffd600","#fff292","#8b6400"],4:["#79e600","#c4ff7d","#337600"],
  5:["#008b45","#5de69a","#003c20"],6:["#00d5ca","#86fff6","#00615c"],
  7:["#25b8ff","#a5e5ff","#07578e"],8:["#1759ff","#98b5ff","#071e7a"],
  9:["#7d28ff","#c9a1ff","#35106c"],10:["#b35aff","#e0b6ff","#581b80"],
  11:["#ff4c9b","#ffafd2","#7a1647"],12:["#ef00cf","#ff93ec","#70005e"]
};
const FREQ = {1:261.63,2:293.66,3:329.63,4:349.23,5:392,6:440,7:493.88,8:523.25,9:587.33,10:659.25,11:698.46,12:783.99};

function fold12(value){
  let n = Math.abs(Number(value)) || 0;
  while(n > 12) n = String(n).split("").reduce((s,d)=>s+Number(d),0);
  return n === 0 ? 12 : n;
}

function profile(dateString){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) throw new Error("Invalid birthDate");
  const [year, month, day] = dateString.split("-").map(Number);
  const P = {};
  P[1]=fold12(day); P[2]=fold12(month); P[3]=fold12(year);
  P[4]=fold12(P[1]+P[2]); P[5]=fold12(P[1]+P[3]); P[6]=fold12(P[2]+P[3]);
  P[7]=fold12(P[4]+P[5]); P[8]=fold12(P[4]+P[6]); P[9]=fold12(P[5]+P[6]);
  P[10]=fold12(P[7]+P[8]); P[11]=fold12(P[7]+P[9]); P[12]=fold12(P[8]+P[9]);
  return P;
}

function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[m]));}

function backgroundSvg(w,h){
  let stars = "";
  for(let i=0;i<220;i++){
    const a=i*2.399963, d=((i*61)%100)/100*Math.max(w,h)*.65;
    const x=w/2+Math.cos(a)*d, y=h*.5+Math.sin(a)*d;
    const r=.6+(i%5)*.35;
    stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#dff2ff" opacity="${(.18+(i%7)*.08).toFixed(2)}"/>`;
  }
  let rays="";
  for(let i=0;i<48;i++){
    const a=i*Math.PI*2/48;
    const x1=w/2+Math.cos(a)*170, y1=h*.5+Math.sin(a)*170;
    const x2=w/2+Math.cos(a)*Math.max(w,h), y2=h*.5+Math.sin(a)*Math.max(w,h);
    rays += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#goldRay)" stroke-width="${i%4===0?8:4}" opacity="${i%4===0?.25:.13}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="bg"><stop stop-color="#15449d"/><stop offset=".32" stop-color="#0b2d78"/><stop offset=".72" stop-color="#06163f"/><stop offset="1" stop-color="#020617"/></radialGradient>
    <linearGradient id="goldRay"><stop stop-color="#fff1b3" stop-opacity="0"/><stop offset=".45" stop-color="#ffd56d"/><stop offset="1" stop-color="#ff9b18" stop-opacity="0"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <g filter="url(#glow)">${rays}</g>
  ${stars}
  </svg>`;
}

function sectorTriangles(radius){
  const t=Math.tan(Math.PI/12);
  const r1=radius*.27,r2=radius*.55,r3=radius*.80,r4=radius;
  const w1=r1*t,w2=r2*t,w3=r3*t,w4=r4*t;
  const O=[0,0],A=[-w1,r1],B=[w1,r1],C=[-w2,r2],D=[0,r2],E=[w2,r2],
        F=[-w3,r3],G=[-w3/3,r3],H=[w3/3,r3],I=[w3,r3],J=[-w4,r4],K=[0,r4],L=[w4,r4];
  return [
    [1,[O,A,B]],[2,[A,B,D]],[3,[A,D,C]],[5,[B,E,D]],[4,[C,D,G]],[7,[C,G,F]],
    [9,[D,H,G]],[6,[D,E,H]],[11,[E,I,H]],[8,[F,G,J]],[10,[G,H,K]],[12,[H,I,L]]
  ];
}

function mandalaSvg(P,size){
  const c=size/2, r=size*.44;
  const tris=sectorTriangles(r);
  let defs="", body="";
  for(let e=1;e<=12;e++){
    const [base,light,dark]=PALETTE[e];
    defs += `<radialGradient id="e${e}" cx="30%" cy="20%"><stop stop-color="#fff" stop-opacity=".62"/><stop offset=".13" stop-color="${light}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`;
  }
  for(let s=0;s<12;s++){
    body += `<g transform="translate(${c} ${c}) rotate(${s*30})">`;
    for(const [p,pts] of tris){
      const points=pts.map(([x,y])=>`${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      body += `<polygon points="${points}" fill="url(#e${P[p]})" stroke="${PALETTE[P[p]][1]}" stroke-opacity=".86" stroke-width="1.4"/>`;
    }
    body += `</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>${defs}<filter id="g"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="core"><stop stop-color="#fff"/><stop offset=".16" stop-color="#fff4a8"/><stop offset=".48" stop-color="#b7ff22" stop-opacity=".85"/><stop offset="1" stop-color="#b7ff22" stop-opacity="0"/></radialGradient></defs>
  <g filter="url(#g)">${body}</g>
  <circle cx="${c}" cy="${c}" r="${size*.10}" fill="url(#core)"/>
  </svg>`;
}

function writeWav(P, seconds, filePath){
  const sampleRate=48000, channels=2, samples=sampleRate*seconds;
  const data=Buffer.alloc(samples*channels*2);
  const order=[1,2,3,4,5,6,7,8,9,10,11,12];
  for(let i=0;i<samples;i++){
    const t=i/sampleRate;
    const step=Math.floor(t/1.25)%12;
    const e=P[order[step]];
    const f=FREQ[e];
    const local=t%1.25;
    const env=Math.min(1,local/.08)*Math.min(1,(1.25-local)/.32);
    const base=Math.sin(2*Math.PI*f*t)*.42;
    const harmonic=Math.sin(2*Math.PI*f*2*t)*.11;
    const low=Math.sin(2*Math.PI*(f/2)*t)*.16;
    const pad=Math.sin(2*Math.PI*(FREQ[P[5]]/4)*t)*.09;
    const value=Math.max(-1,Math.min(1,(base+harmonic+low+pad)*env));
    const s=Math.round(value*32767);
    data.writeInt16LE(s,i*4);
    data.writeInt16LE(s,i*4+2);
  }
  const header=Buffer.alloc(44);
  header.write("RIFF",0); header.writeUInt32LE(36+data.length,4); header.write("WAVE",8);
  header.write("fmt ",12); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20);
  header.writeUInt16LE(channels,22); header.writeUInt32LE(sampleRate,24);
  header.writeUInt32LE(sampleRate*channels*2,28); header.writeUInt16LE(channels*2,32);
  header.writeUInt16LE(16,34); header.write("data",36); header.writeUInt32LE(data.length,40);
  return fs.writeFile(filePath,Buffer.concat([header,data]));
}

function runFfmpeg(args){
  return new Promise((resolve,reject)=>{
    const p=spawn(ffmpegPath,args,{stdio:["ignore","pipe","pipe"]});
    let err="";
    p.stderr.on("data",d=>err+=d.toString());
    p.on("error",reject);
    p.on("close",code=>code===0?resolve():reject(new Error(err.slice(-4000))));
  });
}

app.get("/",(_req,res)=>res.json({service:"Soul Mandala server renderer",status:"ok"}));
app.get("/health",(_req,res)=>res.json({ok:true}));

app.post("/render",async(req,res)=>{
  const birthDate=req.body?.birthDate;
  const duration=Math.max(10,Math.min(60,Number(req.body?.duration)||60));
  const width=720, height=900, fps=24;
  const id=crypto.randomUUID();
  const dir=path.join(os.tmpdir(),id);

  try{
    const P=profile(birthDate);
    await fs.mkdir(dir,{recursive:true});
    const bg=path.join(dir,"background.png");
    const mandala=path.join(dir,"mandala.png");
    const audio=path.join(dir,"audio.wav");
    const out=path.join(dir,"Soul_Mandala.mp4");

    await sharp(Buffer.from(backgroundSvg(width,height))).png().toFile(bg);
    await sharp(Buffer.from(mandalaSvg(P,720))).png().toFile(mandala);
    await writeWav(P,duration,audio);

    // Rotate transparent mandala over static background; encode H.264/AAC.
    const filter=[
      `[1:v]format=rgba,rotate=0.34*t:c=none:ow=rotw(iw):oh=roth(ih),scale=680:680[rot]`,
      `[0:v][rot]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`
    ].join(";");

    await runFfmpeg([
      "-y",
      "-loop","1","-framerate",String(fps),"-i",bg,
      "-loop","1","-framerate",String(fps),"-i",mandala,
      "-i",audio,
      "-filter_complex",filter,
      "-map","[v]","-map","2:a:0",
      "-t",String(duration),
      "-c:v","libx264","-preset","veryfast","-crf","22",
      "-pix_fmt","yuv420p","-profile:v","high","-level","4.0",
      "-c:a","aac","-b:a","160k","-ar","48000","-ac","2",
      "-movflags","+faststart",
      out
    ]);

    const stat=await fs.stat(out);
    const safe=birthDate.split("-").reverse().join("-");
    res.setHeader("Content-Type","video/mp4");
    res.setHeader("Content-Disposition",`attachment; filename="Soul_Mandala_${safe}_60s.mp4"`);
    res.setHeader("Content-Length",String(stat.size));
    res.sendFile(out,async()=>{
      await fs.rm(dir,{recursive:true,force:true});
    });
  }catch(error){
    console.error(error);
    await fs.rm(dir,{recursive:true,force:true});
    res.status(500).json({error:"Не удалось создать MP4.",details:String(error.message||error)});
  }
});

app.listen(PORT,()=>console.log(`Server renderer listening on ${PORT}`));
