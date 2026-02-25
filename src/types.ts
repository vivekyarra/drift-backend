import type { SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          trust_score: number;
          recovery_key_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          trust_score?: number;
          recovery_key_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          trust_score?: number;
          recovery_key_hash?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          device_hash: string | null;
          created_at: string;
          last_active: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          device_hash?: string | null;
          created_at?: string;
          last_active?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          token_hash?: string;
          device_hash?: string | null;
          created_at?: string;
          last_active?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          id: string;
          user_id: string;
          channel: string;
          content: string;
          image_url: string | null;
          image_blurhash: string | null;
          created_at: string;
          expires_at: string;
          trust_weight: number;
          report_count: number;
          hidden: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          channel: string;
          content: string;
          image_url?: string | null;
          image_blurhash?: string | null;
          created_at?: string;
          expires_at: string;
          trust_weight?: number;
          report_count?: number;
          hidden?: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          channel?: string;
          content?: string;
          image_url?: string | null;
          image_blurhash?: string | null;
          created_at?: string;
          expires_at?: string;
          trust_weight?: number;
          report_count?: number;
          hidden?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "posts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          id: string;
          post_id: string;
          user_id: string;
          content: string;
          created_at: string;
          report_count: number;
          hidden: boolean;
        };
        Insert: {
          id?: string;
          post_id: string;
          user_id: string;
          content: string;
          created_at?: string;
          report_count?: number;
          hidden?: boolean;
        };
        Update: {
          id?: string;
          post_id?: string;
          user_id?: string;
          content?: string;
          created_at?: string;
          report_count?: number;
          hidden?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          id: string;
          content_type: string;
          content_id: string;
          reporter_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          content_type: string;
          content_id: string;
          reporter_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          content_type?: string;
          content_id?: string;
          reporter_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      follows: {
        Row: {
          follower_id: string;
          following_id: string;
          created_at: string;
        };
        Insert: {
          follower_id: string;
          following_id: string;
          created_at?: string;
        };
        Update: {
          follower_id?: string;
          following_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          conversation_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export interface SessionIdentity {
  userId: string;
  sessionId: string;
}

export interface AppContext {
  request: Request;
  env: Env;
  executionCtx: ExecutionContext;
  config: AppConfig;
  supabase: SupabaseClient<Database>;
  session: SessionIdentity | null;
}
