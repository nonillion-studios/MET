import { useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'motion/react';
import {
  Upload as UploadIcon, File, RefreshCw, Download, User, ChevronDown, ImagePlus,
  Tag, X, HardDrive, Boxes, FolderInput
} from 'lucide-react';
import { Input, Button, GlassCard, Modal } from '../ui';
import { AdSlot } from '../AdSlot';
import { swal, swalToast } from '../../lib/swalTheme';
import { readImageFile } from '../../lib/image';
import type { CloudClient, CloudFile } from '../../lib/cloudClient';
import type { Profile, Workspace } from '../../types';

interface CloudFilesProps {
  cc: CloudClient;
  workspaces: Workspace[];
  profile: Profile;
  onImportWorkspace: (workspace: Workspace) => void;
}

function TagChip({ tag, onRemove, onClick, active }: { tag: string; onRemove?: () => void; onClick?: () => void; active?: boolean }) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
        active ? 'bg-accent text-white border-accent' : 'bg-accent-soft border-accent/30 text-accent'
      } ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {tag}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="hover:opacity-70">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function CloudFiles({ cc, workspaces, profile, onImportWorkspace }: CloudFilesProps) {
  const [showUploadPanel, setShowUploadPanel] = useState(true);
  const [uploadSource, setUploadSource] = useState<'device' | 'workspace'>('device');

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');

  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const knownTags: string[] = Array.from(new Set<string>(cc.files.flatMap(f => f.tags))).sort();

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadName('');
    setUploadDesc('');
    setCoverDataUrl(null);
    setTags([]);
    setSelectedWorkspaceId('');
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    if (!uploadName) setUploadName(file.name);

    if (file.name.toLowerCase().endsWith('.zip')) {
      try {
        const jszip = new (await import('jszip')).default();
        const zip = await jszip.loadAsync(file);
        const imageFiles = Object.keys(zip.files).filter(name => !zip.files[name].dir && name.match(/\.(png|jpe?g|webp)$/i));
        if (imageFiles.length > 0) {
          imageFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          const base64 = await zip.files[imageFiles[0]].async('base64');
          setCoverDataUrl(`data:image/jpeg;base64,${base64}`);
          swalToast({ icon: 'success', title: 'Cover suggested from ZIP — you can still change it' });
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleUpload = async () => {
    if (uploadSource === 'device') {
      if (!uploadFile) {
        swal({ icon: 'error', title: 'No File', text: 'Choose a file to upload first.' });
        return;
      }
      await cc.uploadFile(uploadFile, { name: uploadName, notes: uploadDesc, tags, coverDataUrl, profile });
      resetUploadForm();
      if (fileInputRef.current) fileInputRef.current.value = '';
    } else {
      const workspace = workspaces.find(w => w.id === selectedWorkspaceId);
      if (!workspace) {
        swal({ icon: 'error', title: 'No Workspace', text: 'Pick a workspace to back up.' });
        return;
      }
      await cc.uploadWorkspaceBackup(workspace, { notes: uploadDesc, tags, profile });
      resetUploadForm();
    }
  };

  const handleRestore = async (file: CloudFile) => {
    const result = await swal({
      icon: 'question',
      title: `Import "${file.name}" into your library?`,
      text: 'This adds it as a new workspace on this device — your cloud copy stays untouched.',
      showCancelButton: true,
      confirmButtonText: 'Import',
    });
    if (!result.isConfirmed) return;
    const workspace = await cc.restoreWorkspaceFromCloud(file);
    if (workspace) {
      onImportWorkspace(workspace);
      swalToast({ icon: 'success', title: `"${workspace.name}" added to your library` });
    }
  };

  const filteredFiles = cc.files
    .filter(f => {
      const q = searchQuery.toLowerCase();
      const matchesQuery = !q || f.name.toLowerCase().includes(q) || f.sender.toLowerCase().includes(q) || f.tags.some(t => t.toLowerCase().includes(q));
      const matchesTag = !activeTagFilter || f.tags.includes(activeTagFilter);
      return matchesQuery && matchesTag;
    })
    .sort((a, b) => {
      if (sortOrder === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (sortOrder === 'alphabetical') return a.name.localeCompare(b.name);
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  const uploadedBytes = Math.round(cc.uploadTotalBytes * (cc.uploadProgress / 100));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      {/* Upload panel */}
      <GlassCard className="rounded-2xl overflow-hidden">
        <button type="button" onClick={() => setShowUploadPanel(v => !v)} className="w-full flex items-center justify-between gap-3 p-5 text-left">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <UploadIcon className="text-accent" size={18} /> Add to Cloud Storage
          </h3>
          <ChevronDown className={`text-ink-faint transition-transform duration-200 ${showUploadPanel ? 'rotate-180' : ''}`} size={18} />
        </button>
        {showUploadPanel && (
          <div className="px-6 pb-6 border-t border-hairline pt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2 max-w-xs">
              <button
                onClick={() => setUploadSource('device')}
                className={`py-2 rounded-xl border text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${uploadSource === 'device' ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
              >
                <HardDrive size={13} /> From Device
              </button>
              <button
                onClick={() => setUploadSource('workspace')}
                className={`py-2 rounded-xl border text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${uploadSource === 'workspace' ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
              >
                <FolderInput size={13} /> From Workspace
              </button>
            </div>

            {uploadSource === 'device' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Input type="text" placeholder="File name (e.g. Solo Leveling Ch.12)" value={uploadName} onChange={e => setUploadName(e.target.value)} />
                  <Input type="text" placeholder="Notes for the team..." value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="w-14 h-14 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
                    >
                      {coverDataUrl ? <img src={coverDataUrl} alt="Cover" className="w-full h-full object-cover" /> : <ImagePlus size={16} className="text-ink-faint" />}
                    </button>
                    <span className="text-xs text-ink-faint">{coverDataUrl ? 'Cover chosen — click to change' : 'Choose a cover image (optional)'}</span>
                    <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readImageFile(f, setCoverDataUrl); }} />
                  </div>
                </div>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-accent/30 hover:border-accent/60 rounded-xl bg-accent-soft flex flex-col items-center justify-center cursor-pointer transition-colors p-6 group"
                >
                  <input type="file" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
                  {uploadFile ? (
                    <div className="text-center text-accent">
                      <File className="mx-auto mb-2 opacity-80" size={32} />
                      <p className="font-bold whitespace-nowrap text-ellipsis overflow-hidden max-w-[200px]">{uploadFile.name}</p>
                      <p className="text-xs opacity-60">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  ) : (
                    <>
                      <UploadIcon size={32} className="text-ink-faint mb-3 group-hover:text-accent transition-colors" />
                      <p className="text-sm font-semibold text-ink-muted">Click here to choose a file (up to 2GB)</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {workspaces.length === 0 ? (
                  <p className="text-xs text-ink-faint">Create a workspace in Library first, then back it up here.</p>
                ) : (
                  <select
                    value={selectedWorkspaceId}
                    onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
                  >
                    <option value="">Choose a workspace...</option>
                    {workspaces.map(w => <option key={w.id} value={w.id}>{w.name} ({w.mangas.length} series)</option>)}
                  </select>
                )}
                <Input type="text" placeholder="Notes for the team..." value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} />
                <p className="text-[11px] text-ink-faint">Uploads the whole workspace (series, volumes, chapters, covers) as a restorable backup.</p>
              </div>
            )}

            {/* Tags */}
            <div className="space-y-2">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Tag size={12} /> Tags</label>
              <div className="flex items-center gap-2">
                <Input
                  type="text" placeholder="Type a tag and press Enter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                />
              </div>
              {(tags.length > 0 || knownTags.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map(t => <TagChip key={t} tag={t} onRemove={() => setTags(prev => prev.filter(x => x !== t))} />)}
                  {knownTags.filter(t => !tags.includes(t)).map(t => (
                    <button key={t} onClick={() => setTags(prev => [...prev, t])} className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-hairline text-ink-faint hover:border-accent/40 hover:text-accent transition-colors">
                      + {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={handleUpload} disabled={cc.isUploading} className="w-full mt-2" size="lg">
              {cc.isUploading ? 'Uploading...' : uploadSource === 'device' ? 'Upload File to Cloud' : 'Back Up Workspace to Cloud'}
            </Button>
          </div>
        )}
      </GlassCard>

      {/* Upload progress modal */}
      <Modal open={cc.isUploading} onClose={() => {}} dismissible={false} title="Uploading to Cloud" size="sm">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink truncate">{cc.uploadLabel}</p>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{cc.formatSize(uploadedBytes)} / {cc.formatSize(cc.uploadTotalBytes)}</p>
          </div>
          <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 bg-accent h-full transition-all duration-300" style={{ width: `${cc.uploadProgress}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">{cc.uploadProgress}%</span>
          </div>
          <AdSlot placement="upload-progress" />
        </div>
      </Modal>

      {/* Files grid */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <h3 className="text-lg font-bold text-ink flex items-center gap-2">
            <HardDrive className="text-accent" size={18} /> Cloud Storage
          </h3>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Input type="text" placeholder="Search files, senders, tags..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 min-w-[200px]" />
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as any)}
              className="bg-ink/5 border border-hairline rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-accent"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="alphabetical">A-Z</option>
            </select>
            <button onClick={cc.fetchFiles} className="text-sm text-accent hover:text-ink flex items-center gap-1 bg-accent-soft px-3 py-2 rounded-xl border border-accent/20 transition-colors">
              <RefreshCw size={14} className={cc.isLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {knownTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {knownTags.map(t => (
              <TagChip key={t} tag={t} active={activeTagFilter === t} onClick={() => setActiveTagFilter(prev => prev === t ? null : t)} />
            ))}
          </div>
        )}

        {cc.isLoading && cc.files.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-64 rounded-xl bg-ink/5 animate-pulse border border-hairline" />)}
          </div>
        ) : filteredFiles.length === 0 ? (
          <GlassCard className="text-center py-16">
            <File className="mx-auto text-ink-faint mb-3 opacity-50" size={48} />
            <p className="text-ink-muted font-semibold">{cc.files.length === 0 ? 'Repository is empty.' : 'No files match your search.'}</p>
            <p className="text-xs text-ink-faint mt-1">{cc.files.length === 0 ? 'Upload the first file to see the magic!' : 'Try a different search or tag.'}</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredFiles.map((file) => (
              <GlassCard key={file.id} radius="xl" className="overflow-hidden flex flex-col hover:border-accent/50 transition-colors group">
                <div className="h-40 w-full bg-accent-soft flex flex-col items-center justify-center border-b border-hairline relative overflow-hidden">
                  {cc.coverUrls[file.id] ? (
                    <>
                      <img src={cc.coverUrls[file.id]} alt="Cover" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    </>
                  ) : (
                    <>
                      {file.coverMsgId ? <span className="text-[10px] text-accent font-mono mb-2 animate-pulse">Loading Cover...</span> : null}
                      {file.type === 'workspace_backup' ? <Boxes size={32} className="text-accent/50" /> : <File size={32} className="text-accent/50" />}
                    </>
                  )}
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-black/50 text-white backdrop-blur-sm">
                    {file.type === 'workspace_backup' ? <><Boxes size={10} /> Workspace</> : <><File size={10} /> File</>}
                  </span>
                </div>
                <div className="p-4 flex flex-col gap-2 flex-1">
                  <h4 className="font-bold text-ink text-base truncate">{file.name}</h4>
                  {file.description && <p className="text-xs text-ink-muted line-clamp-2 leading-relaxed">{file.description}</p>}
                  {file.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {file.tags.map(t => <TagChip key={t} tag={t} onClick={() => setActiveTagFilter(t)} />)}
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-1 bg-ink/5 p-2 rounded-lg border border-hairline">
                    <div className="w-6 h-6 rounded-full overflow-hidden bg-accent-soft border border-accent/30 shrink-0">
                      {file.avatar ? <img src={file.avatar} alt="Sender" className="w-full h-full object-cover" /> : <User size={12} className="m-auto mt-1 text-accent" />}
                    </div>
                    <span className="text-xs text-ink-muted truncate">{file.sender || 'Anonymous user'}</span>
                  </div>

                  <div className="flex justify-between items-center text-xs text-ink-muted font-mono border-t border-hairline pt-2 mt-auto">
                    <span>{new Date(file.date).toLocaleDateString()}</span>
                    {file.type === 'workspace_backup' ? (
                      <button onClick={() => handleRestore(file)} className="text-accent hover:text-ink flex items-center gap-1 font-sans font-bold bg-accent-soft hover:opacity-80 px-2 py-1 rounded transition-colors">
                        <FolderInput size={14} /> Restore
                      </button>
                    ) : (
                      <button onClick={() => cc.downloadCloudFile(file)} className="text-accent hover:text-ink flex items-center gap-1 font-sans font-bold bg-accent-soft hover:opacity-80 px-2 py-1 rounded transition-colors">
                        <Download size={14} /> Download
                      </button>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
