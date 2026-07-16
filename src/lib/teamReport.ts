import { downloadBlob } from './textEditorExport';
import type { Team, TeamMember } from './teams';
import type { Task } from './tasks';
import type { Transaction } from './wallet';

export interface TeamReportData {
  team: Team;
  members: TeamMember[];
  tasks: Task[];
  transactions: Transaction[];
}

function monthAgo(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d;
}

export function buildTeamReportSummary(data: TeamReportData) {
  const since = monthAgo();
  const recentTasks = data.tasks.filter(t => new Date(t.created_at) >= since);
  const doneTasks = recentTasks.filter(t => t.status === 'done');
  const recentPayouts = data.transactions.filter(t => new Date(t.created_at) >= since);
  const totalPaid = recentPayouts.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0);

  return {
    teamName: data.team.name,
    periodLabel: `${since.toLocaleDateString()} – ${new Date().toLocaleDateString()}`,
    memberCount: data.members.filter(m => m.status === 'active').length,
    tasksCreated: recentTasks.length,
    tasksCompleted: doneTasks.length,
    completionRate: recentTasks.length > 0 ? Math.round((doneTasks.length / recentTasks.length) * 100) : 0,
    totalPaid,
    topMembers: [...data.members]
      .filter(m => m.status === 'active')
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map(m => ({ name: m.profile?.name || m.invited_email, balance: m.balance })),
  };
}

export async function exportTeamReportDocx(data: TeamReportData): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const s = buildTeamReportSummary(data);

  const children = [
    new Paragraph({ text: `${s.teamName} — Monthly Report`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: s.periodLabel }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: 'Overview', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ children: [new TextRun(`Active members: ${s.memberCount}`)] }),
    new Paragraph({ children: [new TextRun(`Tasks created: ${s.tasksCreated}`)] }),
    new Paragraph({ children: [new TextRun(`Tasks completed: ${s.tasksCompleted} (${s.completionRate}%)`)] }),
    new Paragraph({ children: [new TextRun(`Total paid out: $${s.totalPaid.toFixed(2)}`)] }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: 'Top Earners', heading: HeadingLevel.HEADING_2 }),
    ...s.topMembers.map(m => new Paragraph({ children: [new TextRun(`${m.name} — $${m.balance.toFixed(2)}`)] })),
  ];

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${s.teamName}-report.docx`);
}

export function exportTeamReportTxt(data: TeamReportData): void {
  const s = buildTeamReportSummary(data);
  const lines = [
    `${s.teamName} — Monthly Report`,
    s.periodLabel,
    '',
    'Overview',
    `Active members: ${s.memberCount}`,
    `Tasks created: ${s.tasksCreated}`,
    `Tasks completed: ${s.tasksCompleted} (${s.completionRate}%)`,
    `Total paid out: $${s.totalPaid.toFixed(2)}`,
    '',
    'Top Earners',
    ...s.topMembers.map(m => `${m.name} — $${m.balance.toFixed(2)}`),
  ];
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain' }), `${s.teamName}-report.txt`);
}
