import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("landing page", () => {
  it("explains the execution-first product and its legal boundary", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: /assets should not become inaccessible/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open dashboard/i })).toSatisfy(
      (links: HTMLElement[]) => links.every((link) => link.getAttribute("href") === "/dashboard"),
    );
    expect(screen.getByText(/keeperhub executes only what the vault permits/i)).toBeInTheDocument();
    expect(screen.getByText(/not a legal will, probate service, or proof-of-death system/i)).toBeInTheDocument();
    expect(screen.getAllByText(/testnet/i).length).toBeGreaterThan(0);
  });
});
