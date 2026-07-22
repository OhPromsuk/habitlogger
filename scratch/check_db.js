import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://skakczszxlkldhgekcsc.supabase.co";
const supabaseAnonKey = "sb_publishable_vC_MMn2o6msJC9h_45V8jA_BzKkjojF";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
    const { data: cats } = await supabase.from('categories').select('*');
    const { data: acts } = await supabase.from('activities').select('*');
    console.log("CATEGORIES:");
    console.dir(cats, { depth: null });
    console.log("ACTIVITIES:");
    console.dir(acts, { depth: null });
}

check();
