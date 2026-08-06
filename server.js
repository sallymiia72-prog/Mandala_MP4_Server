import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
if(!ffmpegPath)throw new Error("FFmpeg binary not found.");
const app=express();const PORT=process.env.PORT||10000;
const origins=(process.env.ALLOWED_ORIGIN||"https://sallymiia72-prog.github.io").split(",").map(v=>v.trim()).filter(Boolean);
app.use(cors({origin(origin,cb){if(!origin||origins.includes("*")||origins.includes(origin))return cb(null,true);cb(new Error(`Origin not allowed: ${origin}`));},methods:["GET","POST","OPTIONS"],allowedHeaders:["Content-Type","Accept"],exposedHeaders:["Content-Disposition","Content-Type","Content-Length"]}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:220*1024*1024,files:1}});
function runFfmpeg(args){return new Promise((resolve,reject)=>{const p=spawn(ffmpegPath,args,{stdio:["ignore","ignore","pipe"]});let err="";p.stderr.on("data",d=>{err+=d.toString();if(err.length>15000)err=err.slice(-15000)});p.on("error",reject);p.on("close",c=>c===0?resolve():reject(new Error(err||`FFmpeg code ${c}`)));});}
app.get("/",(_q,r)=>r.json({service:"Soul Mandala Universal MP4 Converter",status:"ok",output:"H.264 + AAC"}));
app.get("/health",(_q,r)=>r.json({ok:true,ffmpeg:Boolean(ffmpegPath)}));
app.post("/convert",upload.single("video"),async(req,res)=>{
 if(!req.file?.buffer?.length)return res.status(400).json({error:"Видео не получено."});
 const id=crypto.randomUUID(),dir=path.join(os.tmpdir(),`mandala-${id}`);
 const ext=req.file.mimetype?.includes("mp4")?"mp4":req.file.mimetype?.includes("quicktime")?"mov":"webm";
 const input=path.join(dir,`input.${ext}`),output=path.join(dir,"output.mp4");
 try{await fs.mkdir(dir,{recursive:true});await fs.writeFile(input,req.file.buffer);
  await runFfmpeg(["-y","-i",input,"-map","0:v:0","-map","0:a:0?","-c:v","libx264","-preset","veryfast","-crf","22","-pix_fmt","yuv420p","-profile:v","baseline","-level","3.1","-c:a","aac","-b:a","128k","-ar","44100","-ac","2","-movflags","+faststart","-max_muxing_queue_size","2048",output]);
  const data=await fs.readFile(output);if(!data.length)throw new Error("Empty MP4");
  res.setHeader("Content-Type","video/mp4");res.setHeader("Content-Disposition",'attachment; filename="Soul_Mandala.mp4"');res.setHeader("Content-Length",data.length);res.send(data);
 }catch(e){console.error(e);if(!res.headersSent)res.status(500).json({error:"Не удалось перекодировать видео в MP4.",details:String(e?.message||e).slice(-1200)});}
 finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
});
app.use((e,_q,r,_n)=>{console.error(e);if(e?.code==="LIMIT_FILE_SIZE")return r.status(413).json({error:"Видео слишком большое. Максимум 220 МБ."});r.status(500).json({error:"Ошибка сервера.",details:String(e?.message||e)});});
app.listen(PORT,()=>console.log(`Universal MP4 converter on ${PORT}`));
