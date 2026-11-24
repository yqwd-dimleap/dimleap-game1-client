export class EventBus<Events extends object> {
    private listeners = new Map<keyof Events, Set<(value: any) => void>>();
    on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
        let group = this.listeners.get(event);
        if (!group) this.listeners.set(event, group = new Set());
        group.add(listener);
        return () => { group!.delete(listener); if (!group!.size) this.listeners.delete(event); };
    }
    emit<K extends keyof Events>(event: K, value: Events[K]): void {
        // A listener may unsubscribe while handling an event.
        for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(value);
    }
}
