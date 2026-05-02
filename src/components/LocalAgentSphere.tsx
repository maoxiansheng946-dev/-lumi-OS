import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Sparkles, Volume2, Box, User as UserIcon } from 'lucide-react';
import { Button } from './ui/button';
import { sounds } from '../services/soundService';

export function LocalAgentSphere({ t, onMessage, sentiment = 'default' }: { t: any; onMessage?: (text: string) => void; sentiment?: 'default' | 'excited' | 'focused' | 'zen' }) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interactionPulse, setInteractionPulse] = useState(0);
  const [spatialMode, setSpatialMode] = useState<'geometric' | 'humanoid'>('geometric');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0, isDown: false });
  const rotationRef = useRef({ x: 0, y: 0 });

  const toggleListen = async () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    // Explicitly request microphone permission first to ensure the browser prompt appears
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert("无法访问麦克风。请确保已授予权限并在 HTTPS 环境下运行。");
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("您的浏览器不支持语音识别。建议使用 Chrome 或 Edge。");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      sounds.playNeural();
    };

    recognition.onresult = (event: any) => {
      const speechToText = event.results[0][0].transcript;
      setIsListening(false);
      setIsProcessing(true);
      
      // Simulate processing delay
      setTimeout(() => {
        setIsProcessing(false);
        if (onMessage) onMessage(speechToText);
      }, 1000);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        alert("语音识别被拒绝。请在浏览器地址栏检查麦克风权限设置。");
      } else if (event.error === 'no-speech') {
        // Silently handle no-speech to avoid annoying alerts
        console.warn("Speech recognition timed out: No speech detected.");
      } else if (event.error === 'audio-capture') {
        console.error("No microphone was found or microphone is busy.");
      } else {
        console.error('Speech recognition error:', event.error);
        // Only alert for non-trivial errors
        if (event.error !== 'aborted') {
          alert(`语音识别错误: ${event.error}`);
        }
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Recognition start error:', e);
      setIsListening(false);
    }
  };

  const handleSphereClick = () => {
    setInteractionPulse(prev => prev + 1);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const particles: Particle[] = [];
    const particleCount = spatialMode === 'geometric' ? 1200 : 1800;
    const sphereRadius = 180;

    class Particle {
      x: number;
      y: number;
      z: number;
      baseX: number;
      baseY: number;
      baseZ: number;
      color: string;
      size: number;

      constructor() {
        if (spatialMode === 'humanoid') {
          // Approximate a humanoid shape (head, torso, limbs)
          const rand = Math.random();
          if (rand < 0.2) { // Head
            const u = Math.random(); const v = Math.random();
            const theta = 2 * Math.PI * u; const phi = Math.acos(2 * v - 1);
            const r = Math.pow(Math.random(), 1/3) * 40;
            this.baseX = r * Math.sin(phi) * Math.cos(theta);
            this.baseY = r * Math.sin(phi) * Math.sin(theta) - 140;
            this.baseZ = r * Math.cos(phi);
          } else if (rand < 0.7) { // Torso
            this.baseX = (Math.random() - 0.5) * 80;
            this.baseY = (Math.random() - 0.5) * 120 - 40;
            this.baseZ = (Math.random() - 0.5) * 40;
          } else { // Limbs
            this.baseX = (Math.random() - 0.5) * 140;
            this.baseY = (Math.random() - 0.5) * 180 + 40;
            this.baseZ = (Math.random() - 0.5) * 20;
          }
        } else {
          // Distribute particles inside a sphere
          const u = Math.random();
          const v = Math.random();
          const theta = 2 * Math.PI * u;
          const phi = Math.acos(2 * v - 1);
          const r = Math.pow(Math.random(), 1/3) * sphereRadius;

          this.baseX = r * Math.sin(phi) * Math.cos(theta);
          this.baseY = r * Math.sin(phi) * Math.sin(theta);
          this.baseZ = r * Math.cos(phi);
        }
        
        this.x = this.baseX;
        this.y = this.baseY;
        this.z = this.baseZ;

        const rand = Math.random();
        if (rand < 0.4) this.color = '#ff4d4d'; // Red
        else if (rand < 0.8) this.color = '#ffffff'; // White
        else this.color = '#000000'; // Black
        
        this.size = Math.random() * 1.5 + 0.5;
      }

      update(time: number, rotX: number, rotY: number) {
        // Wave effect
        const wave = Math.sin(time * 0.002 + (this.baseX + this.baseY + this.baseZ) * 0.01) * 15;
        const rFactor = (sphereRadius + wave) / sphereRadius;
        
        let tx = this.baseX * rFactor;
        let ty = this.baseY * rFactor;
        let tz = this.baseZ * rFactor;

        // Rotation X
        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y1 = ty * cosX - tz * sinX;
        const z1 = ty * sinX + tz * cosX;
        ty = y1;
        tz = z1;

        // Rotation Y
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const x2 = tx * cosY + tz * sinY;
        const z2 = -tx * sinY + tz * cosY;
        tx = x2;
        tz = z2;

        this.x = tx;
        this.y = ty;
        this.z = tz;
      }

      draw(ctx: CanvasRenderingContext2D, centerX: number, centerY: number) {
        const perspective = 600 / (600 - this.z);
        const x = this.x * perspective + centerX;
        const y = this.y * perspective + centerY;
        const size = this.size * perspective;

        if (this.color === '#000000') {
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = this.color;
          ctx.globalAlpha = Math.max(0.1, perspective - 0.5);
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle());
    }

    const render = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Sentimental speed factors
      const speedFactor = sentiment === 'excited' ? 3 : sentiment === 'focused' ? 2 : sentiment === 'zen' ? 0.5 : 1;
      
      // Auto rotation + Mouse rotation
      if (!mouseRef.current.isDown) {
        rotationRef.current.y += 0.005 * speedFactor;
        rotationRef.current.x += 0.002 * speedFactor;
      }

      // Sort particles by Z for basic depth
      particles.sort((a, b) => a.z - b.z);

      particles.forEach(p => {
        // Pass speed factor to update for wave effect
        const wave = Math.sin(time * 0.002 * speedFactor + (p.baseX + p.baseY + p.baseZ) * 0.01) * 15 * (speedFactor > 1 ? 1.5 : 1);
        const rFactor = (sphereRadius + wave) / sphereRadius;
        
        let tx = p.baseX * rFactor;
        let ty = p.baseY * rFactor;
        let tz = p.baseZ * rFactor;

        // Rotation X
        const cosX = Math.cos(rotationRef.current.x);
        const sinX = Math.sin(rotationRef.current.x);
        const y1 = ty * cosX - tz * sinX;
        const z1 = ty * sinX + tz * cosX;
        ty = y1;
        tz = z1;

        // Rotation Y
        const cosY = Math.cos(rotationRef.current.y);
        const sinY = Math.sin(rotationRef.current.y);
        const x2 = tx * cosY + tz * sinY;
        const z2 = -tx * sinY + tz * cosY;
        tx = x2;
        tz = z2;

        p.x = tx;
        p.y = ty;
        p.z = tz;
        
        p.draw(ctx, centerX, centerY);
      });

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationFrameId);
  }, [spatialMode]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    mouseRef.current.isDown = true;
    const pos = 'touches' in e ? e.touches[0] : e;
    mouseRef.current.x = pos.clientX;
    mouseRef.current.y = pos.clientY;
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!mouseRef.current.isDown) return;
    const pos = 'touches' in e ? e.touches[0] : e;
    const dx = pos.clientX - mouseRef.current.x;
    const dy = pos.clientY - mouseRef.current.y;
    
    rotationRef.current.y += dx * 0.01;
    rotationRef.current.x -= dy * 0.01;
    
    mouseRef.current.x = pos.clientX;
    mouseRef.current.y = pos.clientY;
  };

  const handleMouseUp = () => {
    mouseRef.current.isDown = false;
  };

  return (
    <div className="relative w-full flex flex-col items-center justify-center py-20 overflow-hidden">
      {/* Background Glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-red-500/5 via-transparent to-transparent pointer-events-none" />
      
      {/* The Sphere Container - Particle Star Aesthetic */}
      <div 
        className="relative w-80 h-80 md:w-[500px] md:h-[500px] flex items-center justify-center cursor-grab active:cursor-grabbing group"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onClick={handleSphereClick}
      >
        {/* Glow Layers */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <motion.div 
            className="absolute w-64 h-64 md:w-96 md:h-96 rounded-full bg-red-500 blur-[80px] opacity-10"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 5, repeat: Infinity }}
          />
        </div>

        <canvas 
          ref={canvasRef}
          width={600}
          height={600}
          className="w-full h-full relative z-10"
        />
        
        {/* Interaction Pulse Rings */}
        <AnimatePresence>
          {[...Array(2)].map((_, i) => (
            <motion.div
              key={`${interactionPulse}-${i}`}
              className="absolute inset-0 rounded-full border border-red-500/20 pointer-events-none"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 1.5, delay: i * 0.3 }}
            />
          ))}
        </AnimatePresence>

        {/* Celestial Orbital Rings */}
        <motion.div
          className="absolute inset-[-40px] rounded-full border border-white/5 border-dashed pointer-events-none"
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Controls */}
      <div className="mt-12 flex flex-col items-center gap-6 z-10">
        <div className="flex items-center gap-4 p-1 bg-white/5 rounded-2xl border border-white/10">
          <button
            onClick={() => setSpatialMode('geometric')}
            className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
              spatialMode === 'geometric' ? 'bg-celestial-saturn text-black' : 'text-white/40 hover:text-white'
            }`}
          >
            <Box size={14} />
            {t.geometric || 'Geometric'}
          </button>
          <button
            onClick={() => setSpatialMode('humanoid')}
            className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
              spatialMode === 'humanoid' ? 'bg-celestial-saturn text-black' : 'text-white/40 hover:text-white'
            }`}
          >
            <UserIcon size={14} />
            {t.humanoid || 'Humanoid'}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <Button
            onClick={toggleListen}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 ${
              isListening 
                ? 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.5)] scale-110' 
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {isListening ? <Mic size={24} className="animate-pulse" /> : <MicOff size={24} />}
          </Button>
          
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-widest text-white/40">
              {isListening ? t.listening : isProcessing ? t.processing : t.voiceInteract}
            </span>
            <span className="text-sm font-medium text-white/80">
              {isListening ? "I'm listening to your request..." : "Click to start voice command"}
            </span>
          </div>
        </div>

        <AnimatePresence>
          {(isListening || isProcessing) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex gap-1"
            >
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-red-500 rounded-full"
                  animate={{
                    height: isListening ? [10, 30, 10] : [10, 15, 10],
                  }}
                  transition={{
                    duration: 0.5,
                    repeat: Infinity,
                    delay: i * 0.1,
                  }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
