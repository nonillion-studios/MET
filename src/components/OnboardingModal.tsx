import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Modal, Button, Input } from './ui';
import { AvatarPicker } from './AvatarPicker';
import { swal } from '../lib/swalTheme';
import { getProfile, saveProfile } from '../lib/profile';

export function OnboardingModal({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [avatar, setAvatar] = useState(getProfile().avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=nova');

  const handleSave = () => {
    if (!name.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Let your team know who you are.' });
      return;
    }
    saveProfile({ name: name.trim(), teamName: teamName.trim(), avatar });
    onDone();
  };

  return (
    <Modal open onClose={() => {}} dismissible={false} title="Welcome to MangaAI Studio" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">Tell your team who you are. You can change this anytime from Settings.</p>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Your Name</label>
          <Input placeholder="e.g. Alex" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Team Name</label>
          <Input placeholder="e.g. Midnight Scans" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold block">Avatar</label>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
        <Button onClick={handleSave} className="w-full mt-2" size="lg">
          <Sparkles size={14} /> Get Started
        </Button>
      </div>
    </Modal>
  );
}
