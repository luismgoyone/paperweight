import type { Op } from '../shared/types';

/**
 * The op log (spec §3.3). The document is "original bytes + ops[0..cursor)".
 * Undo/redo only move the cursor; the engine converges to `active`.
 */
export class History {
  private log: Op[] = [];
  private position = 0;
  // Saved state is identified by the exact op prefix that was saved; null = original file.
  private savedLog: Op[] | null = [];

  get ops(): readonly Op[] {
    return this.log;
  }

  get cursor(): number {
    return this.position;
  }

  get active(): Op[] {
    return this.log.slice(0, this.position);
  }

  get canUndo(): boolean {
    return this.position > 0;
  }

  get canRedo(): boolean {
    return this.position < this.log.length;
  }

  get dirty(): boolean {
    const active = this.active;
    const saved = this.savedLog;
    return !(saved && saved.length === active.length && saved.every((o, i) => o === active[i]));
  }

  push(op: Op): void {
    this.log = [...this.log.slice(0, this.position), op];
    this.position = this.log.length;
  }

  undo(): void {
    if (this.canUndo) this.position--;
  }

  redo(): void {
    if (this.canRedo) this.position++;
  }

  /** Drops the op just pushed because the engine refused it (spec §7). */
  rejectLast(): void {
    if (this.position === 0) return;
    this.log = this.log.slice(0, this.position - 1);
    this.position = this.log.length;
  }

  markSaved(): void {
    this.savedLog = this.active;
  }

  reset(): void {
    this.log = [];
    this.position = 0;
    this.savedLog = [];
  }
}
