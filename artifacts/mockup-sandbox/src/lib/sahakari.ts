import { supabase } from "./supabase";
export { adToBs, kathmanduNow, monthDateRange, shouldShowSahakariReminder } from "./kathmanduTime";

export const SAHAKARI_NAME = "Subha Bitta Multipurpose Co-operative Ltd.";

export type Cooperative = {
  id: string;
  name: string;
  defaultDailyAmount: number;
};

export type CooperativeEntry = {
  id: string;
  cooperativeId: string;
  entryDate: string;
  deposited: boolean;
  amount: number | null;
  reason: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
};

export async function loadSahakari(): Promise<{ cooperatives: Cooperative[]; entries: CooperativeEntry[] }> {
  const { data: cooperatives, error: cooperativeError } = await supabase
    .from("cooperatives")
    .select("id, name, default_daily_amount")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (cooperativeError) throw new Error(cooperativeError.message);

  const entries: Array<{ id: string; cooperative_id: string; entry_date: string; deposited: boolean; amount: number | null; reason: string | null; recorded_by: string | null; recorded_by_name: string | null }> = [];
  for (let offset = 0; ; offset += 500) {
    const { data: page, error: entriesError } = await supabase
      .from("cooperative_entries")
      .select("id, cooperative_id, entry_date, deposited, amount, reason, recorded_by, recorded_by_name")
      .order("entry_date", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (entriesError) throw new Error(entriesError.message);
    entries.push(...(page ?? []));
    if (!page || page.length < 500) break;
  }

  const { data: recorders, error: recordersError } = await supabase.rpc("cooperative_recorder_names");
  if (recordersError) throw new Error(recordersError.message);
  const names = new Map<string, string | null>((recorders ?? []).map((recorder: { user_id: string; full_name: string | null }) =>
    [recorder.user_id, recorder.full_name?.trim() || null]));

  return {
    cooperatives: (cooperatives ?? []).map((cooperative) => ({
      id: cooperative.id,
      name: cooperative.name,
      defaultDailyAmount: Number(cooperative.default_daily_amount),
    })),
    entries: entries.map((entry) => ({
      id: entry.id,
      cooperativeId: entry.cooperative_id,
      entryDate: entry.entry_date,
      deposited: entry.deposited,
      amount: entry.amount === null ? null : Number(entry.amount),
      reason: entry.reason,
      recordedBy: entry.recorded_by,
      recordedByName: entry.recorded_by ? names.get(entry.recorded_by) ?? entry.recorded_by_name : entry.recorded_by_name,
    })),
  };
}
