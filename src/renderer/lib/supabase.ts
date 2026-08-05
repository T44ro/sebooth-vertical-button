import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hfheuhivhwooaobgjtqv.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmaGV1aGl2aHdvb2FvYmdqdHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MDM3MDMsImV4cCI6MjA4OTI3OTcwM30.rN_R3eyhYPZmpOa7r921Eoo5rAJMxlgcWkv0vwQZohc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export function getSupabase(): SupabaseClient {
    return supabase
}

export function isSupabaseConfigured(): boolean {
    return !!supabaseUrl && !!supabaseAnonKey
}

export interface SessionHistoryItem {
    id: string
    session_id?: string
    email?: string
    print_count: number
    gallery_url?: string
    frame_name?: string
    created_at: string
}

export async function getSessionHistory(options: { limit?: number; offset?: number } = {}): Promise<{ data: SessionHistoryItem[]; total: number } | { error: string }> {
    try {
        const { limit = 20, offset = 0 } = options
        
        const { data, error, count } = await supabase
            .from('sessions')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error

        return {
            data: data as SessionHistoryItem[],
            total: count || 0
        }
    } catch (err: any) {
        console.error('Failed to fetch session history:', err)
        return { error: err.message }
    }
}
