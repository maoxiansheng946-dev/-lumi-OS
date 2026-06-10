import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brush, Sparkles, Cat, Bird, Disc3, Flame, Loader2, Check, ArrowRight, Wand2, RotateCcw, Download, Upload, Image, Shirt, Palette, Star, Heart, Rabbit, PawPrint } from 'lucide-react';
import { toast } from 'sonner';
import { getDefaultPets, generateCustomPet, recolorPet } from '../pets/defaults';
import { PetConfig, PetPalette, CustomPetTags, COLOR_PRESETS, BUILTIN_PALETTES } from '../pets/types';
import { SpriteAnimator, PetAvatar } from './SpriteAnimator';
import { ALL_ACCESSORIES, AccessoryDef, AccessoryCategory } from '../pets/accessories';

const BUILTIN_ANIMATIONS = ['idle', 'run', 'wave', 'jump', 'waiting'];

const PET_ICONS: Record<string, React.ReactNode> = {
  'lumi-cat': <Cat size={16} />,
  'lumi-blob': <Disc3 size={16} />,
  'lumi-bird': <Bird size={16} />,
  'lumi-dragon': <Flame size={16} />,
  'lumi-fox': <Star size={16} />,
  'lumi-rabbit': <Rabbit size={16} />,
  'lumi-bear': <PawPrint size={16} />,
  'lumi-hamster': <Heart size={16} />,
};

const PET_DESCS: Record<string, string> = {
  'lumi-cat': '温暖治愈的猫猫，会眨眼、摇尾巴、撒娇挥手。适合日常陪伴。',
  'lumi-blob': 'Q弹软萌的史莱姆，一蹦一跳、眼睛闪闪。活泼可爱风。',
  'lumi-bird': '圆滚滚的小鸟，扑腾翅膀、叽叽喳喳。轻快灵动风。',
  'lumi-dragon': '迷你小龙，有翅膀和小角。适合喜欢奇幻风格的用户。',
  'lumi-fox': '橙色小狐狸，三角大耳、蓬松尾巴带白尖。机灵俏皮。',
  'lumi-rabbit': '软萌小白兔，长耳朵垂下来、圆圆短尾巴。温柔治愈。',
  'lumi-bear': '棕色小熊，圆耳朵、厚实爪垫。憨态可掬，给人安全感。',
  'lumi-hamster': '圆圆小仓鼠，鼓鼓的腮帮子、迷你小耳朵。超萌可爱。',
};

const SPECIES_LABELS: Record<string, string> = {
  cat: '猫咪', blob: '史莱姆', bird: '小鸟', dragon: '小龙',
  fox: '狐狸', rabbit: '兔子', bear: '小熊', hamster: '仓鼠',
};

export function AvatarStudio({
  t,
  selectedPetId,
  onSelectPet,
  onResetToSphere,
  equippedAccessories,
  onChangeAccessories,
}: {
  t: any;
  selectedPetId?: string;
  onSelectPet: (pet: PetConfig) => void;
  onResetToSphere?: () => void;
  equippedAccessories?: string[];
  onChangeAccessories?: (ids: string[]) => void;
}) {
  const pets = getDefaultPets();
  const [customPets, setCustomPets] = useState<PetConfig[]>([]);
  const allPets = [...pets, ...customPets];
  const [activePet, setActivePet] = useState<PetConfig>(
    pets.find(p => p.id === selectedPetId) || pets[0],
  );
  const [previewAnim, setPreviewAnim] = useState('idle');
  const [animKey, setAnimKey] = useState(0);
  const [tab, setTab] = useState<'gallery' | 'generate' | 'wardrobe' | 'colors'>('gallery');
  const [genPrompt, setGenPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [aiMode, setAiMode] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Color editing state
  const [editPalette, setEditPalette] = useState<PetPalette>(activePet.palette || BUILTIN_PALETTES.cat);
  const [activeColorSlot, setActiveColorSlot] = useState<keyof PetPalette>('body');

  // Sync palette when activePet changes
  useEffect(() => {
    if (activePet.palette) setEditPalette(activePet.palette);
  }, [activePet.id]);

  const handleSelectPet = useCallback((pet: PetConfig) => {
    setActivePet(pet);
    onSelectPet(pet);
    toast.success(`${pet.name} 已设为桌面形象`);
    setAnimKey(k => k + 1);
  }, [onSelectPet]);

  const handleRecolor = useCallback((slot: keyof PetPalette, color: string) => {
    const newPalette = { ...editPalette, [slot]: color };
    setEditPalette(newPalette);
    const recolored = recolorPet(activePet, newPalette);
    setActivePet(recolored);
    onSelectPet(recolored);
    setAnimKey(k => k + 1);
  }, [editPalette, activePet, onSelectPet]);

  const handleGenerate = useCallback(async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/pets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: genPrompt.trim(), mode: aiMode ? 'ai_enhanced' : 'procedural' }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Generation failed');
      const result = await res.json();
      const newPet = generateCustomPet(result.petName, result.tags as CustomPetTags);
      setCustomPets(prev => [newPet, ...prev]);
      setActivePet(newPet);
      onSelectPet(newPet);
      setTab('gallery');
      setAnimKey(k => k + 1);
      toast.success(`${newPet.name} 已生成！`);
    } catch (err: any) {
      toast.error(err.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  }, [genPrompt, handleSelectPet, aiMode]);

  // Export pet as single .pet.json with embedded spritesheet (base64)
  const handleExport = useCallback((pet: PetConfig) => {
    try {
      const manifest = {
        id: pet.id,
        name: pet.name,
        author: pet.author,
        atlas: pet.atlas,
        spritesheet: pet.spritesheet,
        palette: pet.palette,
        tags: pet.tags,
        format: 'codex-pets-v2',
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `${pet.id}.pet.json`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${pet.name}`);
    } catch {
      toast.error('导出失败');
    }
  }, []);

  // Import — supports single .pet.json with embedded spritesheet
  const importRef = useRef<HTMLInputElement>(null);
  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const manifest = JSON.parse(reader.result as string);
        if (!manifest.id || !manifest.name || !manifest.atlas) throw new Error('Invalid');
        const importedPet: PetConfig = {
          id: manifest.id,
          name: manifest.name,
          author: manifest.author || 'Community',
          spritesheet: manifest.spritesheet || '',
          atlas: manifest.atlas,
          thumbnail: manifest.spritesheet || '',
          palette: manifest.palette,
          tags: manifest.tags,
        };
        if (!importedPet.spritesheet) throw new Error('Missing spritesheet');
        handleSelectPet(importedPet);
        toast.success(`已导入 ${importedPet.name}`);
      } catch {
        toast.error('无效的 .pet.json 文件（需含内嵌 spritesheet）');
      }
    };
    reader.readAsText(file);
  }, [handleSelectPet]);

  const handleImportClick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    if (importRef.current) importRef.current.value = '';
  }, [handleImportFile]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.json')) handleImportFile(file);
    else toast.error('请拖入 .pet.json 文件');
  }, [handleImportFile]);

  const colorSlots: { key: keyof PetPalette; label: string }[] = [
    { key: 'body', label: '身体' },
    { key: 'accent', label: '装饰' },
    { key: 'belly', label: '腹部' },
    { key: 'eye', label: '眼睛' },
  ];

  return (
    <div className="h-full flex flex-col bg-zinc-950/90" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Drag overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-cyan-500/10 border-2 border-dashed border-cyan-400/40 rounded-xl flex items-center justify-center backdrop-blur-sm"
          >
            <div className="text-center">
              <Upload size={48} className="text-cyan-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-cyan-400">释放以导入 .pet.json</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Brush size={18} className="text-cyan-400" />
          <div>
            <h2 className="text-sm font-black text-white/90 uppercase tracking-wider">形象设计室</h2>
            <p className="text-xs text-white/55 font-mono">Avatar Design Studio</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white/5 rounded-xl p-1">
          {([
            ['gallery', '形象画廊', 'text-cyan-400', 'bg-cyan-500/20'],
            ['generate', 'AI 定制', 'text-fuchsia-400', 'bg-fuchsia-500/20'],
            ['colors', '调色', 'text-amber-400', 'bg-amber-500/20'],
            ['wardrobe', '装扮', 'text-emerald-400', 'bg-emerald-500/20'],
          ] as const).map(([id, label, activeColor, activeBg]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                tab === id ? `${activeBg} ${activeColor}` : 'text-white/55 hover:text-white/50'
              }`}
            >
              {id === 'colors' ? <Palette size={12} className="inline mr-1" /> : null}
              {id === 'wardrobe' ? <Shirt size={12} className="inline mr-1" /> : null}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left: Gallery / Generate / Wardrobe / Colors Panel */}
        <div className="w-72 flex-shrink-0 border-r border-white/5 overflow-y-auto custom-scrollbar p-4">
          {tab === 'gallery' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-bold uppercase tracking-wider text-white/45">形象画廊</p>
                <span className="text-[12px] text-white/30 font-mono">{allPets.length} 款</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {allPets.map(pet => {
                  const isCustom = customPets.some(cp => cp.id === pet.id);
                  return (
                  <motion.button
                    key={pet.id}
                    whileHover={{ scale: 1.03 }}
                    onClick={() => { setActivePet(pet); setAnimKey(k => k + 1); }}
                    onMouseEnter={() => setHoveredId(pet.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`relative p-2 rounded-xl border transition-all text-left group ${
                      activePet.id === pet.id
                        ? 'bg-cyan-500/10 border-cyan-500/30 ring-1 ring-cyan-500/20'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    {/* Preview */}
                    <div className="w-full aspect-square rounded-lg bg-white/[0.03] flex items-center justify-center overflow-hidden mb-1.5">
                      <div className="scale-[0.30] origin-center">
                        <PetAvatar
                          pet={pet}
                          animation="idle"
                          scale={0.45}
                          accessoryIds={equippedAccessories}
                        />
                      </div>
                    </div>
                    {/* Info */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/40 scale-75">{PET_ICONS[pet.id] || <Sparkles size={14} />}</span>
                      <span className="text-[12px] font-bold text-white/60 truncate flex-1">{pet.name}</span>
                    </div>
                    <div className="text-[12px] text-white/35 mt-0.5 flex items-center gap-1.5">
                      {pet.author}
                      {isCustom && <span className="w-1 h-1 rounded-full bg-fuchsia-400 inline-block" />}
                    </div>
                    {activePet.id === pet.id && (
                      <Check size={12} className="absolute top-2 right-2 text-cyan-400" />
                    )}
                    {/* Export button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExport(pet); }}
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-black/40 border border-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                    >
                      <Download size={10} className="text-white/50" />
                    </button>
                  </motion.button>
                  );
                })}
              </div>
              {/* Import */}
              <input ref={importRef} type="file" accept=".json" onChange={handleImportClick} className="hidden" />
              <button
                onClick={() => importRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 border border-dashed border-white/10 rounded-xl text-xs font-bold text-white/45 hover:text-white/40 hover:border-white/20 transition-all mt-2"
              >
                <Upload size={12} />
                导入社区宠物（拖拽或点击）
              </button>
            </div>
          ) : tab === 'generate' ? (
            <div className="space-y-4">
              <p className="text-[12px] font-bold uppercase tracking-wider text-white/45">AI 形象生成</p>
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-2 bg-white/5 rounded-xl">
                  <button
                    onClick={() => setAiMode(true)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all ${aiMode ? 'bg-fuchsia-500/20 text-fuchsia-400' : 'text-white/45 hover:text-white/40'}`}
                  >
                    <Sparkles size={12} className="inline mr-1" /> AI 增强
                  </button>
                  <button
                    onClick={() => setAiMode(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all ${!aiMode ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/45 hover:text-white/40'}`}
                  >
                    <Wand2 size={12} className="inline mr-1" /> 程序生成
                  </button>
                </div>
                <textarea
                  value={genPrompt}
                  onChange={e => setGenPrompt(e.target.value)}
                  placeholder="描述你想要的桌面宠物，例如：一只橙色的小狐狸，有蓬松的大尾巴和白肚皮，可爱机灵..."
                  className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white/70 placeholder:text-white/40 focus:outline-none focus:border-fuchsia-500/20 resize-none"
                />
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleGenerate}
                  disabled={!genPrompt.trim() || generating}
                  className="w-full flex flex-col items-center gap-2 px-4 py-3 bg-fuchsia-500/15 border border-fuchsia-500/25 rounded-xl text-xs font-bold text-fuchsia-400 hover:bg-fuchsia-500/25 disabled:opacity-30 transition-all"
                >
                  {generating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin" />
                      AI 生成中...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2"><Sparkles size={14} /> 开始生成</span>
                  )}
                </motion.button>
                {generating && (
                  <div className="h-0.5 w-full bg-white/5 rounded-full overflow-hidden mt-1">
                    <motion.div
                      className="h-full bg-gradient-to-r from-fuchsia-400 to-pink-400"
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 12, ease: 'easeInOut' }}
                    />
                  </div>
                )}
              </div>
              <div className="p-3 bg-fuchsia-500/5 border border-fuchsia-500/10 rounded-xl text-[12px] text-fuchsia-300/50 leading-relaxed">
                <p><Sparkles size={10} className="inline mr-1" />AI 增强会理解你的描述，自动匹配物种、配色、花纹、眼睛形状等</p>
                <p className="mt-1 text-fuchsia-300/30">支持中英文描述 · 生成约需 15-30 秒</p>
              </div>
            </div>
          ) : tab === 'colors' ? (
            <ColorPanel palette={editPalette} activeSlot={activeColorSlot} onSelectSlot={setActiveColorSlot} onChangeColor={handleRecolor} />
          ) : (
            <WardrobePanel
              equipped={equippedAccessories || []}
              onChange={onChangeAccessories || (() => {})}
            />
          )}
        </div>

        {/* Right: Preview + Actions */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6">
          {/* Large Preview */}
          <div className="relative">
            <motion.div
              className="w-64 h-72 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex items-center justify-center overflow-hidden shadow-[0_0_80px_rgba(0,200,200,0.06)]"
              whileHover={{ borderColor: 'rgba(0,200,200,0.2)', boxShadow: '0 0 100px rgba(0,200,200,0.1)' }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activePet.id}-${animKey}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.2 }}
                >
                  <PetAvatar pet={activePet} animation={previewAnim} scale={1.1} accessoryIds={equippedAccessories} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
            {/* Species badge */}
            {activePet.tags?.species && (
              <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-[12px] text-cyan-400 font-bold">
                {SPECIES_LABELS[activePet.tags.species] || activePet.tags.species}
              </div>
            )}
          </div>

          {/* Pet Info + Tags */}
          <div className="text-center space-y-1">
            <h3 className="text-lg font-bold text-white/80">{activePet.name}</h3>
            <p className="text-xs text-white/55 font-mono">by {activePet.author}</p>
            {activePet.tags && (
              <div className="flex items-center justify-center gap-1.5 flex-wrap mt-1">
                {activePet.tags.pattern && activePet.tags.pattern !== 'solid' && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-[12px] text-white/40">
                    {activePet.tags.pattern === 'striped' ? '条纹' : activePet.tags.pattern === 'spotted' ? '斑点' : activePet.tags.pattern === 'bicolor' ? '双色' : '渐变'}
                  </span>
                )}
                {activePet.tags.special && activePet.tags.special !== 'none' && (
                  <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 text-[12px] text-yellow-400">
                    {activePet.tags.special === 'glowing' ? '发光' : '闪光'}
                  </span>
                )}
                {activePet.tags.hasWings && <span className="px-2 py-0.5 rounded-full bg-white/5 text-[12px] text-white/40">翅膀</span>}
                {activePet.tags.hasHorns && <span className="px-2 py-0.5 rounded-full bg-white/5 text-[12px] text-white/40">角</span>}
              </div>
            )}
          </div>

          {/* Animation Controls */}
          <div className="flex items-center gap-2">
            {BUILTIN_ANIMATIONS.map(anim => (
              <button
                key={anim}
                onClick={() => { setPreviewAnim(anim); setAnimKey(k => k + 1); }}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-bold uppercase transition-all ${
                  previewAnim === anim
                    ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400'
                    : 'bg-white/5 border border-white/5 text-white/55 hover:bg-white/10'
                }`}
              >
                {anim === 'idle' ? '待机' : anim === 'run' ? '奔跑' : anim === 'wave' ? '挥手' : anim === 'jump' ? '跳跃' : '等待'}
              </button>
            ))}
            <button
              onClick={() => setAnimKey(k => k + 1)}
              className="p-1.5 rounded-lg bg-white/5 border border-white/5 text-white/55 hover:bg-white/10 transition-all"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {onResetToSphere && selectedPetId && (
              <button
                onClick={() => onResetToSphere()}
                className="flex items-center gap-2 px-5 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm font-bold text-white/55 hover:text-white/60 hover:bg-white/10 transition-all"
              >
                还原默认圆球
              </button>
            )}
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => handleSelectPet(activePet)}
              className="flex items-center gap-2 px-8 py-3 bg-cyan-500/15 border border-cyan-500/25 rounded-2xl text-sm font-bold text-cyan-400 hover:bg-cyan-500/25 transition-all shadow-[0_0_30px_rgba(0,200,200,0.1)]"
            >
              <Sparkles size={16} />
              设为桌面形象
              <ArrowRight size={14} />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Color Panel ──

const COLOR_SLOTS: { key: keyof PetPalette; label: string; desc: string }[] = [
  { key: 'body', label: '身体', desc: '主体颜色' },
  { key: 'accent', label: '装饰', desc: '耳朵/角/翅膀' },
  { key: 'belly', label: '腹部', desc: '肚皮颜色' },
  { key: 'eye', label: '眼睛', desc: '瞳孔颜色' },
];

function ColorPanel({
  palette,
  activeSlot,
  onSelectSlot,
  onChangeColor,
}: {
  palette: PetPalette;
  activeSlot: keyof PetPalette;
  onSelectSlot: (slot: keyof PetPalette) => void;
  onChangeColor: (slot: keyof PetPalette, color: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Palette size={14} className="text-amber-400" />
        <p className="text-xs font-black uppercase tracking-wider text-white/50">颜色调板</p>
      </div>

      {/* Slot selector */}
      <div className="grid grid-cols-2 gap-1.5">
        {COLOR_SLOTS.map(slot => (
          <button
            key={slot.key}
            onClick={() => onSelectSlot(slot.key)}
            className={`flex items-center gap-2 p-2 rounded-xl border transition-all ${
              activeSlot === slot.key
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-white/5 border-white/5 hover:bg-white/10'
            }`}
          >
            <div
              className="w-6 h-6 rounded-lg border border-white/10 flex-shrink-0"
              style={{ backgroundColor: palette[slot.key] }}
            />
            <div className="text-left min-w-0">
              <div className="text-xs font-bold text-white/60">{slot.label}</div>
              <div className="text-[12px] text-white/35">{slot.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Color grid */}
      <div>
        <p className="text-xs text-white/40 mb-2">
          选择 {COLOR_SLOTS.find(s => s.key === activeSlot)?.label} 颜色
        </p>
        <div className="grid grid-cols-10 gap-1">
          {COLOR_PRESETS.map((color, i) => (
            <button
              key={i}
              onClick={() => onChangeColor(activeSlot, color)}
              className={`w-6 h-6 rounded-lg border-2 transition-all hover:scale-110 ${
                palette[activeSlot] === color ? 'border-white ring-2 ring-white/20' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={() => {
          const defaults = BUILTIN_PALETTES.cat;
          onChangeColor('body', defaults.body);
          onChangeColor('accent', defaults.accent);
          onChangeColor('belly', defaults.belly);
          onChangeColor('eye', defaults.eye);
        }}
        className="w-full p-2 bg-white/5 border border-white/5 rounded-xl text-[12px] text-white/45 hover:text-white/40 transition-all"
      >
        恢复默认
      </button>
    </div>
  );
}

// ── Wardrobe Panel ──

const CATEGORY_LABELS: Record<string, string> = {
  hat: '帽子', glasses: '眼镜', scarf: '围巾', collar: '项圈',
  ears: '耳朵', tail: '尾巴', mask: '面具', back: '背饰',
  faceMark: '印记', aura: '光环',
};

const CATEGORY_ORDER: AccessoryCategory[] = ['hat', 'glasses', 'mask', 'scarf', 'collar', 'ears', 'back', 'tail', 'faceMark', 'aura'];

function WardrobePanel({
  equipped,
  onChange,
}: {
  equipped: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (equipped.includes(id)) {
      onChange(equipped.filter(x => x !== id));
    } else {
      const acc = ALL_ACCESSORIES.find(a => a.id === id);
      const filtered = equipped.filter(x => {
        const existing = ALL_ACCESSORIES.find(a => a.id === x);
        return acc && existing && existing.category !== acc.category;
      });
      onChange([...filtered, id]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shirt size={14} className="text-emerald-400" />
        <p className="text-xs font-black uppercase tracking-wider text-white/50">配件装扮</p>
        <span className="text-[12px] text-white/45">({equipped.length} 件)</span>
      </div>

      {CATEGORY_ORDER.map(cat => {
        const items = ALL_ACCESSORIES.filter(a => a.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-widest text-white/40">
              {CATEGORY_LABELS[cat] || cat}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map(acc => {
                const active = equipped.includes(acc.id);
                return (
                  <button
                    key={acc.id}
                    onClick={() => toggle(acc.id)}
                    className={`p-2 rounded-xl border text-left transition-all ${
                      active
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {active && <Check size={10} className="text-emerald-400 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className={`text-xs font-bold truncate ${active ? 'text-emerald-400' : 'text-white/50'}`}>
                          {acc.nameCN}
                        </div>
                        <div className="text-[12px] text-white/40 truncate">{acc.name}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {equipped.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="w-full p-2 bg-white/5 border border-white/5 rounded-xl text-[12px] text-white/45 hover:text-white/40 hover:bg-white/10 transition-all"
        >
          卸下全部
        </button>
      )}
    </div>
  );
}
