import { Smartphone, CheckCircle, HelpCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { Input, Button, GlassCard } from '../ui';
import type { CloudClient } from '../../lib/cloudClient';

export function CloudConfig({ cc }: { cc: CloudClient }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="grid grid-cols-1 md:grid-cols-2 gap-6"
    >
      <GlassCard className="p-6">
        <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
          <Smartphone className="text-accent" /> Connect Telegram (GramJS)
        </h2>

        {!cc.isConnected ? (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted leading-relaxed mb-4">
              We use the GramJS library to connect to Telegram's encrypted network directly from your browser. This happens entirely client-side with no intermediary server. Your keys are stored locally in your browser only.
            </p>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold">API ID</label>
              <Input type="text" value={cc.apiId} onChange={e => cc.setApiId(e.target.value)} placeholder="e.g. 1234567" dir="ltr" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold">API Hash</label>
              <Input type="text" value={cc.apiHash} onChange={e => cc.setApiHash(e.target.value)} placeholder="Enter your developer API Hash" dir="ltr" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold">International Phone Number</label>
              <Input type="text" value={cc.phoneNumber} onChange={e => cc.setPhoneNumber(e.target.value)} placeholder="+201012345678" dir="ltr" />
            </div>
            <Button onClick={cc.handleLogin} disabled={cc.isLoading} className="w-full mt-4">
              {cc.isLoading ? 'Connecting...' : 'Request Verification Code (Login)'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-success/10 border border-success/30 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="text-success" size={24} />
              <div>
                <h3 className="text-success font-bold text-sm">Connected to Telegram servers!</h3>
                <p className="text-xs text-success/70">Your session is encrypted and stored locally.</p>
              </div>
            </div>

            <div className="space-y-1 mt-4">
              <label className="text-xs text-accent font-semibold flex items-center justify-between">
                Storage Channel or Group ID (Chat ID)
                <span className="text-[10px] text-ink-faint">e.g. -100123456789</span>
              </label>
              <Input type="text" value={cc.chatId} onChange={e => cc.setChatId(e.target.value)} placeholder="-100..." dir="ltr" />
            </div>

            <div className="flex gap-2">
              <Button onClick={cc.saveConfig} className="flex-1" size="sm">Save Settings</Button>
              <Button onClick={cc.handleDisconnect} variant="danger" size="sm">Log Out</Button>
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6">
        <h3 className="text-lg font-bold text-ink mb-4 flex items-center gap-2">
          <HelpCircle className="text-ink-muted" size={18} /> How does client-side cloud storage work?
        </h3>
        <div className="space-y-4">
          {[
            { title: 'Get your API keys', desc: <>You'll need an <code className="bg-ink/10 px-1 py-0.5 rounded text-accent">API_ID</code> and <code className="bg-ink/10 px-1 py-0.5 rounded text-accent">API_HASH</code> from <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-accent hover:underline">my.telegram.org</a>.</> },
            { title: 'It stays encrypted, on your device', desc: 'The app uses your browser purely as a client. Your Telegram session is stored encrypted in your browser (localStorage) — nothing touches an intermediary server.' },
            { title: 'Point it at a storage channel', desc: 'Create a Telegram channel or group and copy its ID (forward a message to a bot like @userinfobot) into the Chat ID field.' },
            { title: 'Metadata rides along with each upload', desc: 'Every file or workspace backup carries a small JSON structure (name, notes, tags, size) so the app can display it on the dashboard.' },
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-accent-soft border border-accent/30 text-accent text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <div>
                <p className="text-sm font-semibold text-ink">{step.title}</p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  );
}
