import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Folder, File, Share2, Shield, Lock, HardDrive, Search, ArrowLeft } from 'lucide-react';

interface FSItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  size: string;
  status: 'encrypted' | 'sharded' | 'local';
  children?: FSItem[];
}

const mockFS: FSItem[] = [
  {
    id: 'root_0',
    name: 'Neural_Core',
    type: 'folder',
    size: '--',
    status: 'local',
    children: [
      { id: 'f1', name: 'sharding_protocol.bin', type: 'file', size: '1.2 MB', status: 'sharded' },
      { id: 'f2', name: 'mesh_identity.priv', type: 'file', size: '4 KB', status: 'encrypted' },
    ]
  },
  {
    id: 'root_1',
    name: 'Distributed_Shards',
    type: 'folder',
    size: '--',
    status: 'sharded',
    children: [
      { id: 's1', name: 'shard_alpha_0x11.node', type: 'file', size: '256 KB', status: 'sharded' },
      { id: 's2', name: 'shard_beta_0x44.node', type: 'file', size: '256 KB', status: 'sharded' },
      { id: 's3', name: 'shard_gamma_0xEF.node', type: 'file', size: '256 KB', status: 'sharded' },
    ]
  },
  { id: 'root_2', name: 'System_Logs', type: 'folder', size: '--', status: 'local' }
];

export function NeuralFileManager() {
  const [currentPath, setCurrentPath] = useState<FSItem[]>([]);
  const [history, setHistory] = useState<FSItem[][]>([]);

  const items = currentPath.length > 0 ? currentPath[currentPath.length - 1].children || [] : mockFS;

  const navigateTo = (folder: FSItem) => {
    if (folder.type === 'folder') {
      setHistory([...history, currentPath]);
      setCurrentPath([...currentPath, folder]);
    }
  };

  const goBack = () => {
    if (currentPath.length > 0) {
      setCurrentPath(currentPath.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col h-full bg-black/40 text-white font-sans">
      {/* Search & Breadcrumbs */}
      <div className="p-4 border-b border-white/5 flex items-center gap-4 bg-white/5">
        <button 
          onClick={goBack}
          disabled={currentPath.length === 0}
          className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-20 transition-all"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40">
          <span>ROOT</span>
          {currentPath.map((p, i) => (
            <React.Fragment key={p.id}>
              <span className="opacity-20">/</span>
              <span className="text-white/80">{p.name}</span>
            </React.Fragment>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <input 
            type="text" 
            placeholder="Search Shards..." 
            className="bg-black/40 border border-white/5 rounded-full py-1.5 pl-10 pr-4 text-[10px] w-48 focus:border-celestial-saturn/40 outline-none transition-all"
          />
        </div>
      </div>

      {/* Grid Layout */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-4 md:grid-cols-6 gap-6 content-start">
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onDoubleClick={() => navigateTo(item)}
            className="flex flex-col items-center gap-3 p-4 rounded-3xl hover:bg-white/5 transition-all group cursor-pointer border border-transparent hover:border-white/5"
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center relative ${
              item.type === 'folder' ? 'text-celestial-saturn' : 'text-white/60'
            }`}>
              <div className="absolute inset-0 bg-white/5 rotate-3 rounded-2xl group-hover:rotate-6 transition-transform" />
              <div className="relative z-10">
                {item.type === 'folder' ? <Folder size={32} /> : <File size={32} />}
              </div>
              
              {/* Status Indicator */}
              <div className="absolute -bottom-1 -right-1">
                {item.status === 'sharded' && (
                  <div className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center backdrop-blur-sm">
                    <Share2 size={10} className="text-blue-400" />
                  </div>
                )}
                {item.status === 'encrypted' && (
                  <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center backdrop-blur-sm">
                    <Lock size={10} className="text-red-400" />
                  </div>
                )}
              </div>
            </div>
            
            <div className="text-center space-y-1">
               <div className="text-[10px] font-black uppercase tracking-tight truncate w-24">
                 {item.name}
               </div>
               <div className="text-[8px] font-bold text-white/20 uppercase tracking-widest leading-none">
                 {item.type === 'folder' ? 'Folder' : item.size}
               </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Storage Footer */}
      <div className="p-4 border-t border-white/5 bg-white/2 flex justify-between items-center px-8">
        <div className="flex items-center gap-3">
          <HardDrive size={14} className="text-white/20" />
          <div className="space-y-1">
            <div className="text-[8px] font-bold text-white/40 uppercase tracking-widest">Mesh Storage Utilization</div>
            <div className="w-32 h-1 bg-white/5 rounded-full overflow-hidden">
               <div className="h-full bg-celestial-saturn w-[42%]" />
            </div>
          </div>
        </div>
        <div className="text-right">
           <div className="text-[10px] font-black italic">42.1 GB FREE</div>
           <div className="text-[8px] text-white/20 uppercase tracking-tighter">Distributed Shard Limit: 100 GB</div>
        </div>
      </div>
    </div>
  );
}
