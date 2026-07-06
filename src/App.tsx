import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, Trash2, Upload, BookOpen, Layers, FileStack, ImagePlus, Sparkles
} from 'lucide-react';
import { get, set } from 'idb-keyval';
import { extractImagesFromZip } from './lib/zip';
import { MangaSeries, Volume, Chapter } from './types';
import { swal, swalToast } from './lib/swalTheme';
import 'sweetalert2/dist/sweetalert2.min.css';
import { TopBar } from './components/TopBar';
import { FloatingMusicPlayer } from './components/FloatingMusicPlayer';
import { SplashScreen } from './components/SplashScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { BottomTabBar } from './components/BottomTabBar';
import { SidebarRail } from './components/SidebarRail';
import { CloudStorage } from './components/CloudStorage';
import { AdSlot } from './components/AdSlot';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import { UserAgreement } from './components/legal/UserAgreement';
import { Modal, Button, Input, Textarea, GlassCard } from './components/ui';
import type { NavTabId } from './config/navTabs';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  // Manga hierarchical library
  const [mangas, setMangas] = useState<MangaSeries[]>([]);
  const [activeMangaId, setActiveMangaId] = useState<string | null>(null);
  const [activeVolumeId, setActiveVolumeId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const [activeNavigationTab, setActiveNavigationTab] = useState<NavTabId>('library');

  // Create series modal
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [newSeriesType, setNewSeriesType] = useState<'manga' | 'manhwa'>('manga');
  const [newSeriesDesc, setNewSeriesDesc] = useState('');
  const [newSeriesCoverUrl, setNewSeriesCoverUrl] = useState('');
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  // Legal modals
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const chapterZipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get('mangas_library').then((saved) => {
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setMangas(saved);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (mangas.length > 0) {
      const timeout = setTimeout(() => {
        set('mangas_library', mangas).catch(console.error);
      }, 800);
      return () => clearTimeout(timeout);
    }
  }, [mangas]);

  const activeManga = mangas.find(m => m.id === activeMangaId) || null;
  const activeVolume = activeManga?.volumes.find(v => v.id === activeVolumeId) || null;
  const activeChapter = activeVolume?.chapters.find(c => c.id === activeChapterId) || null;

  const resetToLibraryRoot = () => {
    setActiveMangaId(null);
    setActiveVolumeId(null);
    setActiveChapterId(null);
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      swal({ icon: 'warning', title: 'Image Too Large', text: 'Please choose a cover image smaller than 2MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setNewSeriesCoverUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleCreateSeries = () => {
    if (!newSeriesTitle.trim()) {
      swal({ icon: 'error', title: 'Title Required', text: 'Please enter a title for your series to continue.' });
      return;
    }
    const newManga: MangaSeries = {
      id: 'manga-' + Math.random().toString(36).substr(2, 9),
      title: newSeriesTitle.trim(),
      type: newSeriesType,
      coverUrl: newSeriesCoverUrl,
      description: newSeriesDesc.trim(),
      volumes: [],
    };
    setMangas(prev => [...prev, newManga]);
    setShowCreateSeriesModal(false);
    setNewSeriesTitle('');
    setNewSeriesDesc('');
    setNewSeriesCoverUrl('');
    setNewSeriesType('manga');
    swalToast({ icon: 'success', title: 'Series added to your library!' });
  };

  const handleAddVolumePrompt = async () => {
    if (!activeManga) return;
    const { value: name } = await swal({
      title: 'New Volume',
      input: 'text',
      inputPlaceholder: 'e.g. Volume 1',
      showCancelButton: true,
      confirmButtonText: 'Add Volume',
    });
    if (!name || !name.trim()) return;
    const newVolume: Volume = { id: 'volume-' + Math.random().toString(36).substr(2, 9), name: name.trim(), chapters: [] };
    setMangas(prev => prev.map(m => m.id === activeManga.id ? { ...m, volumes: [...m.volumes, newVolume] } : m));
    setActiveVolumeId(newVolume.id);
  };

  const handleAddChapterPrompt = async () => {
    if (!activeManga || !activeVolume) return;
    const { value: name } = await swal({
      title: 'New Chapter',
      input: 'text',
      inputPlaceholder: 'e.g. Chapter 1',
      showCancelButton: true,
      confirmButtonText: 'Add Chapter',
    });
    if (!name || !name.trim()) return;
    const newChapter: Chapter = { id: 'chapter-' + Math.random().toString(36).substr(2, 9), name: name.trim(), images: [] };
    setMangas(prev => prev.map(m => {
      if (m.id !== activeManga.id) return m;
      return { ...m, volumes: m.volumes.map(v => v.id === activeVolume.id ? { ...v, chapters: [...v.chapters, newChapter] } : v) };
    }));
    setActiveChapterId(newChapter.id);
  };

  const handleCreatePress = () => {
    if (activeManga) {
      if (activeVolume) handleAddChapterPrompt();
      else handleAddVolumePrompt();
    } else {
      setShowCreateSeriesModal(true);
    }
  };

  const handleDeleteManga = async (manga: MangaSeries) => {
    const result = await swal({
      icon: 'warning',
      title: 'Delete this series?',
      text: `This will permanently remove "${manga.title}" and all of its volumes and chapters.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Series',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setMangas(prev => prev.filter(m => m.id !== manga.id));
    if (activeMangaId === manga.id) resetToLibraryRoot();
  };

  const handleDeleteVolume = async (volume: Volume) => {
    if (!activeManga) return;
    const result = await swal({
      icon: 'warning',
      title: 'Delete this volume?',
      text: `This will permanently remove "${volume.name}" and all of its chapters.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Volume',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setMangas(prev => prev.map(m => m.id === activeManga.id ? { ...m, volumes: m.volumes.filter(v => v.id !== volume.id) } : m));
    if (activeVolumeId === volume.id) { setActiveVolumeId(null); setActiveChapterId(null); }
  };

  const handleDeleteChapter = async (chapter: Chapter) => {
    if (!activeManga || !activeVolume) return;
    const result = await swal({
      icon: 'warning',
      title: 'Delete this chapter?',
      text: `This will permanently remove "${chapter.name}" and all of its pages.`,
      showCancelButton: true,
      confirmButtonText: 'Delete Chapter',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setMangas(prev => prev.map(m => {
      if (m.id !== activeManga.id) return m;
      return { ...m, volumes: m.volumes.map(v => v.id === activeVolume.id ? { ...v, chapters: v.chapters.filter(c => c.id !== chapter.id) } : v) };
    }));
    if (activeChapterId === chapter.id) setActiveChapterId(null);
  };

  const handleChapterZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeManga || !activeVolume || !activeChapter) return;

    swal({
      title: 'Importing Pages...',
      text: 'Unpacking the archive and preparing pages.',
      allowOutsideClick: false,
    });

    try {
      const extracted = await extractImagesFromZip(file);
      setMangas(prev => prev.map(m => {
        if (m.id !== activeManga.id) return m;
        return {
          ...m,
          volumes: m.volumes.map(v => {
            if (v.id !== activeVolume.id) return v;
            return {
              ...v,
              chapters: v.chapters.map(c => c.id === activeChapter.id ? { ...c, images: [...c.images, ...extracted] } : c),
            };
          }),
        };
      }));
      swalToast({ icon: 'success', title: `Imported ${extracted.length} pages!` });
    } catch (err) {
      console.error(err);
      swal({ icon: 'error', title: 'Import Failed', text: 'The archive might be corrupted or in an unsupported format.' });
    }
    if (chapterZipInputRef.current) chapterZipInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen app-shell-bg dynamic-bg text-ink">
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}

      <div className="fog-orbs" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <TopBar />
      <FloatingMusicPlayer />

      <SidebarRail activeTab={activeNavigationTab} onTabChange={setActiveNavigationTab} onCreatePress={handleCreatePress} />

      <div className="flex flex-1 lg:pl-20">
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-32 lg:pb-10 max-w-6xl mx-auto w-full">
          {activeNavigationTab === 'settings' && (
            <SettingsPanel onShowPrivacy={() => setShowPrivacyModal(true)} onShowTerms={() => setShowTermsModal(true)} />
          )}

          {activeNavigationTab === 'cloud' && (
            <div className="space-y-4">
              <AdSlot placement="cloud-top" />
              <CloudStorage onBack={() => setActiveNavigationTab('library')} />
            </div>
          )}

          {activeNavigationTab === 'scheduler' && (
            <GlassCard className="p-10 flex flex-col items-center text-center gap-3">
              <Sparkles className="text-accent" size={28} />
              <h2 className="text-lg font-display font-semibold text-ink">Automation — Coming Soon</h2>
              <p className="text-sm text-ink-muted max-w-md">Scheduled scans, batch translation runs, and recurring pipelines will land here in a future update.</p>
            </GlassCard>
          )}

          {activeNavigationTab === 'library' && (
            <div className="space-y-5">
              {!activeChapter && <AdSlot placement="library-top" />}

              {/* Breadcrumb */}
              {(activeManga || activeVolume) && (
                <div className="flex items-center gap-2 text-sm">
                  <button onClick={resetToLibraryRoot} className="text-ink-muted hover:text-accent transition-colors">Library</button>
                  {activeManga && (
                    <>
                      <span className="text-ink-faint">/</span>
                      <button onClick={() => { setActiveVolumeId(null); setActiveChapterId(null); }} className={`transition-colors ${!activeVolume ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}>{activeManga.title}</button>
                    </>
                  )}
                  {activeVolume && (
                    <>
                      <span className="text-ink-faint">/</span>
                      <button onClick={() => setActiveChapterId(null)} className={`transition-colors ${!activeChapter ? 'text-ink font-semibold' : 'text-ink-muted hover:text-accent'}`}>{activeVolume.name}</button>
                    </>
                  )}
                  {activeChapter && (
                    <>
                      <span className="text-ink-faint">/</span>
                      <span className="text-ink font-semibold">{activeChapter.name}</span>
                    </>
                  )}
                </div>
              )}

              {/* Chapter view: studio placeholder */}
              {activeChapter && activeVolume && activeManga && (
                <div className="space-y-4">
                  <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                    <Sparkles className="text-accent" size={30} />
                    <h2 className="text-lg font-display font-semibold text-ink">Studio Coming Soon</h2>
                    <p className="text-sm text-ink-muted max-w-md">The new editing studio for "{activeChapter.name}" is being rebuilt. For now you can import and manage pages here.</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Button variant="secondary" size="sm" onClick={() => chapterZipInputRef.current?.click()}>
                        <Upload size={14} /> Import Pages (ZIP)
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteChapter(activeChapter)}>
                        <Trash2 size={14} /> Delete Chapter
                      </Button>
                    </div>
                    <input ref={chapterZipInputRef} type="file" accept=".zip" className="hidden" onChange={handleChapterZipUpload} />
                  </GlassCard>

                  <AdSlot placement="studio-placeholder" />

                  {activeChapter.images.length > 0 && (
                    <GlassCard className="p-5">
                      <h3 className="text-sm font-semibold text-ink mb-3">{activeChapter.images.length} Page(s)</h3>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                        {activeChapter.images.map(img => (
                          <div key={img.id} className="aspect-[2/3] rounded-lg overflow-hidden border border-hairline bg-ink/5">
                            <img src={img.dataUrl} alt={img.filename} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </GlassCard>
                  )}
                </div>
              )}

              {/* Chapter list within volume */}
              {activeVolume && !activeChapter && activeManga && (
                <div className="space-y-3">
                  {activeVolume.chapters.length === 0 && (
                    <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                      <FileStack className="text-ink-faint" size={26} />
                      <p className="text-sm text-ink-muted">No chapters yet. Create one to start building this volume.</p>
                      <Button size="sm" onClick={handleAddChapterPrompt}><Plus size={14} /> Add Chapter</Button>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {activeVolume.chapters.map(chap => (
                      <button
                        key={chap.id}
                        onClick={() => setActiveChapterId(chap.id)}
                        className="group relative text-left"
                      >
                        <GlassCard className="p-4 flex flex-col gap-2 h-full transition-transform group-hover:-translate-y-0.5">
                          <FileStack className="text-accent" size={20} />
                          <span className="text-sm font-semibold text-ink truncate">{chap.name}</span>
                          <span className="text-[11px] text-ink-faint">{chap.images.length} page(s)</span>
                        </GlassCard>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteChapter(chap); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Delete chapter"
                        >
                          <Trash2 size={12} />
                        </button>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Volume list within manga */}
              {activeManga && !activeVolume && (
                <div className="space-y-3">
                  {activeManga.volumes.length === 0 && (
                    <GlassCard className="p-8 flex flex-col items-center text-center gap-3">
                      <Layers className="text-ink-faint" size={26} />
                      <p className="text-sm text-ink-muted">No volumes yet. Create one to start organizing this series.</p>
                      <Button size="sm" onClick={handleAddVolumePrompt}><Plus size={14} /> Add Volume</Button>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {activeManga.volumes.map(vol => (
                      <button key={vol.id} onClick={() => setActiveVolumeId(vol.id)} className="group relative text-left">
                        <GlassCard className="p-4 flex flex-col gap-2 h-full transition-transform group-hover:-translate-y-0.5">
                          <Layers className="text-accent" size={20} />
                          <span className="text-sm font-semibold text-ink truncate">{vol.name}</span>
                          <span className="text-[11px] text-ink-faint">{vol.chapters.length} chapter(s)</span>
                        </GlassCard>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteVolume(vol); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Delete volume"
                        >
                          <Trash2 size={12} />
                        </button>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Series list (root) */}
              {!activeManga && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-display font-semibold text-ink">My Library</h2>
                    <Button size="sm" onClick={() => setShowCreateSeriesModal(true)}><Plus size={14} /> New Series</Button>
                  </div>
                  {mangas.length === 0 && (
                    <GlassCard className="p-10 flex flex-col items-center text-center gap-3">
                      <BookOpen className="text-ink-faint" size={30} />
                      <p className="text-sm text-ink-muted max-w-sm">Your library is empty. Add your first manga or manhwa series to get started.</p>
                      <Button onClick={() => setShowCreateSeriesModal(true)}><Plus size={14} /> Create Series</Button>
                    </GlassCard>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {mangas.map(manga => (
                      <button key={manga.id} onClick={() => setActiveMangaId(manga.id)} className="group relative text-left">
                        <GlassCard className="overflow-hidden flex flex-col h-full transition-transform group-hover:-translate-y-0.5">
                          <div className="aspect-[3/4] bg-gradient-to-br from-accent/25 to-accent/5 flex items-center justify-center overflow-hidden">
                            {manga.coverUrl ? (
                              <img src={manga.coverUrl} alt={manga.title} className="w-full h-full object-cover" />
                            ) : (
                              <BookOpen className="text-accent/60" size={32} />
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-sm font-semibold text-ink truncate">{manga.title}</p>
                            <p className="text-[11px] text-ink-faint uppercase tracking-wide">{manga.type} · {manga.volumes.length} vol(s)</p>
                          </div>
                        </GlassCard>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteManga(manga); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Delete series"
                        >
                          <Trash2 size={12} />
                        </button>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <div className="lg:hidden fixed bottom-[6.5rem] left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-sm">
        <AdSlot placement="bottom-nav" />
      </div>
      <BottomTabBar activeTab={activeNavigationTab} onTabChange={setActiveNavigationTab} onCreatePress={handleCreatePress} />

      {/* Create Series Modal */}
      <Modal
        open={showCreateSeriesModal}
        onClose={() => setShowCreateSeriesModal(false)}
        title="New Series"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateSeriesModal(false)}>Cancel</Button>
            <Button onClick={handleCreateSeries}><Sparkles size={14} /> Create Series</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => coverFileInputRef.current?.click()}
              className="w-20 h-28 rounded-xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
            >
              {newSeriesCoverUrl ? (
                <img src={newSeriesCoverUrl} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={20} className="text-ink-faint" />
              )}
            </button>
            <input ref={coverFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
            <div className="flex-1 space-y-2">
              <Input placeholder="Series title" value={newSeriesTitle} onChange={(e) => setNewSeriesTitle(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                {(['manga', 'manhwa'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setNewSeriesType(t)}
                    className={`py-2 rounded-xl border text-xs font-medium capitalize transition-colors ${newSeriesType === t ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Textarea placeholder="Short description (optional)" value={newSeriesDesc} onChange={(e) => setNewSeriesDesc(e.target.value)} className="h-20" />
        </div>
      </Modal>

      {/* Legal Modals */}
      <Modal open={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} title="Privacy Policy" size="lg">
        <PrivacyPolicy />
      </Modal>
      <Modal open={showTermsModal} onClose={() => setShowTermsModal(false)} title="User Agreement" size="lg">
        <UserAgreement />
      </Modal>
    </div>
  );
}
