import { Check, LoaderCircle, Plus, X } from "lucide-react";
export function NoteComposer({
  onSave,
  busy,
  selected,
  onCancel,
}: {
  onSave: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  busy: string;
  selected: boolean;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSave} className="note-composer">
      <div className="detail-toolbar">
        <span className="tag">
          <Plus size={13} /> A NEW THOUGHT
        </span>
        {selected && (
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel new note"
            onClick={() => onCancel()}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <label>
        Note title
        <input
          name="title"
          placeholder="Give your idea a name…"
          maxLength={120}
          required
        />
      </label>
      <label>
        Your note
        <textarea
          name="content"
          placeholder="Meeting notes, a rough idea, something worth remembering…"
          minLength={20}
          maxLength={12000}
          rows={9}
          required
        />
      </label>
      <div className="composer-footer">
        <small>20–12,000 characters · Plain text</small>
        <button className="button primary" disabled={!!busy}>
          {busy === "save" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <>
              <Check size={16} />
              Save note
            </>
          )}
        </button>
      </div>
    </form>
  );
}
