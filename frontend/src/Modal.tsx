import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A small accessible modal dialog. The per-customer actions (details, consume,
 * credit) open in here rather than inline in the page, so the main content stays
 * the customer list + catalog.
 *
 * Accessibility: role="dialog" + aria-modal, labelled by its title, closes on
 * Escape or a backdrop click, moves focus to the panel on open, and restores body
 * scroll on close. Rendered through a portal on document.body so it stacks above
 * the page regardless of where it is invoked from.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider panel for content-heavy modals (e.g. the usage-history table). */
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal__backdrop"
      // Close only when the backdrop itself is pressed, not when a press inside the
      // panel ends on the backdrop (e.g. a drag-select that overshoots).
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={wide ? "modal modal--wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="modal__head">
          <h2 className="modal__title" id="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
