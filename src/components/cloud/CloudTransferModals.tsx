import { Modal } from '../ui';
import { AdSlot } from '../AdSlot';
import type { CloudClient } from '../../lib/cloudClient';

// Mounted once at the app root (not inside CloudFiles/the Cloud tab) so
// upload/download/restore progress is visible no matter which nav tab is
// active — e.g. a backup started from a Library "Upload to Telecloud"
// button used to show no feedback at all unless the Cloud tab happened to
// also be mounted.
export function CloudTransferModals({ cc }: { cc: CloudClient }) {
  const uploadedBytes = Math.round(cc.uploadTotalBytes * (cc.uploadProgress / 100));

  return (
    <>
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

      <Modal open={cc.isDownloading} onClose={() => {}} dismissible={false} title="Downloading from Cloud" size="sm">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink truncate">{cc.downloadLabel}</p>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{cc.formatSize(Math.round(cc.downloadTotalBytes * (cc.downloadProgress / 100)))} / {cc.formatSize(cc.downloadTotalBytes)}</p>
          </div>
          <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 bg-accent h-full transition-all duration-300" style={{ width: `${cc.downloadProgress}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">{cc.downloadProgress}%</span>
          </div>
          <AdSlot placement="download-progress" />
        </div>
      </Modal>

      <Modal open={cc.isRestoring} onClose={() => {}} dismissible={false} title="Fetching from Cloud" size="sm">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink truncate">{cc.restoreLabel}</p>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{cc.formatSize(Math.round(cc.restoreTotalBytes * (cc.restoreProgress / 100)))} / {cc.formatSize(cc.restoreTotalBytes)}</p>
          </div>
          <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 bg-accent h-full transition-all duration-300" style={{ width: `${cc.restoreProgress}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">{cc.restoreProgress}%</span>
          </div>
          <AdSlot placement="restore-progress" />
        </div>
      </Modal>
    </>
  );
}
