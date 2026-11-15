import { useEffect, useState } from 'react';
import ProcedureEditor from '../simulation/ProcedureEditor.jsx';
import { parseProcedure } from '../simulation/procedures.js';

// Block editor with an explicit Apply: editing blocks only changes a draft, so the simulation is
// rebuilt once per applied procedure rather than on every keystroke or drag.
//   applied      the procedure text the engine is running ('' = not set)
//   onApply      called with the new text ('' clears it)
//   activeIndex  running block, highlighted while the draft still equals the applied text
export default function ProcedureApply({ id, label, applied = '', onApply, placeholder, compact = false, activeIndex }) {
  const [draft, setDraft] = useState(applied);
  useEffect(() => { setDraft(applied); }, [applied]);

  const empty = !draft.trim();
  let invalid = false;
  if (!empty) {
    try { parseProcedure(draft); } catch { invalid = true; }
  }
  const changed = draft !== applied;

  return (
    <div className={compact ? 'procedure-apply compact' : 'procedure-apply'}>
      <ProcedureEditor id={id} label={label} value={draft} onChange={setDraft} placeholder={placeholder}
        compact={compact} activeIndex={changed ? undefined : activeIndex} />
      <div className="procedure-apply-actions">
        <button type="button" disabled={!changed || invalid} onClick={() => onApply(draft)}
          title={invalid ? 'Fix the highlighted line first' : 'Replay the run to now with this procedure'}>
          {empty && applied ? 'Clear' : 'Apply'}
        </button>
        {changed && <button type="button" onClick={() => setDraft(applied)}>Revert</button>}
        {empty && placeholder && <button type="button" onClick={() => setDraft(placeholder)}>Use suggested</button>}
      </div>
    </div>
  );
}
