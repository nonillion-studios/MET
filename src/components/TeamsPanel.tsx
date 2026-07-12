import { useRef, useState } from 'react';
import { Users, LogOut, ImagePlus, Save } from 'lucide-react';
import { GlassCard, Button, Input } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import { readAvatarFile } from '../lib/image';
import { useTeamAuth, profileFromSession } from '../lib/teamAuth';

export function TeamsPanel() {
  const { session, signOut, updateProfile } = useTeamAuth();
  const profile = profileFromSession(session);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Enter a name for your profile.' });
      return;
    }
    setSaving(true);
    const error = await updateProfile(name.trim(), avatar);
    setSaving(false);
    if (error) {
      swal({ icon: 'error', title: 'Update failed', text: error });
      return;
    }
    swalToast({ icon: 'success', title: 'Profile updated' });
  };

  const handleSwitchAccount = async () => {
    const result = await swal({
      icon: 'question',
      title: 'Switch accounts?',
      text: "You'll be signed out and can sign in with a different profile.",
      showCancelButton: true,
      confirmButtonText: 'Switch Account',
    });
    if (result.isConfirmed) await signOut();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-hairline pb-4">
        <div>
          <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-2">
            <Users className="text-accent" size={20} /> Teams
          </h2>
          <p className="text-xs text-ink-muted mt-0.5">Signed in as {session?.user.email}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleSwitchAccount}>
          <LogOut size={14} /> Switch Account
        </Button>
      </div>

      <GlassCard className="p-6 space-y-4 max-w-md">
        <h3 className="text-base font-semibold text-ink font-display">Your Profile</h3>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="w-16 h-16 rounded-full border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
          >
            {avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : <ImagePlus size={18} className="text-ink-faint" />}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setAvatar); }} />
          <div className="flex-1 space-y-1">
            <label className="text-xs text-accent font-semibold">Name</label>
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="w-full">
          <Save size={14} /> {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </GlassCard>
    </div>
  );
}
