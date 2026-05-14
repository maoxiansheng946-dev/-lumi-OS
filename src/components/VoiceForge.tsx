import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Phone, Loader2, Volume2, Trash2, Plus, Sparkles, CheckCircle2, History, Play, Pause, Cpu, Upload, FileAudio } from 'lucide-react';
import { useVoiceCloning } from '../hooks/useVoiceCloning';
import { deleteVoice } from '../services/voiceService';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';

export function VoiceForge({ t, compact, onCloneSuccess }: { t: any; compact?: boolean; onCloneSuccess?: () => void }) {
  const {
    isRecording,
    audioLevel,
    recordings,
    isUploading,
    isCloning,
    cloneProgress,
    voices,
    error,
    startRecording,
    stopRecording,
    removeRecording,
    addFiles,
    uploadAndClone,
    refreshVoices,
    clearError
  } = useVoiceCloning();

  const [voiceName, setVoiceName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    refreshVoices();
  }, [refreshVoices]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  // Audio Visualizer
  useEffect(() => {
    if (!isRecording || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = 40 + audioLevel * 40;

      // Draw rings
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + i * 20 * audioLevel, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 204, 0, ${0.3 - i * 0.1})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw bars
      const barCount = 64;
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2;
        const length = 20 + audioLevel * 60 * (0.5 + Math.random() * 0.5);
        const x1 = centerX + Math.cos(angle) * (radius - 5);
        const y1 = centerY + Math.sin(angle) * (radius - 5);
        const x2 = centerX + Math.cos(angle) * (radius + length);
        const y2 = centerY + Math.sin(angle) * (radius + length);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(255, 204, 0, ${0.5 + audioLevel * 0.5})`;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      animationFrame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrame);
  }, [isRecording, audioLevel]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      addFiles(files);
      toast.success(`Added ${files.length} file(s)`);
    }
    if (e.target) e.target.value = ''; // Reset so same file can be re-selected
  };

  const handleClone = async () => {
    if (!voiceName.trim()) {
      toast.error("Please enter a name for your voice essence.");
      return;
    }
    const result = await uploadAndClone(voiceName);
    if (result) {
      toast.success(t.voiceClonedSuccess || "Voice successfully cloned!");
      setVoiceName('');
      onCloneSuccess?.();
      refreshVoices();
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteVoice(id);
      toast.success(t.voiceDeletedSuccess || "Voice successfully deleted.");
      refreshVoices();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const clonedVoices = voices.filter(v => v.provider !== 'elevenlabs_premade' && v.provider !== 'azure_premade');
  const premadeVoices = voices.filter(v => v.provider === 'elevenlabs_premade' || v.provider === 'azure_premade');

  return (
    <div className="space-y-8 h-full flex flex-col">
      {!compact && (
        <div className="flex justify-between items-start">
          <div>
             <h3 className="text-3xl font-black italic uppercase tracking-tighter text-glow mb-2">{t.voiceForge || 'Voice Forge'}</h3>
             <p className="text-xs text-white/40 uppercase tracking-widest leading-relaxed max-w-lg">
               {t.voiceForgeDesc || 'Clone your digital essence or select from neural presets.'}
             </p>
          </div>
          <div className="flex items-center gap-3 p-4 bg-celestial-saturn/10 rounded-2xl border border-celestial-saturn/20 shadow-xl">
             <Sparkles className="text-celestial-saturn animate-pulse" size={20} />
             <div className="text-[10px] font-black uppercase tracking-widest text-celestial-saturn">Neural Synthesis Active</div>
          </div>
        </div>
      )}

      <div className={`${compact ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-8'} flex-1 overflow-hidden`}>
        {/* Recording & Cloning */}
        <div className={`space-y-6 overflow-y-auto ${compact ? '' : 'pr-4 custom-scrollbar'}`}>
           <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/5 space-y-8 relative overflow-hidden">
              <div className="text-center space-y-6 relative z-10">
                 <div className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20">{t.audioVisualizer || 'Neural Audio Visualizer'}</div>
                 
                 <div className="flex justify-center items-center h-48">
                    {!isRecording ? (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={startRecording}
                        className="w-32 h-32 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group hover:bg-celestial-saturn/20 hover:border-celestial-saturn/40 transition-all shadow-2xl relative"
                      >
                         <div className="absolute inset-0 rounded-full bg-celestial-saturn/10 animate-ping opacity-20" />
                         <Mic size={48} className="text-white/20 group-hover:text-celestial-saturn transition-colors" />
                      </motion.button>
                    ) : (
                      <canvas 
                        ref={canvasRef} 
                        width={300} 
                        height={300} 
                        className="w-48 h-48"
                      />
                    )}
                 </div>

                 <div className="flex flex-col items-center gap-4">
                    <Button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`h-14 px-10 rounded-full font-black uppercase tracking-widest text-xs transition-all ${
                        isRecording 
                          ? 'bg-celestial-mars text-white hover:bg-red-600 shadow-[0_0_30px_rgba(255,102,102,0.3)] animate-pulse' 
                          : 'bg-white text-black hover:bg-celestial-saturn shadow-xl'
                      }`}
                    >
                      {isRecording ? (
                        <div className="flex items-center gap-3">
                           <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                           {t.stopRecording || 'Stop Recording'}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                           <Mic size={16} />
                           {t.startRecording || 'Start Recording'}
                        </div>
                      )}
                    </Button>
                    <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest italic leading-relaxed">
                       {isRecording ? "Capturing synaptic vocal patterns..." : "Speak naturally for 15-30 seconds for optimal capture."}
                    </p>

                    {/* File upload alternative */}
                    <div className="flex items-center gap-2 pt-2">
                      <div className="flex-1 h-px bg-white/5" />
                      <span className="text-[8px] text-white/15 uppercase tracking-widest">or</span>
                      <div className="flex-1 h-px bg-white/5" />
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      className="h-10 px-6 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/50 hover:bg-white/10 hover:text-white transition-all"
                    >
                      <Upload size={14} className="mr-1" />
                      Upload Audio File
                    </Button>
                 </div>
              </div>
           </div>

           {recordings.length > 0 && (
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 space-y-6"
             >
                <div className="flex justify-between items-center">
                   <h4 className="text-xs font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                     <History size={14} />
                     {t.recordings || 'Recordings'} ({recordings.length})
                   </h4>
                   <button onClick={() => recordings.forEach((_, i) => removeRecording(i))} className="text-[9px] font-bold text-red-400 uppercase tracking-widest hover:underline transition-all">Clear All</button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                   {recordings.map((recording, i) => (
                     <div key={i} className="p-4 bg-white/5 rounded-2xl border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all">
                        <div className="flex items-center gap-4">
                           <div className="w-10 h-10 rounded-xl bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn">
                              <Volume2 size={18} />
                           </div>
                           <div>
                              <div className="text-[10px] font-black text-white/80 uppercase">Sample_0x{i.toString(16).toUpperCase()}</div>
                              <div className="text-[8px] text-white/20 uppercase font-black">{(recording.size / 1024 / 1024).toFixed(2)} MB • WebM Opus</div>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <button onClick={() => removeRecording(i)} className="p-2 text-white/20 hover:text-red-400 transition-colors">
                              <Trash2 size={16} />
                           </button>
                        </div>
                     </div>
                   ))}
                </div>

                <div className="pt-6 border-t border-white/5 space-y-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-white/30 ml-2">{t.voiceName || 'Voice Name'}</label>
                      <Input 
                        value={voiceName}
                        onChange={e => setVoiceName(e.target.value)}
                        placeholder="e.g. Master_Essence_v1"
                        className="bg-black/40 border-white/10 rounded-2xl h-12 focus-visible:ring-celestial-saturn/50"
                      />
                   </div>
                   <Button
                     onClick={handleClone}
                     disabled={isUploading || isCloning || !voiceName.trim()}
                     className="w-full h-14 bg-celestial-saturn text-black rounded-2xl font-black uppercase tracking-widest text-xs hover:scale-[1.02] active:scale-95 transition-all shadow-2xl disabled:opacity-50"
                   >
                     {isUploading || isCloning ? (
                        <div className="flex items-center gap-3">
                           <Loader2 size={18} className="animate-spin" />
                           {cloneProgress || (t.cloningInProgress || 'Cloning in progress...')}
                        </div>
                     ) : (
                        <div className="flex items-center gap-3">
                           <Sparkles size={18} />
                           {t.cloneVoice || 'Clone Voice'}
                        </div>
                     )}
                   </Button>
                </div>
             </motion.div>
           )}
        </div>

        {/* Right Side: Voice Inventory — hidden in compact mode */}
        {!compact && <div className="overflow-y-auto pr-4 custom-scrollbar">
           <div className="space-y-8 pb-12">
              <section className="space-y-4">
                 <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-[0.3em] text-white/40 italic">{t.clonedVoices || 'Cloned Voices'}</h4>
                    <span className="text-[10px] font-mono text-celestial-saturn/40">{clonedVoices.length} / 10 limit</span>
                 </div>
                 
                 <div className="grid grid-cols-1 gap-4">
                    {clonedVoices.length > 0 ? clonedVoices.map((v, i) => (
                      <VoiceCard 
                        key={v.voiceId} 
                        voice={v} 
                        onDelete={() => handleDelete(v.voiceId)}
                        isCloned
                      />
                    )) : (
                      <div className="p-12 bg-white/5 rounded-[2.5rem] border border-white/5 border-dashed flex flex-col items-center justify-center text-center space-y-4">
                         <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-white/10">
                            <MicOff size={32} />
                         </div>
                         <p className="text-[10px] font-black uppercase tracking-widest text-white/20 italic">
                            {t.noRecordings || 'No recordings found. Speak to create one.'}
                         </p>
                      </div>
                    )}
                 </div>
              </section>

              <section className="space-y-4">
                 <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-[0.3em] text-white/40 italic">{t.premadeVoices || 'Premade Voices'}</h4>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {premadeVoices.map((v) => (
                      <VoiceCard key={v.voiceId} voice={v} />
                    ))}
                 </div>
              </section>
           </div>
        </div>
        }
      </div>
    </div>
  );
}

function VoiceCard({ voice, onDelete, isCloned = false }: { voice: any, onDelete?: () => void, isCloned?: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const handlePlay = async () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: voice.voiceId || voice.id, text: '你好，这是我的声音样本。Hello, this is my voice sample.' }),
      });
      if (!res.ok) throw new Error('Synthesis failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setIsPlaying(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setIsPlaying(false); URL.revokeObjectURL(url); toast.error('Playback failed'); };
      await audio.play();
      setIsPlaying(true);
    } catch {
      toast.error('Failed to play voice sample');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      className="p-6 bg-white/5 rounded-3xl border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all group relative overflow-hidden"
    >
       <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-4">
             <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 ${
               isCloned ? 'bg-gradient-to-br from-celestial-saturn to-celestial-mars text-black' : 'bg-white/10 text-white/60'
             }`}>
                {isCloned ? <Sparkles size={24} /> : <Cpu size={24} />}
             </div>
             <div>
                <div className="text-sm font-black text-white tracking-tight">{voice.name}</div>
                <div className="flex items-center gap-2 mt-1">
                   {isCloned && <CheckCircle2 size={10} className="text-celestial-saturn" />}
                   <div className="text-[8px] font-black uppercase tracking-widest text-white/30">{voice.provider}</div>
                </div>
             </div>
          </div>

          <div className="flex items-center gap-2">
             <button
               onClick={handlePlay}
               disabled={isLoading}
               className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-50"
             >
                {isLoading ? <Loader2 size={18} className="animate-spin" /> : isPlaying ? <Pause size={18} /> : <Play size={18} />}
             </button>
             {isCloned && onDelete && (
               <button 
                 onClick={onDelete}
                 className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500 transition-all opacity-0 group-hover:opacity-100"
               >
                  <Trash2 size={18} />
               </button>
             )}
          </div>
       </div>

       {isCloned && (
         <div className="absolute top-0 right-0 p-4">
            <div className="w-1 h-1 rounded-full bg-celestial-saturn animate-ping" />
         </div>
       )}
    </motion.div>
  );
}
