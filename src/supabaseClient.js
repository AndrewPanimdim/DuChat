import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kapltgjrcrjhnntgzeaw.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcGx0Z2pyY3JqaG5udGd6ZWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwNzQwNDksImV4cCI6MjA3OTY1MDA0OX0.ZfBfpWCi09mZb0ROq_KIf8Ts1Eg9G2DxVU34S1TvY1c'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)