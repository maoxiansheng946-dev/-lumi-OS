import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Folder, 
  File, 
  Share2, 
  Shield, 
  Lock, 
  HardDrive, 
  Search, 
  ArrowLeft, 
  Upload, 
  Trash2, 
  Edit3, 
  MoreVertical,
  Download,
  Info,
  Loader2,
  Plus
} from 'lucide-react';
import { toast } from 'sonner';

interface FSItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  size: string;
  status: 'encrypted' | 'sharded' | 'local';
  updatedAt?: string;
  children?: FSItem[];
}

export function NeuralFileManager({ t }: { t: any }) {
  const [items, setItems] = useState<FSItem[]>([]);
  const [currentPath, setCurrentPath] = useState<FSItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, itemId: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchFiles();
  }, [currentPath]);

  const fetchFiles = async () => {
    setIsLoading(true);
    try {
      const path = currentPath.map(p => p.name).join('/');
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`);
      const contentType = res.headers.get("content-type");

      if (res.ok && contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setItems(data.files || []);
      } else {
        // Fallback to mock data if API not ready or returns HTML (SPA fallback)
        setItems([
          { id: 'f1', name: 'sharding_protocol.bin', type: 'file', size: '1.2 MB', status: 'sharded' },
          { id: 'f2', name: 'mesh_identity.priv', type: 'file', size: '4 KB', status: 'encrypted' },
          { id: 'f3', name: 'Personal_Log_01.md', type: 'file', size: '12 KB', status: 'local' },
        ]);
      }
    } catch (err) {
      console.error("Failed to fetch files:", err);
      // Ensure mock data on error too
      setItems([
        { id: 'f1', name: 'sharding_protocol.bin', type: 'file', size: '1.2 MB', status: 'sharded' },
        { id: 'f2', name: 'mesh_identity.priv', type: 'file', size: '4 KB', status: 'encrypted' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handeUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsLoading(true);
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));
    
    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        toast.success(`Successfully uploaded ${files.length} files`);
        fetchFiles();
      } else {
        toast.error('Upload failed');
      }
    } catch (err) {
      toast.error('Connection error during upload');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateTo = (item: FSItem) => {
    if (item.type === 'folder') {
      setCurrentPath([...currentPath, item]);
    } else {
      previewItem(item);
    }
  };

  const goBack = () => {
    if (currentPath.length > 0) {
      setCurrentPath(currentPath.slice(0, -1));
    }
  };

  const handleContextMenu = (e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, itemId });
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this fragment?')) return;

    try {
      const res = await fetch(`/api/files/delete/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Shard deleted');
        fetchFiles();
      }
    } catch (err) {
      toast.error('Deletion failed');
    }
    setContextMenu(null);
  };

  const downloadItem = async (id: string) => {
    try {
      const res = await fetch(`/api/files/download/${id}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = id;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (err) {
      toast.error('Download failed');
    }
    setContextMenu(null);
  };

  const renameItem = async (id: string) => {
    const newName = prompt('Enter new name:', id);
    if (!newName || newName === id) return;
    try {
      const res = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, newName }),
      });
      if (res.ok) {
        toast.success('Renamed');
        fetchFiles();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Rename failed');
      }
    } catch (err) {
      toast.error('Rename failed');
    }
    setContextMenu(null);
  };

  const showFileInfo = async (id: string) => {
    try {
      const res = await fetch(`/api/files/info/${id}`);
      if (res.ok) {
        const info = await res.json();
        toast.info(`${info.name}\n${info.formattedSize} · ${info.type}\nModified: ${new Date(info.updatedAt).toLocaleString()}`);
      }
    } catch (err) {
      toast.error('Failed to get file info');
    }
    setContextMenu(null);
  };

  const previewItem = async (item: FSItem) => {
    if (item.type === 'folder') return;
    // For text files, try to fetch and display content
    const textExts = ['.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.yaml', '.yml', '.toml', '.xml', '.log', '.env', '.sh', '.bat'];
    const ext = '.' + item.name.split('.').pop()?.toLowerCase();
    if (textExts.includes(ext) && item.size !== '--') {
      try {
        const res = await fetch(`/api/files/download/${item.id}`);
        if (res.ok) {
          const text = await res.text();
          const w = window.open('', '_blank', 'width=800,height=600');
          if (w) {
            w.document.title = item.name;
            w.document.body.innerHTML = `<pre style="font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;word-break:break-all">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
          }
        }
      } catch { toast.info(`Cannot preview ${item.name}`); }
    } else {
      toast.info(`Preview not available for this file type. Use Download instead.`);
    }
  };

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className="flex flex-col h-full bg-black/40 text-white font-sans relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { 
        e.preventDefault(); 
        setIsDragging(false); 
        handeUpload(e.dataTransfer.files); 
      }}
      onClick={() => setContextMenu(null)}
    >
      {/* Search & Breadcrumbs */}
      <div className="p-4 border-b border-white/5 flex items-center gap-4 bg-white/5">
        <div className="flex gap-2">
          <button 
            onClick={goBack}
            disabled={currentPath.length === 0}
            className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-xl disabled:opacity-20 transition-all border border-transparent hover:border-white/10 shadow-lg"
          >
            <ArrowLeft size={18} />
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 flex items-center justify-center bg-celestial-saturn/10 text-celestial-saturn hover:bg-celestial-saturn/20 rounded-xl transition-all border border-celestial-saturn/20 shadow-lg"
          >
            <Plus size={18} />
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              onChange={(e) => handeUpload(e.target.files)} 
            />
          </button>
        </div>

        <div className="flex-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
          <span className="hover:text-white cursor-pointer transition-colors" onClick={() => setCurrentPath([])}>ROOT</span>
          {currentPath.map((p, i) => (
            <React.Fragment key={p.id}>
              <span className="opacity-20">/</span>
              <span className="text-white/80 hover:text-white cursor-pointer transition-colors" onClick={() => setCurrentPath(currentPath.slice(0, i + 1))}>{p.name}</span>
            </React.Fragment>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchShards || "Search Matrix Shards..."}
            className="bg-black/40 border border-white/10 rounded-full py-2 pl-10 pr-4 text-[10px] font-bold w-64 focus:border-celestial-saturn/50 outline-none transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Grid Layout */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-white/40 gap-4">
            <Loader2 size={32} className="animate-spin text-celestial-saturn" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em]">Synchronizing Shards...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/20 gap-4 opacity-50">
            <HardDrive size={48} strokeWidth={1} />
            <span className="text-xs font-black uppercase tracking-widest">{t.noDataShards || 'No Data Shards Found'}</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8">
            {filteredItems.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onDoubleClick={() => navigateTo(item)}
                onContextMenu={(e) => handleContextMenu(e, item.id)}
                className="flex flex-col items-center gap-4 p-6 rounded-[2.5rem] bg-white/0 hover:bg-white/[0.03] transition-all group cursor-pointer border border-transparent hover:border-white/5 relative shadow-lg"
              >
                <div className={`w-20 h-20 rounded-3xl flex items-center justify-center relative transition-transform duration-500 group-hover:scale-110 ${
                  item.type === 'folder' ? 'text-celestial-saturn' : 'text-white/60'
                }`}>
                  <div className="absolute inset-0 bg-white/5 rotate-3 rounded-3xl group-hover:rotate-6 transition-transform shadow-xl" />
                  <div className="relative z-10 filter drop-shadow-lg">
                    {item.type === 'folder' ? <Folder size={40} /> : <File size={40} />}
                  </div>
                  
                  {/* Status Indicator */}
                  <div className="absolute -bottom-2 -right-2">
                    {item.status === 'sharded' && (
                      <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center backdrop-blur-md shadow-lg">
                        <Share2 size={12} className="text-blue-400" />
                      </div>
                    )}
                    {item.status === 'encrypted' && (
                      <div className="w-7 h-7 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center backdrop-blur-md shadow-lg">
                        <Lock size={12} className="text-red-400" />
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="text-center space-y-1 w-full overflow-hidden">
                   <div className="text-[10px] font-black uppercase tracking-widest truncate group-hover:text-celestial-saturn transition-colors">
                     {item.name}
                   </div>
                   <div className="text-[8px] font-bold text-white/20 uppercase tracking-widest leading-none">
                     {item.type === 'folder' ? (t.folder || 'Folder') : item.size}
                   </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[100] w-48 glass-dark rounded-2xl border border-white/10 p-2 shadow-2xl backdrop-blur-3xl"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {[
              { label: 'Download', icon: <Download size={14} />, action: () => downloadItem(contextMenu.itemId) },
              { label: 'Rename', icon: <Edit3 size={14} />, action: () => renameItem(contextMenu.itemId) },
              { label: 'File Info', icon: <Info size={14} />, action: () => showFileInfo(contextMenu.itemId) },
              { label: 'Delete', icon: <Trash2 size={14} />, color: 'text-red-400 hover:bg-red-500/20', action: () => deleteItem(contextMenu.itemId) },
            ].map((action, i) => (
              <button 
                key={i}
                onClick={(e) => { e.stopPropagation(); action.action(); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                  action.color || 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drag Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-celestial-saturn/10 backdrop-blur-sm border-4 border-dashed border-celestial-saturn/40 flex flex-col items-center justify-center gap-6"
          >
            <div className="w-24 h-24 rounded-full bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn animate-bounce shadow-2xl">
              <Upload size={48} />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black text-white italic uppercase tracking-[0.2em]">{t.dropToSync || 'Drop to Synchronize'}</h3>
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Inject fragments into the neural repository</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Storage Footer */}
      <div className="p-6 border-t border-white/5 bg-white/[0.02] flex justify-between items-center px-12">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/20">
            <HardDrive size={20} />
          </div>
          <div className="space-y-2">
            <div className="text-[8px] font-black text-white/40 uppercase tracking-[0.4em]">{t.shardedMemoryStatus || 'Sharded Memory Status'}</div>
            <div className="w-48 h-1.5 bg-white/5 rounded-full overflow-hidden shadow-inner">
               <motion.div 
                initial={{ width: 0 }}
                animate={{ width: '42%' }}
                className="h-full bg-gradient-to-r from-celestial-saturn/40 to-celestial-saturn" 
               />
            </div>
          </div>
        </div>
        <div className="text-right">
           <div className="text-sm font-black text-white flex items-center gap-2 justify-end">
             <span className="text-emerald-500 animate-pulse">●</span>
             42.1 GB {t.available || 'AVAILABLE'}
           </div>
           <div className="text-[8px] text-white/20 font-black uppercase tracking-[0.2em] mt-1">{t.distributedShardLimit || 'Distributed Shard Limit'}: 100 GB</div>
        </div>
      </div>
    </div>
  );
}
