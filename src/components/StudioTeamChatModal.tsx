import { useEffect, useState } from 'react';
import { Modal, SkeletonCard } from './ui';
import { ChatSection } from './TeamsPanel';
import { getMyMembership, listTeamMembers, type Team, type TeamMember } from '../lib/teams';
import type { CloudClient } from '../lib/cloudClient';

/** So a user can check their team chat without leaving Studio's fullscreen canvas — reuses the
 *  exact same ChatSection TeamsPanel's own workspace renders, just fed the current user's active
 *  team/membership directly rather than through TeamsPanel's own top-level state. */
export function StudioTeamChatModal({ open, onClose, cc }: { open: boolean; onClose: () => void; cc: CloudClient }) {
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [role, setRole] = useState<'member' | 'leader'>('member');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const membership = await getMyMembership();
    if (!membership) {
      setTeam(null);
      setLoading(false);
      return;
    }
    setTeam(membership.team);
    setRole(membership.role);
    setMyMemberId(membership.id);
    setMembers(await listTeamMembers(membership.team_id));
    setLoading(false);
  };

  useEffect(() => { if (open) refresh(); }, [open]);

  const myMember = members.find(m => m.id === myMemberId) || null;

  return (
    <Modal open={open} onClose={onClose} title="Team Chat" size="lg">
      {loading ? (
        <SkeletonCard className="h-96" />
      ) : !team ? (
        <p className="text-sm text-ink-muted text-center py-10">You're not part of a team yet.</p>
      ) : (
        <div className="h-[70vh]">
          <ChatSection
            team={team}
            members={members}
            myMember={myMember}
            isOwner={false}
            canManage={role === 'leader'}
            onChanged={refresh}
            cc={cc}
          />
        </div>
      )}
    </Modal>
  );
}
