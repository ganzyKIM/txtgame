/**
 * 사회인모드(보스키) — 게임 상태는 그대로 둔 채 화면만 평범한 스프레드시트로 위장.
 * 회사에서 업무 중에 열어놔도 이상하지 않게, 배경화면·마스코트·귀여운 UI를 전부 숨기고
 * 이 화면으로 대체한다. 다시 "변신"을 누르면 원래 화면으로 복귀(상태 보존).
 */
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ROWS = 22;

const HEADER = ['항목', '1월', '2월', '3월', '목표', '달성률', '', ''];
const DATA: (string | number)[][] = [
  ['매출액',       128500, 131200, 142800, 400000, '85.6%', '', ''],
  ['매출원가',      74200,  75600,  81100, 220000, '68.6%', '', ''],
  ['판관비',        21300,  20800,  22500,  65000, '69.0%', '', ''],
  ['영업이익',      33000,  34800,  39200, 115000, '92.2%', '', ''],
  ['신규 계약',        12,     15,     18,     50, '90.0%', '', ''],
  ['해지율',       '2.1%', '1.8%', '1.6%',  '2.0%',  '', '', ''],
];

export default function OfficeMode() {
  return (
    <div className="office">
      <div className="office-ribbon">
        <span>파일</span><span>홈</span><span>삽입</span><span>페이지 레이아웃</span>
        <span>수식</span><span>데이터</span><span>검토</span><span>보기</span>
      </div>
      <div className="office-toolbar">
        <span className="office-formula-label">fx</span>
        <span className="office-formula-bar">=SUM(B2:D2)</span>
      </div>
      <div className="office-grid-wrap">
        <table className="office-grid">
          <thead>
            <tr>
              <th className="office-corner" />
              {COLS.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>1</th>
              {HEADER.map((h, i) => <td key={i} className="office-header-row">{h}</td>)}
            </tr>
            {Array.from({ length: ROWS }).map((_, r) => (
              <tr key={r}>
                <th>{r + 2}</th>
                {COLS.map((_, c) => {
                  const v = DATA[r]?.[c];
                  return <td key={c} className={typeof v === 'number' ? 'office-num' : ''}>{v ?? ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="office-statusline">
        <span>준비</span>
        <span className="office-spacer" />
        <span>합계: 0&nbsp;&nbsp;&nbsp;100%</span>
      </div>
    </div>
  );
}
