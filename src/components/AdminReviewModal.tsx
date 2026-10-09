import { useEffect, useState } from 'react';
import {
  listReviewQueue, listReviewHistory, resolveReview, REASON_LABEL,
  type ReviewEntry, type ReviewHistoryRow, type ReviewAction,
} from '../save/adminReview';

/* ════════════════════════════════════════════════════════════════════
   관리자 검토 창 — 신고·이의제기로 숨겨진 문제(status='review')를 한 장씩 처리한다.

   카드마다 신고 사유·메모·전적과 문제 전문이 보이고, 본문은 바로 고칠 수 있다.
     복구      : 문제 없음 → 그대로 다시 출제
     수정·복구 : 고친 내용으로 갈아끼우고 다시 출제 (퀴즈는 힌트 세트를 하나로 교체)
     삭제      : banned — 다시는 안 나감
   서버가 관리자 여부를 판정하므로(041) 이 창은 관리자 계정에서만 열린다.
   ════════════════════════════════════════════════════════════════════ */

interface Props {
  onClose: () => void;
  /** 처리 뒤 대기 수 배지를 갱신하라고 App 에 알린다 */
  onChanged: () => void;
}

const ACTION_LABEL: Record<ReviewAction, string> = { restore: '복구', fix: '수정·복구', delete: '삭제' };

export default function AdminReviewModal({ onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<ReviewEntry[] | null>(null);
  const [history, setHistory] = useState<ReviewHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');

  async function load() {
    setError(null);
    try {
      const [q, h] = await Promise.all([listReviewQueue(), listReviewHistory(30)]);
      setEntries(q); setHistory(h);
    } catch (e) {
      setError((e as Error).message); setEntries([]);
    }
  }
  useEffect(() => { void load(); }, []);

  function removeEntry(bankId: string) {
    setEntries((prev) => (prev ?? []).filter((e) => e.bankId !== bankId));
    onChanged();
    void listReviewHistory(30).then(setHistory).catch(() => { /* 무시 */ });
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal admin-modal">
        <div className="modal-titlebar">
          <span className="modal-title">🛠 문제 검토 · 대기 {entries?.length ?? '…'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="admin-tabs">
            <button className={`btn btn-xs ${tab === 'pending' ? 'admin-tab-on' : ''}`} onClick={() => setTab('pending')}>대기</button>
            <button className={`btn btn-xs ${tab === 'history' ? 'admin-tab-on' : ''}`} onClick={() => setTab('history')}>처리 이력</button>
            <button className="btn btn-xs" style={{ marginLeft: 'auto' }} onClick={() => void load()}>새로고침</button>
          </div>
          {error && <div className="admin-error">불러오기 실패: {error}</div>}
          {tab === 'pending' && entries && entries.length === 0 && !error && (
            <div className="wardrobe-note">대기 중인 신고가 없어요. 신고가 들어오면 도구 막대의 🛠 배지에 숫자가 떠요.</div>
          )}
          {tab === 'pending' && entries?.map((e) => (
            <ReviewCard key={`${e.kind}:${e.bankId}`} entry={e} onDone={() => removeEntry(e.bankId)} />
          ))}
          {tab === 'history' && (
            <div className="modal-section">
              <div className="modal-section-title">최근 처리 {history.length}건</div>
              {history.length === 0 && <div className="wardrobe-note">아직 처리한 건이 없어요.</div>}
              <table className="admin-history">
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td>{h.kind === 'quiz' ? '퀴즈' : '수프'}</td>
                      <td className="admin-history-label">{h.label || '(삭제됨)'}</td>
                      <td>{REASON_LABEL[h.reason] ?? h.reason}</td>
                      <td><b>{ACTION_LABEL[h.resolution] ?? h.resolution}</b></td>
                      <td className="admin-history-date">{new Date(h.resolvedAt).toLocaleDateString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewCard({ entry, onDone }: { entry: ReviewEntry; onDone: () => void }) {
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 편집 상태 — 퀴즈
  const q = entry.quiz;
  const [answer, setAnswer] = useState(q?.answer ?? '');
  const [acceptable, setAcceptable] = useState((q?.acceptable ?? []).join(', '));
  const [hints, setHints] = useState((q?.hint_sets[0] ?? []).join('\n'));
  const [maxHints, setMaxHints] = useState(String(q?.max_hints ?? 0));
  // 편집 상태 — 수프
  const s = entry.soup;
  const [title, setTitle] = useState(s?.title ?? '');
  const [scenario, setScenario] = useState(s?.scenario ?? '');
  const [solution, setSolution] = useState(s?.solution ?? '');
  const [keyFacts, setKeyFacts] = useState((s?.key_facts ?? []).join('\n'));

  const edited = q
    ? answer !== q.answer || acceptable !== q.acceptable.join(', ') || hints !== (q.hint_sets[0] ?? []).join('\n') || maxHints !== String(q.max_hints)
    : s ? title !== s.title || scenario !== s.scenario || solution !== s.solution || keyFacts !== s.key_facts.join('\n') : false;

  async function act(action: ReviewAction) {
    setBusy(action); setErr(null);
    try {
      if (action === 'fix') {
        if (q) {
          const hs = hints.split('\n').map((x) => x.trim()).filter(Boolean);
          if (!answer.trim() || hs.length < 3) throw new Error('정답과 힌트 3개 이상이 필요해요');
          await resolveReview('quiz', entry.bankId, 'fix', {
            answer: answer.trim(),
            acceptable: acceptable.split(',').map((x) => x.trim()).filter(Boolean),
            hints: hs,
            max_hints: Math.min(Math.max(1, Number(maxHints) || hs.length), hs.length),
          });
        } else {
          if (!scenario.trim() || !solution.trim()) throw new Error('문제와 진상은 비울 수 없어요');
          await resolveReview('soup', entry.bankId, 'fix', {
            title: title.trim(), scenario: scenario.trim(), solution: solution.trim(),
            key_facts: keyFacts.split('\n').map((x) => x.trim()).filter(Boolean),
          });
        }
      } else {
        await resolveReview(entry.kind, entry.bankId, action);
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const reasonCounts = entry.reasons.reduce<Record<string, number>>((m, r) => { m[r] = (m[r] ?? 0) + 1; return m; }, {});

  return (
    <div className="modal-section admin-card">
      <div className="modal-section-title">
        {entry.kind === 'quiz' ? '🧩 퀴즈' : '🥣 수프'}
        {q && <> · {q.category_label || q.category_key} · {q.difficulty_labeled}</>}
        {s && <> · {s.mood} · {s.difficulty}</>}
        <span className="stats-title-badge">신고 {entry.reports}건</span>
      </div>
      <div className="admin-reasons">
        {Object.entries(reasonCounts).map(([r, n]) => (
          <span key={r} className="admin-reason">{REASON_LABEL[r] ?? r}{n > 1 ? ` ×${n}` : ''}</span>
        ))}
        <span className="admin-meta">
          첫 신고 {new Date(entry.firstAt).toLocaleString('ko-KR')}
          {q && <> · 출제 {q.plays}회 정답 {q.wins}회 이의 {q.appeal_count}회</>}
          {s && <> · 출제 {s.plays}회 해결 {s.solved}회</>}
        </span>
      </div>
      {entry.notes.length > 0 && (
        <ul className="admin-notes">{entry.notes.map((n, i) => <li key={i}>“{n}”</li>)}</ul>
      )}

      {q && (
        <div className="admin-fields">
          <label>정답<input value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
          <label>인정 표기 (쉼표로 구분)<input value={acceptable} onChange={(e) => setAcceptable(e.target.value)} /></label>
          <label>힌트 (한 줄에 하나, 넓은 것 → 결정적인 것)
            <textarea rows={Math.max(4, hints.split('\n').length)} value={hints} onChange={(e) => setHints(e.target.value)} />
          </label>
          <label className="admin-inline">공개 힌트 수 <input type="number" min={1} value={maxHints} onChange={(e) => setMaxHints(e.target.value)} style={{ width: 56 }} /></label>
          {q.hint_sets.length > 1 && <div className="admin-meta">힌트 세트가 {q.hint_sets.length}개 있어요. 수정·복구하면 위 세트 하나로 바뀌어요.</div>}
        </div>
      )}
      {s && (
        <div className="admin-fields">
          <label>제목<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>문제<textarea rows={3} value={scenario} onChange={(e) => setScenario(e.target.value)} /></label>
          <label>진상<textarea rows={4} value={solution} onChange={(e) => setSolution(e.target.value)} /></label>
          <label>핵심 사실 (한 줄에 하나)<textarea rows={Math.max(3, keyFacts.split('\n').length)} value={keyFacts} onChange={(e) => setKeyFacts(e.target.value)} /></label>
        </div>
      )}

      {err && <div className="admin-error">{err}</div>}
      <div className="admin-actions">
        <button className="btn btn-xs" disabled={!!busy} onClick={() => void act('restore')} title="문제 없음 — 그대로 다시 출제">
          {busy === 'restore' ? '…' : '✓ 복구'}
        </button>
        <button className="btn btn-xs" disabled={!!busy || !edited} onClick={() => void act('fix')} title="고친 내용으로 갈아끼우고 다시 출제">
          {busy === 'fix' ? '…' : '✎ 수정·복구'}
        </button>
        {!confirmDelete ? (
          <button className="btn btn-xs btn-report" disabled={!!busy} onClick={() => setConfirmDelete(true)}>🗑 삭제</button>
        ) : (
          <>
            <span className="admin-meta">정말 삭제? 다시는 출제되지 않아요.</span>
            <button className="btn btn-xs btn-report" disabled={!!busy} onClick={() => void act('delete')}>{busy === 'delete' ? '…' : '삭제 확정'}</button>
            <button className="btn btn-xs" disabled={!!busy} onClick={() => setConfirmDelete(false)}>취소</button>
          </>
        )}
      </div>
    </div>
  );
}
