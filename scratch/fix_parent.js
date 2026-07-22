import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://skakczszxlkldhgekcsc.supabase.co";
const supabaseAnonKey = "sb_publishable_vC_MMn2o6msJC9h_45V8jA_BzKkjojF";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function fix() {
    const { data, error } = await supabase.from('categories')
        .update({ parent_id: null })
        .eq('name', 'ทำสมาธิ');
    console.log("Updated category:", data, error);
}

fix();
