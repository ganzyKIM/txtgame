import { COSTUMES, type Costume, type UnlockState } from '../game/wardrobe';
import { costumeBaseImage } from '../game/mascotLines';
import type { Form } from '../game/mascotImages';

/* ════════════════════════════════════════════════════════════════════
   옷장 — 의상 카드 격자. StatsModal 과 같은 .modal 골격.

   잠긴 카드는 흑백 실루엣 + 자물쇠 + 해금 조건 + 진행도 바.
   클릭하면 바로 착용하고 창은 그대로 둔다(여러 벌 비교하기 좋게).
   해금 판정 자체는 App 이 my_stats 로 계산해 UnlockState 로 넘겨준다.
   ════════════════════════════════════════════════════════════════════ */

interface Props {
  form: Form;
  selected: Costume | null;
  unlocks: UnlockState;
  /** 로그인 전에는 진행도를 계산할 수 없다 */
  loggedIn: boolean;
  onSelect: (c: Costume | null) => void;
  onClose: () => void;
}

export default function WardrobeModal({ form, selected, unlocks, loggedIn, onSelect, onClose }: Props) {
  const openCount = COSTUMES.filter((c) => unlocks.unlocked.has(c.id)).length;
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wardrobe-modal">
        <div className="modal-titlebar">
          <span className="modal-title">👗 옷장 · {openCount + 1}/{COSTUMES.length + 1}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!loggedIn && (
            <div className="wardrobe-note">로그인하면 전적으로 새 옷이 열리고 진행도가 보여요.</div>
          )}
          {unlocks.master && (
            <div className="wardrobe-note">★ 마스터 계정 — 모든 옷을 입을 수 있어요. 카드의 표시는 실제 조건 달성 여부예요.</div>
          )}
          <div className="wardrobe-grid">
            <WardrobeCard
              img={costumeBaseImage(form, null)} label="교복" desc="언제나의 그 모습"
              locked={false} active={selected === null} onClick={() => onSelect(null)}
            />
            {COSTUMES.map((c) => {
              const locked = !unlocks.unlocked.has(c.id);
              const p = unlocks.progress[c.id];
              // 마스터는 잠기지 않지만 조건을 달성했는지는 따로 보여준다
              const achievedMark = unlocks.master && p
                ? (unlocks.achieved.has(c.id) ? { ok: true, text: `✓ 달성 · ${p.label}` } : { ok: false, text: `✗ 미달성 · ${p.label} (${p.cur}/${p.need})` })
                : undefined;
              return (
                <WardrobeCard
                  key={c.id}
                  img={costumeBaseImage(form, c.id)} label={c.label} desc={c.desc}
                  locked={locked} active={selected === c.id}
                  condition={p ? p.label : undefined}
                  progress={p && (locked || p.parts) ? p : undefined}
                  achievedMark={achievedMark}
                  onClick={() => { if (!locked) onSelect(c.id); }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  img: string; label: string; desc: string;
  locked: boolean; active: boolean;
  condition?: string;
  progress?: { cur: number; need: number; parts?: { label: string; ok: boolean; cur: number; need: number }[] };
  /** 마스터 계정용: 열려 있어도 조건 달성 여부를 표시 */
  achievedMark?: { ok: boolean; text: string };
  onClick: () => void;
}

function WardrobeCard({ img, label, desc, locked, active, condition, progress, achievedMark, onClick }: CardProps) {
  return (
    <button
      type="button"
      className={`wardrobe-card${locked ? ' locked' : ''}${active ? ' active' : ''}`}
      onClick={onClick}
      title={locked ? `잠김 — ${condition ?? ''}` : desc}
    >
      <div className="wardrobe-card-img">
        <img src={img} alt={label} draggable={false} />
        {locked && <span className="wardrobe-lock">🔒</span>}
        {active && <span className="wardrobe-active">착용 중</span>}
      </div>
      <div className="wardrobe-card-label">{label}</div>
      {locked ? (
        <div className="wardrobe-card-cond">
          <div>{condition}</div>
          {progress?.parts && (
            <ul className="wardrobe-parts">
              {progress.parts.map((x) => (
                <li key={x.label} className={x.ok ? 'ok' : ''}>{x.ok ? '✓' : '·'} {x.label} <small>{x.cur}/{x.need}</small></li>
              ))}
            </ul>
          )}
          {progress && (
            <div className="wardrobe-bar" aria-label={`${progress.cur}/${progress.need}`}>
              <div className="wardrobe-bar-fill" style={{ width: `${Math.round((progress.cur / progress.need) * 100)}%` }} />
              <span className="wardrobe-bar-text">{progress.cur}/{progress.need}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="wardrobe-card-desc">{desc}</div>
          {achievedMark && (
            <div className={`wardrobe-achieved${achievedMark.ok ? ' ok' : ''}`}>{achievedMark.text}</div>
          )}
          {achievedMark && progress?.parts && (
            <ul className="wardrobe-parts">
              {progress.parts.map((x) => (
                <li key={x.label} className={x.ok ? 'ok' : ''}>{x.ok ? '✓' : '·'} {x.label} <small>{x.cur}/{x.need}</small></li>
              ))}
            </ul>
          )}
        </>
      )}
    </button>
  );
}
