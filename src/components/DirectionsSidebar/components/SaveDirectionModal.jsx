import styles from "../styles/styles";

export function SaveDirectionModal({
  open,
  title = "Save directions",
  name,
  setName,
  description,
  setDescription,
  autoName,
  canUpdate,
  saving,
  error,
  onCancel,
  onSaveNew,
  onUpdate,
}) {
  if (!open) return null;

  return (
    <div className={styles.saveModalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.saveModalCard}>
        <div className={styles.saveModalTitle}>{title}</div>

        <label className={styles.saveModalLabel}>
          Name
          <input
            className={styles.saveModalInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={autoName || "Saved directions"}
            disabled={saving}
          />
        </label>

        <label className={styles.saveModalLabel}>
          Description
          <textarea
            className={styles.saveModalTextarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            rows={3}
            disabled={saving}
          />
        </label>

        {error && <div className={styles.saveModalError}>{error}</div>}

        <div className={styles.saveModalActions}>
          <button className={styles.secondaryBtn} onClick={onCancel} type="button" disabled={saving}>
            Cancel
          </button>

          <button
            className={styles.primaryBtn}
            onClick={onSaveNew}
            type="button"
            disabled={saving}
            title="Save as a new bookmark"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          {canUpdate && (
            <button
              className={styles.primaryBtn}
              onClick={onUpdate}
              type="button"
              disabled={saving}
              title="Update this saved direction"
            >
              {saving ? "Saving…" : "Update"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
