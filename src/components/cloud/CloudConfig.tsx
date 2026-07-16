import { Smartphone, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { Input, Button, GlassCard } from '../ui';
import type { CloudClient } from '../../lib/cloudClient';

export function CloudConfig({ cc }: { cc: CloudClient }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-lg mx-auto w-full"
    >
      <GlassCard className="p-6">
        <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
          <Smartphone className="text-accent" /> Connect Telecloud
        </h2>

        {!cc.isConnected ? (
          <div className="space-y-4">
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
    </motion.div>
  );
}
