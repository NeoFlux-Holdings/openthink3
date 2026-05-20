/* Tiny event bus for cross-screen signals — currently used so the TabBar
 * can tell a screen "your tab was tapped again, scroll yourself to top."
 *
 * We deliberately don't use React context because the emitter sits at a
 * different level than the listeners and we want zero re-renders on emit.
 */

type Listener<T> = (payload: T) => void;

class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(payload: T): void {
    this.listeners.forEach((l) => {
      try {
        l(payload);
      } catch {
        /* ignore — never let a stray listener kill the emit */
      }
    });
  }
}

/** Fired when the user taps an already-active TabBar slot. iOS convention is to
 * scroll the visible scroll view to top. Payload is the TabKey ('today' etc). */
export const tabReTapped = new EventEmitter<string>();
