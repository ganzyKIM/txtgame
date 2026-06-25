export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          display_name: string | null;
          credits: number;
          is_admin: boolean;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          display_name?: string | null;
          credits?: number;
          is_admin?: boolean;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      quiz_results: {
        Row: {
          id: string;
          user_id: string;
          category: string;
          theme: string;
          answer: string;
          hints_used: number;
          won: boolean;
          score: number;
          rank: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          category: string;
          theme?: string;
          answer: string;
          hints_used: number;
          won: boolean;
          score: number;
          rank: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['quiz_results']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

export type Profile = Database['public']['Tables']['profiles']['Row'];
