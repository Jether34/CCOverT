export interface ActivityEntry {
  at: string;
  kind: 'request' | 'change';
  action: string;
  actorId: string | null;
  status?: number;
}

const recent: ActivityEntry[] = [];
export function recordActivity(entry: Omit<ActivityEntry, 'at'>): void {
  recent.unshift({ at: new Date().toISOString(), ...entry });
  if (recent.length > 200) recent.length = 200;
}
export function listActivity(): ActivityEntry[] { return recent.slice(); }
