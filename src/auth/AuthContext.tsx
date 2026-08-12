import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/database.types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** 서버가 돌려준 잔액으로 화면 크레딧을 즉시 갱신 */
  applyBalance: (balance: number) => void;
  /** DB에서 프로필을 다시 읽어 동기화 */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 로그인 왕복 동안 초대 링크 쿼리(?gomoku_room=... 등)를 보관하는 키.
 * redirectTo에 현재 URL 전체를 넘기면 Supabase 대시보드의 Redirect URL
 * 허용 목록과 정확히 일치하지 않아 세션 없이 돌아오는 문제(로그인 무한
 * 반복)가 생긴다. 그래서 redirectTo는 항상 origin으로 고정하고, 쿼리는
 * 여기 담아 두었다가 로그인 완료 후 URL에 복원한다.
 */
const INVITE_QUERY_KEY = 'txtgame:pending-invite-query';

function stashInviteQuery() {
  try {
    const search = window.location.search;
    if (/(?:gomoku|holdem|multi)_room=/.test(search)) {
      sessionStorage.setItem(INVITE_QUERY_KEY, search);
    }
  } catch {
    // 스토리지가 막힌 환경(일부 인앱 브라우저) — 초대 복원만 포기
  }
}

function restoreInviteQuery() {
  try {
    const saved = sessionStorage.getItem(INVITE_QUERY_KEY);
    if (!saved) return;
    sessionStorage.removeItem(INVITE_QUERY_KEY);
    // 이미 쿼리가 있으면(직접 초대 링크로 재진입 등) 덮어쓰지 않는다
    if (!window.location.search) {
      window.history.replaceState(null, '', window.location.pathname + saved + window.location.hash);
    }
  } catch {
    // 무시 — 초대 자동 참가만 안 될 뿐 로그인은 정상 진행
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error) setProfile(data);
    } catch {
      // profiles 테이블이 없거나 RLS 오류 — 무시하고 진행
    }
  }

  function applyBalance(balance: number) {
    setProfile((p) => (p ? { ...p, credits: balance } : p));
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id);
  }

  useEffect(() => {
    // OAuth 리디렉션 후 해시를 포함한 세션 처리
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) restoreInviteQuery();
      setSession(session);
      if (session?.user) void loadProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) restoreInviteQuery();
      setSession(session);
      if (session?.user) {
        void loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
      // SIGNED_IN 이벤트에서도 로딩 해제 보장
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    // 초대 링크의 쿼리는 스토리지로 보존한다 — redirectTo에 현재 URL을
    // 그대로 넘기면 허용 목록 불일치로 로그인이 무한 반복될 수 있음.
    stashInviteQuery();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // 리디렉션이 시작되지 않은 실패(설정 오류 등)는 화면에 알릴 수 있게 던진다
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signInWithGoogle,
        signOut,
        applyBalance,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
