import { useId, useMemo, useState } from 'react';
import {
  PROCEDURE_BLOCKS, PROCEDURE_BLOCK_BY_COMMAND, PROCEDURE_COMMANDS, PROCEDURE_MAX_COMMANDS, SUGGESTED_PROCEDURE_TEXT,
  defaultStep, formatProcedure, parseProcedure,
} from './procedures.js';
import './procedureEditor.css';

const DRAG_TYPE = 'text/plain';
const PARAM_FIELD = { code: 'code', minutes: 'minutes', target: 'target' };

// Divert is a terminal block: keep one, always last, and never exceed the block limit.
function snap(steps) {
  const divert = steps.filter(step => step.command === 'DIVERT').at(-1);
  const rest = steps.filter(step => step.command !== 'DIVERT');
  return divert ? [...rest.slice(0, PROCEDURE_MAX_COMMANDS - 1), divert] : rest.slice(0, PROCEDURE_MAX_COMMANDS);
}

function isValidParam(param, text) {
  if (param.kind === 'code') return /^[0-7]{4}$/.test(text);
  if (param.kind === 'target') return /^(NEAREST|ORIGIN|[A-Z]{3})$/.test(text.toUpperCase());
  return /^\d+$/.test(text) && Number(text) >= param.min && Number(text) <= param.max;
}

// Inline parameter of a stacked block. Valid input commits immediately; while typing an invalid
// value the draft is kept locally (marked invalid) so the procedure text never becomes broken.
function ParamInput({ block, step, onCommit, label }) {
  const param = block.param;
  const field = PARAM_FIELD[param.kind];
  const current = String(step[field] ?? param.default);
  const [draft, setDraft] = useState(current);
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const shown = focused ? draft : current;
  const change = (text) => {
    setDraft(text);
    if (!isValidParam(param, text)) return;
    const value = param.kind === 'minutes' ? Number(text) : text.toUpperCase();
    if (String(value) !== current) onCommit({ ...step, [field]: value });
  };
  const common = {
    className: 'procedure-block-input mono',
    value: shown,
    'aria-label': label,
    'aria-invalid': focused && !isValidParam(param, draft) ? 'true' : undefined,
    onFocus: () => { setDraft(current); setFocused(true); },
    onBlur: () => setFocused(false),
    onChange: event => change(event.target.value),
  };
  if (param.kind === 'minutes') {
    return (
      <>
        <input {...common} type="number" inputMode="numeric" min={param.min} max={param.max} step={1} />
        <span className="procedure-block-unit">{param.unit}</span>
      </>
    );
  }
  if (param.kind === 'code') return <input {...common} type="text" inputMode="numeric" maxLength={4} size={4} />;
  return (
    <>
      <input {...common} type="text" list={listId} maxLength={7} size={7} autoCapitalize="characters" />
      <datalist id={listId}>
        <option value="NEAREST" />
        <option value="ORIGIN" />
      </datalist>
    </>
  );
}

// Scratch-style block builder for a lost-comms procedure. The value is always procedure text
// (`Name = value` lines); blocks are just a view of it. `activeIndex` highlights the running block.
export default function ProcedureEditor({ id, label, value = '', onChange, placeholder, compact = false, activeIndex }) {
  const fallbackId = useId();
  const baseId = id ?? fallbackId;
  const textId = `${baseId}-text`;
  const statusId = `${baseId}-status`;
  const [textMode, setTextMode] = useState(true);
  const [showCommands, setShowCommands] = useState(false);
  const [over, setOver] = useState(null);
  const [dragging, setDragging] = useState(null);

  const parsed = useMemo(() => {
    try {
      return { steps: parseProcedure(value), error: null };
    } catch (error) {
      return { steps: [], error: error.message };
    }
  }, [value]);
  const { steps, error } = parsed;
  const showText = textMode || Boolean(error);
  const canAdd = !error && steps.length < PROCEDURE_MAX_COMMANDS;

  const emit = (nextSteps) => onChange?.(formatProcedure(snap(nextSteps)));
  const insert = (step, index) => emit([...steps.slice(0, index), step, ...steps.slice(index)]);
  const update = (index, step) => emit(steps.map((item, position) => (position === index ? step : item)));
  const remove = index => emit(steps.filter((_, position) => position !== index));
  const swap = (a, b) => {
    if (b < 0 || b >= steps.length) return;
    const next = [...steps];
    [next[a], next[b]] = [next[b], next[a]];
    emit(next);
  };
  // Drag-and-drop places the dragged block before the block it is dropped on.
  const reorder = (from, before) => {
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(from < before ? before - 1 : before, 0, moved);
    emit(next);
  };
  const handleDrop = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const data = event.dataTransfer.getData(DRAG_TYPE);
    setOver(null);
    setDragging(null);
    if (data.startsWith('move:')) {
      const from = Number(data.slice(5));
      if (Number.isInteger(from) && from !== index) reorder(from, index);
    } else if (data.startsWith('add:') && canAdd) {
      const block = PROCEDURE_BLOCKS.find(item => item.id === data.slice(4));
      if (block) insert(defaultStep(block), index);
    }
  };
  const allowDrop = index => (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(index);
  };

  const status = error
    ?? (steps.length ? `${steps.length} block${steps.length === 1 ? '' : 's'} · runs top to bottom when contact is lost`
      : (placeholder ?? 'No blocks: the rulebook default applies.'));

  return (
    <div className={compact ? 'procedure-editor compact' : 'procedure-editor'}>
      <div className="procedure-editor-head">
        {label && (showText
          ? <label htmlFor={textId} className="procedure-editor-label">{label}</label>
          : <span className="procedure-editor-label" id={`${baseId}-label`}>{label}</span>)}
        <span className="procedure-editor-tools">
          <button type="button" aria-expanded={showCommands} aria-controls={`${baseId}-commands`}
            onClick={() => setShowCommands(open => !open)}>Commands</button>
          <button type="button" onClick={() => onChange?.(SUGGESTED_PROCEDURE_TEXT)}
            title={SUGGESTED_PROCEDURE_TEXT.replaceAll('\n', ' · ')}>Standard protocol</button>
          <button type="button" aria-pressed={showText} disabled={Boolean(error)}
            title={error ? 'Fix the error to edit as blocks' : undefined}
            onClick={() => setTextMode(mode => !mode)}>
            {showText ? 'Edit as blocks' : 'Edit as text'}
          </button>
        </span>
      </div>

      {showText ? (<>
        <textarea
          id={textId}
          className="procedure-editor-input mono"
          value={value}
          rows={compact ? 4 : 6}
          spellCheck={false}
          placeholder={placeholder ?? SUGGESTED_PROCEDURE_TEXT}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={statusId}
          onChange={event => onChange?.(event.target.value)}
        />
        <p className="procedure-editor-status">One command per line · times in minutes.</p>
      </>) : (
        <>
          <div className="procedure-palette" role="group" aria-label="Blocks: click or drag into the procedure">
            {PROCEDURE_BLOCKS.map(block => (
              <button
                key={block.id}
                type="button"
                className="procedure-palette-block"
                style={{ '--block': block.color }}
                title={block.description}
                disabled={!canAdd}
                draggable={canAdd}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, `add:${block.id}`);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => insert(defaultStep(block), steps.length)}
              >
                + {block.label}
              </button>
            ))}
          </div>

          <ol
            className={over === steps.length ? 'procedure-stack is-drop-end' : 'procedure-stack'}
            aria-labelledby={label ? `${baseId}-label` : undefined}
            aria-describedby={statusId}
            onDragOver={allowDrop(steps.length)}
            onDragLeave={() => setOver(null)}
            onDrop={event => handleDrop(event, steps.length)}
          >
            {steps.map((step, index) => {
              const block = PROCEDURE_BLOCK_BY_COMMAND[step.command];
              const classes = ['procedure-block'];
              if (index === activeIndex) classes.push('is-active');
              if (index === over) classes.push('is-drop-target');
              if (index === dragging) classes.push('is-dragging');
              return (
                <li
                  key={`${index}:${step.command}`}
                  className={classes.join(' ')}
                  style={{ '--block': block.color }}
                  aria-current={index === activeIndex ? 'step' : undefined}
                  onDragOver={allowDrop(index)}
                  onDrop={event => handleDrop(event, index)}
                >
                  <div className="procedure-block-row">
                    {/* Only the grip drags, so the inline inputs keep normal text selection. */}
                    <span
                      className="procedure-block-grip"
                      aria-hidden="true"
                      title="Drag to reorder"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_TYPE, `move:${index}`);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragging(index);
                      }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                    >⠿</span>
                    <span className="procedure-block-index mono">{index + 1}</span>
                    <span className="procedure-block-name">{block.id}</span>
                    {block.param && <>
                      <span className="procedure-block-equals" aria-hidden="true">=</span>
                      <ParamInput block={block} step={step} label={`${block.label} value, block ${index + 1}`}
                        onCommit={next => update(index, next)} />
                    </>}
                    <span className="procedure-block-actions">
                      <button type="button" aria-label={`Move ${block.label} block ${index + 1} up`} disabled={index === 0}
                        onClick={() => swap(index, index - 1)}>↑</button>
                      <button type="button" aria-label={`Move ${block.label} block ${index + 1} down`}
                        disabled={index === steps.length - 1} onClick={() => swap(index, index + 1)}>↓</button>
                      <button type="button" aria-label={`Remove ${block.label} block ${index + 1}`}
                        onClick={() => remove(index)}>✕</button>
                    </span>
                  </div>

                </li>
              );
            })}
          </ol>
        </>
      )}

      {showCommands && <div id={`${baseId}-commands`} className="procedure-command-help">
        <ul>{PROCEDURE_COMMANDS.map(command => <li key={command.id} title={command.description}><code>{command.syntax}</code></li>)}</ul>
      </div>}

      <p id={statusId} className={error ? 'procedure-editor-status is-error' : 'procedure-editor-status'}
        role={error ? 'alert' : undefined} aria-live="polite">
        {status}
      </p>
    </div>
  );
}
