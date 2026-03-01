import type { SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  FRONTEND_ORIGIN?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  ADMIN_API_KEY?: string;
  ADMIN_PASSWORD_ENCRYPTION_KEY?: string;
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  frontendOrigin: string;
  cloudinaryCloudName: string;
  cloudinaryApiKey: string | null;
  cloudinaryApiSecret: string | null;
  adminApiKey: string | null;
  adminPasswordEncryptionKey: string | null;
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          password_hash: string | null;
          password_ciphertext: string | null;
          trust_score: number;
          recovery_key_hash: string;
          bio: string | null;
          avatar_url: string | null;
          is_active: boolean;
          is_banned: boolean;
          is_shadow_banned: boolean;
          deactivated_at: string | null;
          banned_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash?: string | null;
          password_ciphertext?: string | null;
          trust_score?: number;
          recovery_key_hash: string;
          bio?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          is_banned?: boolean;
          is_shadow_banned?: boolean;
          deactivated_at?: string | null;
          banned_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string | null;
          password_ciphertext?: string | null;
          trust_score?: number;
          recovery_key_hash?: string;
          bio?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          is_banned?: boolean;
          is_shadow_banned?: boolean;
          deactivated_at?: string | null;
          banned_at?: string | null;
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
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          device_hash?: string | null;
          created_at?: string;
          last_active?: string;
          expires_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          token_hash?: string;
          device_hash?: string | null;
          created_at?: string;
          last_active?: string;
          expires_at?: string | null;
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
          video_url: string | null;
          image_blurhash: string | null;
          image_public_id: string | null;
          video_public_id: string | null;
          created_at: string;
          expires_at: string;
          trust_weight: number;
          report_count: number;
          hidden: boolean;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          channel: string;
          content: string;
          image_url?: string | null;
          video_url?: string | null;
          image_blurhash?: string | null;
          image_public_id?: string | null;
          video_public_id?: string | null;
          created_at?: string;
          expires_at: string;
          trust_weight?: number;
          report_count?: number;
          hidden?: boolean;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          channel?: string;
          content?: string;
          image_url?: string | null;
          video_url?: string | null;
          image_blurhash?: string | null;
          image_public_id?: string | null;
          video_public_id?: string | null;
          created_at?: string;
          expires_at?: string;
          trust_weight?: number;
          report_count?: number;
          hidden?: boolean;
          deleted_at?: string | null;
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
      post_reactions: {
        Row: {
          post_id: string;
          user_id: string;
          reaction_type: "like" | "dislike" | "emoji";
          emoji: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          post_id: string;
          user_id: string;
          reaction_type: "like" | "dislike" | "emoji";
          emoji?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          post_id?: string;
          user_id?: string;
          reaction_type?: "like" | "dislike" | "emoji";
          emoji?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_posts: {
        Row: {
          user_id: string;
          post_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          post_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          post_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_posts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_posts_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      advice_posts: {
        Row: {
          id: string;
          user_id: string;
          content: string;
          created_at: string;
          hidden: boolean;
          report_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          content: string;
          created_at?: string;
          hidden?: boolean;
          report_count?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          content?: string;
          created_at?: string;
          hidden?: boolean;
          report_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "advice_posts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      advice_replies: {
        Row: {
          id: string;
          advice_id: string;
          user_id: string;
          content: string;
          created_at: string;
          hidden: boolean;
          report_count: number;
        };
        Insert: {
          id?: string;
          advice_id: string;
          user_id: string;
          content: string;
          created_at?: string;
          hidden?: boolean;
          report_count?: number;
        };
        Update: {
          id?: string;
          advice_id?: string;
          user_id?: string;
          content?: string;
          created_at?: string;
          hidden?: boolean;
          report_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "advice_replies_advice_id_fkey";
            columns: ["advice_id"];
            isOneToOne: false;
            referencedRelation: "advice_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "advice_replies_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          actor_id: string | null;
          type: string;
          entity_type: string | null;
          entity_id: string | null;
          title: string;
          body: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_id: string;
          actor_id?: string | null;
          type: string;
          entity_type?: string | null;
          entity_id?: string | null;
          title: string;
          body: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          recipient_id?: string;
          actor_id?: string | null;
          type?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          title?: string;
          body?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_actions: {
        Row: {
          id: string;
          action: string;
          target_user_id: string | null;
          target_post_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          action: string;
          target_user_id?: string | null;
          target_post_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          action?: string;
          target_user_id?: string | null;
          target_post_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_actions_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "admin_actions_target_post_id_fkey";
            columns: ["target_post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      user_request_logs: {
        Row: {
          id: string;
          user_id: string;
          session_id: string | null;
          ip_address: string;
          method: string;
          path: string;
          user_agent: string | null;
          cf_country: string | null;
          cf_region: string | null;
          cf_city: string | null;
          cf_colo: string | null;
          cf_asn: number | null;
          cf_ray: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id?: string | null;
          ip_address: string;
          method: string;
          path: string;
          user_agent?: string | null;
          cf_country?: string | null;
          cf_region?: string | null;
          cf_city?: string | null;
          cf_colo?: string | null;
          cf_asn?: number | null;
          cf_ray?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string | null;
          ip_address?: string;
          method?: string;
          path?: string;
          user_agent?: string | null;
          cf_country?: string | null;
          cf_region?: string | null;
          cf_city?: string | null;
          cf_colo?: string | null;
          cf_asn?: number | null;
          cf_ray?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_request_logs_user_id_fkey";
            columns: ["user_id"];
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
  username: string;
  isBanned: boolean;
  isShadowBanned: boolean;
  isActive: boolean;
}

export interface AppContext {
  request: Request;
  env: Env;
  executionCtx: ExecutionContext;
  requestId: string;
  config: AppConfig;
  supabase: SupabaseClient<Database>;
  session: SessionIdentity | null;
}
