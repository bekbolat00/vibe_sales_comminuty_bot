import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://mgdrugepjudttjxgedvp.supabase.co";
const SB_KEY = "sb_publishable_X_5OwtCeeKQRHa36JLJedA_qo84O6YA";

export const supabase = createClient(SB_URL, SB_KEY);
