import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useEditor } from '../../editor/store';
import { LockIcon } from '../icons';

export function PasswordDialog() {
  const passwordError = useEditor((s) => s.passwordError);
  const loading = useEditor((s) => s.status === 'loading');
  const submitPassword = useEditor((s) => s.submitPassword);
  const cancelPassword = useEditor((s) => s.cancelPassword);
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [passwordError]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitPassword(password);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-900/30 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={(e) => e.key === 'Escape' && cancelPassword()}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <LockIcon className="h-5 w-5 text-neutral-500" />
          <h2 id={titleId} className="text-base font-semibold text-neutral-900">
            Password required
          </h2>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          This PDF is protected. Enter its password to open it.
        </p>
        <label htmlFor={inputId} className="mt-4 block text-sm font-medium text-neutral-700">
          Password
        </label>
        <input
          ref={input}
          id={inputId}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={passwordError}
          aria-describedby={passwordError ? `${inputId}-error` : undefined}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
        {passwordError && (
          <p id={`${inputId}-error`} className="mt-2 text-sm text-red-700">
            Wrong password. Try again.
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelPassword}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
