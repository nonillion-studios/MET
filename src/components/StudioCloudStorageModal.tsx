import { Modal } from './ui';
import { CloudStorage } from './CloudStorage';
import type { CloudClient } from '../lib/cloudClient';
import type { AutomationEngine } from '../lib/automationEngine';
import type { Workspace } from '../types';

/** So a user can grab a file from Cloud Storage without leaving Studio's fullscreen canvas —
 *  the exact same CloudStorage the top-level Cloud nav tab renders, just wrapped in a modal. */
export function StudioCloudStorageModal({
  open, onClose, cc, workspaces, onImportWorkspace, automationEngine,
}: {
  open: boolean;
  onClose: () => void;
  cc: CloudClient;
  workspaces: Workspace[];
  onImportWorkspace: (workspace: Workspace) => void;
  automationEngine: AutomationEngine;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Cloud Storage" size="xl">
      <div className="max-h-[75vh] overflow-y-auto">
        <CloudStorage cc={cc} workspaces={workspaces} onImportWorkspace={onImportWorkspace} automationEngine={automationEngine} />
      </div>
    </Modal>
  );
}
