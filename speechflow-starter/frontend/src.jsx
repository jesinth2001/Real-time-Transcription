import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Mic, Square, Save, Search, Trash2, Pencil, RefreshCw, AudioLines} from "lucide-react";
import "./style.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
function App(){
  const [items,setItems]=useState([]), [query,setQuery]=useState(""), [title,setTitle]=useState("Untitled transcription");
  const [text,setText]=useState(""), [lang,setLang]=useState("Auto-detect"), [status,setStatus]=useState("Ready");
  const [recording,setRecording]=useState(false), [editing,setEditing]=useState(null);
  const socket=useRef(null), audioCtx=useRef(null), source=useRef(null), processor=useRef(null), stream=useRef(null), pcmBuffer=useRef([]);
  async function load(){try{const r=await fetch(`${API}/api/transcripts?q=${encodeURIComponent(query)}`);setItems(await r.json())}catch{setStatus("Cannot reach API. Check backend URL.")}}
  useEffect(()=>{load()},[query]);
  async function start(){
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}});
      stream.current=media;
      const ctx=new AudioContext(); audioCtx.current=ctx;
      await ctx.audioWorklet?.addModule?.("/pcm-worklet.js").catch(()=>{});
      const ws=new WebSocket(API.replace(/^http/,"ws")+"/ws/transcribe"); socket.current=ws; ws.binaryType="arraybuffer";
      ws.onopen=()=>{
        const src=ctx.createMediaStreamSource(media); source.current=src;
        const proc=ctx.createScriptProcessor(4096,1,1); processor.current=proc;
        proc.onaudioprocess=e=>{
          const input=e.inputBuffer.getChannelData(0);
          // Downsample browser audio to 16kHz and encode PCM16 little-endian.
          const ratio=ctx.sampleRate/16000, length=Math.floor(input.length/ratio), out=new Int16Array(length);
          for(let i=0;i<length;i++){const sample=input[Math.floor(i*ratio)];out[i]=Math.max(-1,Math.min(1,sample))*32767}
          if(ws.readyState===WebSocket.OPEN) ws.send(out.buffer);
        };
        src.connect(proc); proc.connect(ctx.destination); setRecording(true);setStatus("Listening… speak naturally");
      };
      ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.type==="partial"){setText(d.text);setLang(d.language||"Auto-detect");setStatus("Live transcription")}else if(d.type==="error")setStatus("Transcription error: "+d.message)};
      ws.onerror=()=>setStatus("WebSocket connection error");
      ws.onclose=()=>{if(recording)setStatus("Connection closed")};
    }catch(e){setStatus("Microphone unavailable: "+e.message)}
  }
  function stop(){
    processor.current?.disconnect();source.current?.disconnect();stream.current?.getTracks().forEach(t=>t.stop());audioCtx.current?.close();
    if(socket.current?.readyState===WebSocket.OPEN){socket.current.send("STOP");socket.current.close()}
    setRecording(false);setStatus("Recording stopped. Review and save your text.");
  }
  async function save(){
    if(!text.trim())return setStatus("Record speech before saving.");
    const payload={title,text,language:lang==="Auto-detect"?null:lang};
    const url=editing?`${API}/api/transcripts/${editing}`:`${API}/api/transcripts`;
    const r=await fetch(url,{method:editing?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!r.ok)return setStatus("Save failed.");
    setText("");setTitle("Untitled transcription");setEditing(null);setStatus("Transcription saved.");load();
  }
  async function edit(item){setEditing(item.id);setTitle(item.title);setText(item.text);setLang(item.language||"Auto-detect");window.scrollTo({top:0,behavior:"smooth"})}
  async function remove(id){if(!confirm("Delete this transcription?"))return;await fetch(`${API}/api/transcripts/${id}`,{method:"DELETE"});load()}
  return <main>
    <header><div className="brand"><div className="logo"><AudioLines/></div><div><h1>SpeechFlow</h1><p>Real-time multilingual transcription</p></div></div><span className="pill"><i/> Local AI engine</span></header>
    <section className="hero"><div><p className="eyebrow">SPEECH INTELLIGENCE</p><h2>Your voice, <span>in text.</span></h2><p className="muted">Speak naturally in Hindi, English, or a mix of languages. Review, edit, and save every transcription.</p></div><div className="orb"><AudioLines size={42}/></div></section>
    <section className="workspace">
      <div className="panel compose"><div className="panel-head"><div><h3>Live transcription</h3><p>Speak clearly for best results</p></div><span className={recording?"live":"pill"}>{recording?"● Listening":"Ready"}</span></div>
        <label>TRANSCRIPTION TITLE</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Meeting notes, ideas…"/>
        <div className="text-area"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Your recognized speech will appear here. You can also edit the text before saving…"/><div className="text-foot"><span>{text.trim()?text.trim().split(/\s+/).length:0} words</span><span>{lang}</span></div></div>
        <div className="actions">{!recording?<button className="primary" onClick={start}><Mic size={17}/> Start speaking</button>:<button className="danger" onClick={stop}><Square size={15}/> Stop recording</button>}<button className="secondary" onClick={save}><Save size={16}/>{editing?"Update transcription":"Save transcription"}</button>{editing&&<button className="secondary" onClick={()=>{setEditing(null);setText("");setTitle("Untitled transcription")}}>Cancel edit</button>}</div><p className="status">{status}</p>
      </div>
      <div className="panel history"><div className="panel-head"><div><h3>Transcription history</h3><p>{items.length} saved record{items.length===1?"":"s"}</p></div><button className="icon-btn" onClick={load} title="Refresh"><RefreshCw size={16}/></button></div>
        <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search transcriptions…"/></div>
        <div className="records">{items.map(item=><article className="record" key={item.id}><div className="record-top"><h4>{item.title}</h4><span>{item.language||"Auto"}</span></div><p>{item.text}</p><div className="record-bottom"><time>{new Date(item.created_at+"Z").toLocaleString()}</time><div><button className="icon-btn" title="Edit" onClick={()=>edit(item)}><Pencil size={15}/></button><button className="icon-btn delete" title="Delete" onClick={()=>remove(item.id)}><Trash2 size={15}/></button></div></div></article>)}{items.length===0&&<div className="empty"><AudioLines size={28}/><p>No transcriptions yet</p><small>Start speaking to create your first record.</small></div>}</div>
      </div>
    </section>
    <footer>SpeechFlow · Self-hosted Whisper transcription · Built with FastAPI and React</footer>
  </main>
}
createRoot(document.getElementById("root")).render(<App/>);
