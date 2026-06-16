import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

afterEach(cleanup);

describe("Modal", () => {
  it("renders its title and children in a labelled dialog", () => {
    render(
      <Modal title="Credit wallet" onClose={() => {}}>
        <p>body content</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Credit wallet")).toBeDefined();
    expect(screen.getByText("body content")).toBeDefined();
  });

  it("closes on the close button, Escape, and a backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <p>x</p>
      </Modal>,
    );

    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.keyDown(document, { key: "Escape" });
    // A press on the backdrop itself (not the panel) dismisses.
    fireEvent.mouseDown(document.querySelector(".modal__backdrop")!);

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("does not close on a press inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <p>inside</p>
      </Modal>,
    );

    fireEvent.mouseDown(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
