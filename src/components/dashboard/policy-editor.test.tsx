import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PolicyEditor } from "./dashboard-app";

describe("PolicyEditor", () => {
  it("stops adding rows at the contract beneficiary bound", () => {
    render(<PolicyEditor owner="0x1111111111111111111111111111111111111111" mode="create" pending={false} onSubmit={vi.fn()} />);
    for (let count = 2; count < 10; count += 1) {
      fireEvent.click(screen.getByRole("button", { name: /add beneficiary/i }));
    }
    expect(screen.getAllByLabelText(/Beneficiary \d+ label/i)).toHaveLength(10);
    expect(screen.getByRole("button", { name: /10 beneficiary limit/i })).toBeDisabled();
  });
});
