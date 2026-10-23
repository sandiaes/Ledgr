import { createClient } from '@supabase/supabase-js';
import { assertPublicKey } from '@ledgr/client';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url) throw new Error('VITE_SUPABASE_URL is not set');
assertPublicKey(key, 'VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(url, key);
