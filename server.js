import express from "express";
import cors from "cors";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

if (!ffmpegPath) throw new Error("FFmpeg binary not found.");

const app = express();
const PORT = process.env.PORT || 10000;
const ORIGINS = (process.env.ALLOWED_ORIGIN || "https://sallymiia72-prog.github.io")
  .split(",").map(v => v.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin || ORIGINS.includes("*") || ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin not allowed: ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  exposedHeaders: ["Content-Disposition", "Content-Type", "Content-Length"]
}));
app.options("*", cors());
app.use(express.json({ limit: "32kb" }));

const jobs = new Map();
let activeJobId = null;

const COLORS = {
  1:["#ff163f","#ff9aae","#740018"],2:["#ff7200","#ffbd70","#842800"],
  3:["#ffd600","#fff292","#8b6400"],4:["#79e600","#c4ff7d","#337600"],
  5:["#008b45","#5de69a","#003c20"],6:["#00d5ca","#86fff6","#00615c"],
  7:["#25b8ff","#a5e5ff","#07578e"],8:["#1759ff","#98b5ff","#071e7a"],
  9:["#7d28ff","#c9a1ff","#35106c"],10:["#b35aff","#e0b6ff","#581b80"],
  11:["#ff4c9b","#ffafd2","#7a1647"],12:["#ef00cf","#ff93ec","#70005e"]
};
const FREQ = {
  1:261.63,2:293.66,3:329.63,4:349.23,5:392,6:440,
  7:493.88,8:523.25,9:587.33,10:659.25,11:698.46,12:783.99
};

function fold12(value) {
  let n = Math.abs(Number(value)) || 0;
  while (n > 12) n = String(n).split("").reduce((s,d)=>s+Number(d),0);
  return n === 0 ? 12 : n;
}

function calculate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) throw new Error("Invalid birthDate");
  const [year,month,day] = dateString.split("-").map(Number);
  const P = {};
  P[1]=fold12(day); P[2]=fold12(month); P[3]=fold12(year);
  P[4]=fold12(P[1]+P[2]); P[5]=fold12(P[1]+P[3]); P[6]=fold12(P[2]+P[3]);
  P[7]=fold12(P[4]+P[5]); P[8]=fold12(P[4]+P[6]); P[9]=fold12(P[5]+P[6]);
  P[10]=fold12(P[7]+P[8]); P[11]=fold12(P[7]+P[9]); P[12]=fold12(P[8]+P[9]);
  return P;
}

function backgroundSvg(w,h) {
  let stars="", rays="";
  for(let i=0;i<96;i++){
    const a=i*2.399963, d=((i*47)%100)/100*Math.max(w,h)*.64;
    const x=w/2+Math.cos(a)*d, y=h/2+Math.sin(a)*d;
    stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${.7+(i%3)*.4}" fill="#e7f4ff" opacity="${.2+(i%5)*.1}"/>`;
  }
  for(let i=0;i<36;i++){
    const a=i*Math.PI*2/36;
    const x1=w/2+Math.cos(a)*110, y1=h/2+Math.sin(a)*110;
    const x2=w/2+Math.cos(a)*Math.max(w,h), y2=h/2+Math.sin(a)*Math.max(w,h);
    rays += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e5b85c" stroke-width="${i%3===0?5:2}" opacity="${i%3===0?.19:.09}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><radialGradient id="bg"><stop stop-color="#16489d"/><stop offset=".42" stop-color="#0b2b70"/><stop offset="1" stop-color="#020617"/></radialGradient>
  <filter id="g"><feGaussianBlur stdDeviation="3"/></filter></defs>
  <rect width="100%" height="100%" fill="url(#bg)"/><g filter="url(#g)">${rays}</g>${stars}</svg>`;
}

function triangles(radius){
  const t=Math.tan(Math.PI/12);
  const r1=radius*.27,r2=radius*.55,r3=radius*.8,r4=radius;
  const w1=r1*t,w2=r2*t,w3=r3*t,w4=r4*t;
  const O=[0,0],A=[-w1,r1],B=[w1,r1],C=[-w2,r2],D=[0,r2],E=[w2,r2],
        F=[-w3,r3],G=[-w3/3,r3],H=[w3/3,r3],I=[w3,r3],J=[-w4,r4],K=[0,r4],L=[w4,r4];
  return [[1,[O,A,B]],[2,[A,B,D]],[3,[A,D,C]],[5,[B,E,D]],[4,[C,D,G]],[7,[C,G,F]],
          [9,[D,H,G]],[6,[D,E,H]],[11,[E,I,H]],[8,[F,G,J]],[10,[G,H,K]],[12,[H,I,L]]];
}

function mandalaSvg(P,size) {
  const c=size/2,r=size*.44,ts=triangles(r);
  let defs="",body="";
  for(let e=1;e<=12;e++){
    const [base,light,dark]=COLORS[e];
    defs += `<radialGradient id="e${e}" cx="30%" cy="20%"><stop stop-color="${light}"/><stop offset=".48" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`;
  }
  for(let s=0;s<12;s++){
    body += `<g transform="translate(${c} ${c}) rotate(${s*30})">`;
    for(const [p,pts] of ts){
      const points=pts.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      body += `<polygon points="${points}" fill="url(#e${P[p]})" stroke="${COLORS[P[p]][1]}" stroke-opacity=".82" stroke-width="1"/>`;
    }
    body += `</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>${defs}<radialGradient id="core"><stop stop-color="#fff"/><stop offset=".2" stop-color="#fff4a8"/><stop offset=".55" stop-color="#b7ff22" stop-opacity=".8"/><stop offset="1" stop-color="#b7ff22" stop-opacity="0"/></radialGradient></defs>
  ${body}<circle cx="${c}" cy="${c}" r="${size*.1}" fill="url(#core)"/></svg>`;
}

async function writeWav(P,seconds,filePath){
  const rate=22050,channels=1,count=rate*seconds;
  const data=Buffer.alloc(count*2);
  const order=[1,2,3,4,5,6,7,8,9,10,11,12];
  for(let i=0;i<count;i++){
    const time=i/rate;
    const energy=P[order[Math.floor(time/1.25)%12]];
    const f=FREQ[energy],local=time%1.25;
    const env=Math.min(1,local/.08)*Math.min(1,(1.25-local)/.3);
    const value=(Math.sin(2*Math.PI*f*time)*.48+Math.sin(2*Math.PI*(f/2)*time)*.16+
      Math.sin(2*Math.PI*(FREQ[P[5]]/4)*time)*.08)*env;
    data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),i*2);
  }
  const h=Buffer.alloc(44);
  h.write("RIFF",0);h.writeUInt32LE(36+data.length,4);h.write("WAVE",8);h.write("fmt ",12);
  h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);
  h.writeUInt32LE(rate*channels*2,28);h.writeUInt16LE(channels*2,32);h.writeUInt16LE(16,34);
  h.write("data",36);h.writeUInt32LE(data.length,40);
  await fs.writeFile(filePath,Buffer.concat([h,data]));
}

function runFfmpeg(args){
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpegPath,args,{stdio:["ignore","ignore","pipe"]});
    let stderr="";
    child.stderr.on("data",d=>stderr+=d.toString());
    child.on("error",reject);
    child.on("close",code=>code===0?resolve():reject(new Error(stderr.slice(-5000))));
  });
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error || null,
    createdAt: job.createdAt,
    ready: job.status === "ready"
  };
}

async function renderJob(job) {
  activeJobId = job.id;
  const P = calculate(job.birthDate);
  const dir = path.join(os.tmpdir(),`mandala-${job.id}`);
  job.dir = dir;
  await fs.mkdir(dir,{recursive:true});
  try {
    job.status="running"; job.stage="Фон"; job.progress=10;
    const bg=path.join(dir,"bg.png"), mandala=path.join(dir,"mandala.png"),
          wav=path.join(dir,"audio.wav"), out=path.join(dir,"out.mp4");
    await sharp(Buffer.from(backgroundSvg(480,600))).png({compressionLevel:9}).toFile(bg);

    job.stage="Мандала"; job.progress=25;
    await sharp(Buffer.from(mandalaSvg(P,460))).png({compressionLevel:9}).toFile(mandala);

    job.stage="Музыка"; job.progress=40;
    await writeWav(P,60,wav);

    job.stage="Кодирование MP4"; job.progress=55;
    const filter=[
      "[1:v]format=rgba,rotate=0.34*t:c=none:ow=rotw(iw):oh=roth(ih),scale=450:450[rot]",
      "[0:v][rot]overlay=(W-w)/2:(H-h)/2:shortest=1[v]"
    ].join(";");
    await runFfmpeg([
      "-y","-loop","1","-framerate","15","-i",bg,
      "-loop","1","-framerate","15","-i",mandala,
      "-i",wav,"-filter_complex",filter,"-map","[v]","-map","2:a:0","-t","60",
      "-c:v","libx264","-preset","ultrafast","-tune","stillimage","-crf","30",
      "-pix_fmt","yuv420p","-r","15","-g","30",
      "-c:a","aac","-b:a","72k","-ar","22050","-ac","1","-movflags","+faststart",out
    ]);

    job.outputPath=out; job.status="ready"; job.stage="Готово"; job.progress=100;
    job.expiresAt=Date.now()+30*60*1000;
  } catch (error) {
    console.error(`[${job.id}]`,error);
    job.status="error"; job.stage="Ошибка"; job.error=String(error?.message||error); job.progress=0;
    await fs.rm(dir,{recursive:true,force:true});
  } finally {
    activeJobId=null;
  }
}

setInterval(async()=>{
  const now=Date.now();
  for(const [id,job] of jobs){
    if(job.expiresAt && job.expiresAt<now){
      if(job.dir) await fs.rm(job.dir,{recursive:true,force:true});
      jobs.delete(id);
    }
  }
},60000).unref();

app.get("/",(_req,res)=>res.json({service:"Soul Mandala Job Renderer",status:"ok",mode:"async-light"}));
app.get("/health",(_req,res)=>res.json({ok:true,mode:"async-light",busy:Boolean(activeJobId)}));

app.post("/jobs",(req,res)=>{
  const birthDate=req.body?.birthDate;
  try { calculate(birthDate); } catch { return res.status(400).json({error:"Неверная дата рождения."}); }

  if(activeJobId){
    return res.status(429).json({error:"Сервер уже создаёт другое видео. Повтори через несколько минут."});
  }

  const id=crypto.randomUUID();
  const job={id,birthDate,status:"queued",stage:"В очереди",progress:0,error:null,createdAt:Date.now()};
  jobs.set(id,job);
  res.status(202).json(publicJob(job));
  setImmediate(()=>renderJob(job));
});

app.get("/jobs/:id",(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job) return res.status(404).json({error:"Задание не найдено или срок хранения истёк."});
  res.json(publicJob(job));
});

app.get("/jobs/:id/download",(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job) return res.status(404).json({error:"Задание не найдено."});
  if(job.status!=="ready" || !job.outputPath) return res.status(409).json({error:"Видео ещё не готово."});
  const safe=job.birthDate.split("-").reverse().join("-");
  res.download(job.outputPath,`Soul_Mandala_${safe}_60s.mp4`,async err=>{
    if(err) console.error("download",err);
  });
});

app.use((error,_req,res,_next)=>{
  console.error("GLOBAL",error);
  res.status(500).json({error:"Ошибка сервера.",details:String(error?.message||error)});
});

app.listen(PORT,()=>console.log(`ASYNC LIGHT renderer listening on ${PORT}`));
