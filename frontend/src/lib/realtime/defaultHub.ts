import { supabase } from '../supabase';
import { createLiveHub } from './liveHub';
import type { LiveHub } from './liveHub';

let hub: LiveHub | null = null;

export function getLiveHub(): LiveHub {
    hub ??= createLiveHub(supabase);
    return hub;
}
