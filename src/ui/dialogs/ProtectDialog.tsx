import { useId, useState } from 'react';
import { useEditor } from '../../editor/store';
import type { Permissions } from '../../shared/types';

const PERMISSIONS: { key: keyof Permissions; label: string }[] = [
  { key: 'print', label: 'Printing' },
  { key: 'copy', label: 'Copying text and images' },
  { key: 'edit', label: 'Editing pages' },
  { key: 'annotate', label: 'Comments and annotations' },
  { key: 'forms', label: 'Filling in forms' },
];

/** A password nobody knows: restrictions that can't be lifted later. */
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('');
}

/** Spec §6 Phase 6: set or remove a password (AES-256) and permissions on download. */
export function ProtectDialog({ onClose }: { onClose: () => void }) {
  const download = useEditor((s) => s.download);
  const isProtected = useEditor((s) => s.isProtected);
  const [user, setUser] = useState('');
  const [confirm, setConfirm] = useState('');
  const [owner, setOwner] = useState('');
  const [perms, setPerms] = useState<Permissions>({
    print: true,
    copy: true,
    edit: true,
    annotate: true,
    forms: true,
  });
  const titleId = useId();
  const restricted = Object.values(perms).some((v) => !v);
  const error =
    user !== confirm
      ? "The passwords don't match"
      : /[,=]/.test(user + owner)
        ? 'Passwords can’t contain a comma or "="'
        : !user && !owner
          ? 'Enter a password to open the file, or a permissions password'
          : restricted && !owner && !user
            ? 'Restrictions need a permissions password'
            : null;

  const field = 'mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Password protection
        </h2>
        {isProtected && (
          <div className="mt-4 rounded-md border border-slate-200 p-3 text-sm">
            <p className="text-slate-700">This PDF is password-protected.</p>
            <button
              type="button"
              onClick={() => {
                void download({ security: { kind: 'remove' } });
                onClose();
              }}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download without a password
            </button>
          </div>
        )}
        <div className="mt-4 space-y-3 text-sm">
          <label className="block text-slate-700">
            Password to open the file
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Open password"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className={field}
            />
          </label>
          <label className="block text-slate-700">
            Repeat it
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Repeat open password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={field}
            />
          </label>
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-slate-700">Allow</legend>
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={perms[p.key]}
                  onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })}
                />
                {p.label}
              </label>
            ))}
          </fieldset>
          <label className="block text-slate-700">
            Permissions password{' '}
            <span className="text-slate-500">(lets you change the restrictions later)</span>
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Permissions password"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className={field}
            />
          </label>
        </div>
        {error && (user || confirm || owner) && (
          <p className="mt-3 text-sm text-red-700">{error}</p>
        )}
        {!error && restricted && !owner && (
          <p className="mt-3 text-xs text-amber-800">
            Without a permissions password, these restrictions can&apos;t be lifted later, not even
            by you.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Encrypted with AES-256 in this tab. Passwords are never stored or sent.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(error)}
            onClick={() => {
              void download({
                security: {
                  kind: 'set',
                  userPassword: user,
                  // With restrictions the owner password must differ from the open password,
                  // or opening the file would also lift the restrictions.
                  ownerPassword: owner || (restricted ? randomPassword() : user),
                  permissions: perms,
                },
              });
              onClose();
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Download protected
          </button>
        </div>
      </div>
    </div>
  );
}
