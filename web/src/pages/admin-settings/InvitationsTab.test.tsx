import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { setAccessToken, setProfileId, setProfileToken } from "@/api/client";
import InvitationsTab from "./InvitationsTab";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  reset: vi.fn(),
  restart: vi.fn(),
  next: vi.fn(),
  profile: true,
  emailDelivery: true,
  listError: false,
  rows: true,
  linkRow: false,
  publicURL: "https://media.example.test" as string | undefined,
}));
const linkRow = {
  id: "8",
  email: "",
  delivery: "link",
  note: "For Sam",
  role: "user",
  status: "pending",
  created_at: "2026-01-02T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
};
const row = {
  id: "7",
  email: "invitee@example.invalid",
  delivery: "email_sent",
  note: "",
  role: "user",
  status: "pending",
  created_at: "2026-01-01T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({}) }));
vi.mock("@/hooks/queries/admin/invitations", () => ({
  useInvitationCapabilities: () => ({
    data: {
      state: "available",
      default_profile: mocks.profile,
      email_delivery: mocks.emailDelivery,
    },
  }),
  useAdminInvitations: () => ({
    data: { pages: [{ items: mocks.rows ? (mocks.linkRow ? [linkRow, row] : [row]) : [] }] },
    isError: mocks.listError,
    error: new Error("Cursor expired"),
    restart: mocks.restart,
    hasNextPage: true,
    fetchNextPage: mocks.next,
  }),
  useCreateInvitation: () => ({ mutateAsync: mocks.create, reset: mocks.reset }),
  useResendInvitation: () => ({ mutateAsync: mocks.resend, reset: mocks.reset }),
  useRevokeInvitation: () => ({ mutateAsync: mocks.revoke, reset: mocks.reset }),
}));
vi.mock("@/hooks/queries/admin/settings", () => ({
  useAdminServerSettings: () => ({
    data: mocks.publicURL === undefined ? undefined : { "server.public_url": mocks.publicURL },
  }),
}));
vi.mock("@/hooks/queries/admin/accessGroups", () => ({ useAccessGroups: () => ({ data: [] }) }));
vi.mock("@/hooks/queries/admin/libraries", () => ({ useAdminLibraries: () => ({ data: [] }) }));
// The viewer is the server Owner, who may invite an admin.
vi.mock("@/hooks/queries/admin/users", () => ({ useViewerIsOwner: () => true }));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  mocks.profile = true;
  mocks.emailDelivery = true;
  mocks.listError = false;
  mocks.rows = true;
  mocks.linkRow = false;
  mocks.publicURL = "https://media.example.test";
  mocks.restart.mockResolvedValue(undefined);
  localStorage.clear();
  sessionStorage.clear();
  setAccessToken("account");
  setProfileId("owner");
  setProfileToken(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders pending and partial history failures with explicit restart", () => {
  mocks.listError = true;
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  expect(screen.getByText("Offen")).toBeInTheDocument();
  expect(screen.getByText(row.email)).toBeInTheDocument();
  expect(screen.queryByText(/Noch keine Einladungen/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Verlauf neu laden" }));
  expect(mocks.restart).toHaveBeenCalledTimes(1);
});
it("retains revoke confirmation and row on failure", async () => {
  mocks.revoke.mockRejectedValue(new Error("Could not revoke"));
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByTitle("Diesen Link widerrufen"));
  fireEvent.click(screen.getByRole("button", { name: "Widerrufen" }));
  expect(await screen.findByText("Could not revoke")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText(row.email)).toBeInTheDocument();
  expect(mocks.revoke).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "7",
      profileContext: expect.objectContaining({ profileId: "owner" }),
    }),
  );
});
it("keeps a one-time link after clipboard failure, resets mutation state, and disposes on scope change", async () => {
  mocks.resend.mockResolvedValue({
    invitation: row,
    claim_url: "https://example.invalid/invite/one-time",
    delivery_status: "failed_or_unknown",
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  const view = render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByTitle("Neuen Link per E-Mail senden"));
  expect(
    await screen.findByText(/E-Mail-Versand ist fehlgeschlagen oder unsicher/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Link kopieren" }));
  expect(await screen.findByText(/konnte nicht kopiert werden/)).toBeInTheDocument();
  expect(screen.getByText("https://example.invalid/invite/one-time")).toBeInTheDocument();
  expect(mocks.reset).toHaveBeenCalled();
  setProfileId("other");
  view.rerender(<InvitationsTab />);
  expect(screen.queryByText("https://example.invalid/invite/one-time")).not.toBeInTheDocument();
});
it("blocks synchronous double submit and dismissal until delivery resolves", async () => {
  let resolve!: (value: unknown) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByRole("button", { name: "Jemanden einladen" }));
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), { target: { value: row.email } });
  const submit = screen.getByRole("button", { name: "Einladung senden" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () =>
    resolve({
      invitation: row,
      claim_url: "https://example.invalid/invite/created",
      delivery_status: "not_configured",
    }),
  );
  expect(await screen.findByText(/gib den Link selbst weiter/)).toBeInTheDocument();
});
it("guides unsupported profile creation and preserves false booleans", async () => {
  mocks.profile = false;
  mocks.create.mockResolvedValue({
    invitation: row,
    claim_url: "https://example.invalid/invite/profileless",
    delivery_status: "sent",
  });
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByRole("button", { name: "Jemanden einladen" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "kann ein Standardprofil nicht zuverlässig mitanlegen",
  );
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), { target: { value: row.email } });
  fireEvent.click(screen.getByLabelText("Funktionstour bei der ersten Anmeldung zeigen"));
  fireEvent.click(screen.getByRole("button", { name: "Einladung senden" }));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ create_profile: false, show_tour: false }),
      }),
    ),
  );
  expect(mocks.create.mock.calls[0]![0].body).not.toHaveProperty("library_ids", null);
});
it("asks for the public URL before anyone fills in an invitation", () => {
  mocks.publicURL = "";
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  expect(screen.getByRole("button", { name: "Jemanden einladen" })).toBeDisabled();
  expect(screen.getByTitle("Neuen Link kopieren, ohne E-Mail")).toBeDisabled();
  expect(screen.getByTitle("Neuen Link per E-Mail senden")).toBeDisabled();
  expect(screen.getByTitle("Diesen Link widerrufen")).not.toBeDisabled();
  expect(
    screen.getByText(/Lege die öffentliche Silo-Adresse fest, um Einladungslinks zu erstellen/),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Allgemeine Einstellungen/ })).toHaveAttribute(
    "href",
    "/admin/settings/general",
  );
});
it("creates a link invitation without an address and shows the link to share", async () => {
  mocks.create.mockResolvedValue({
    invitation: linkRow,
    claim_url: "https://example.invalid/invite/link-only",
    delivery_status: "not_requested",
  });
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByRole("button", { name: "Jemanden einladen" }));
  expect(screen.getByLabelText("E-Mail senden")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Link erstellen"));
  expect(screen.queryByLabelText("E-Mail-Adresse")).toBeNull();
  fireEvent.change(screen.getByLabelText("Notiz (optional)"), { target: { value: "For Sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Link erstellen" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  const body = mocks.create.mock.calls[0]![0].body;
  expect(body).toMatchObject({ delivery: "link", note: "For Sam" });
  expect(body.email).toBeUndefined();
  expect(await screen.findByText(/Einladungslink erstellt/)).toBeInTheDocument();
  expect(screen.getByText("https://example.invalid/invite/link-only")).toBeInTheDocument();
  expect(screen.getByText(/Jeder mit dem Link kann ihn nutzen/)).toBeInTheDocument();
});
it("selects a delivery option when its card text is clicked", () => {
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByRole("button", { name: "Jemanden einladen" }));
  fireEvent.click(screen.getByText("Du gibst den Link selbst weiter, zum Beispiel in einem Chat."));
  expect(screen.getByLabelText("Link erstellen")).toBeChecked();
  expect(screen.getByLabelText("Link erstellen")).toHaveFocus();
  fireEvent.click(screen.getByText("Wir senden den Link per E-Mail. Du kannst ihn auch kopieren."));
  expect(screen.getByLabelText("E-Mail senden")).toBeChecked();
});
it("offers only link creation when email is not configured", () => {
  mocks.emailDelivery = false;
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByRole("button", { name: "Jemanden einladen" }));
  expect(screen.getByLabelText("Link erstellen")).toBeChecked();
  expect(screen.getByLabelText("E-Mail senden")).toBeDisabled();
  expect(screen.getByText("E-Mail ist auf diesem Server nicht eingerichtet.")).toBeInTheDocument();
  // The mail server has its own page; Notifications only links to it.
  expect(screen.getByRole("link", { name: /E-Mail-Einstellungen/ })).toHaveAttribute(
    "href",
    "/admin/settings/email",
  );
  expect(screen.getByRole("button", { name: "Link erstellen" })).toBeInTheDocument();
});
it("replaces an emailed invitation's link without emailing it", async () => {
  mocks.resend.mockResolvedValue({
    invitation: { ...row, delivery: "link" },
    claim_url: "https://example.invalid/invite/replaced",
    delivery_status: "not_requested",
  });
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByTitle("Neuen Link kopieren, ohne E-Mail"));
  await waitFor(() =>
    expect(mocks.resend).toHaveBeenCalledWith(
      expect.objectContaining({ id: "7", delivery: "link" }),
    ),
  );
  expect(
    await screen.findByText(
      `Neuer Link für ${row.email} erstellt. Es wurde keine E-Mail versendet; gib den Link selbst weiter.`,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("https://example.invalid/invite/replaced")).toBeInTheDocument();
});
it("emails a new link only when asked and email is configured", async () => {
  mocks.resend.mockResolvedValue({
    invitation: row,
    claim_url: "https://example.invalid/invite/emailed",
    delivery_status: "sent",
  });
  const view = render(<InvitationsTab />, { wrapper: MemoryRouter });
  fireEvent.click(screen.getByTitle("Neuen Link per E-Mail senden"));
  await waitFor(() =>
    expect(mocks.resend).toHaveBeenCalledWith(
      expect.objectContaining({ id: "7", delivery: "email" }),
    ),
  );
  view.unmount();
  mocks.emailDelivery = false;
  mocks.linkRow = true;
  render(<InvitationsTab />, { wrapper: MemoryRouter });
  expect(screen.queryByTitle("Neuen Link per E-Mail senden")).toBeNull();
  expect(screen.getByTitle("Neuen Link kopieren, ohne E-Mail")).toBeInTheDocument();
  // A link invitation has no address to email.
  expect(screen.getAllByTitle(/[Nn]euen Link/)).toHaveLength(2);
  fireEvent.click(screen.getByTitle("Durch neuen Link ersetzen"));
  await waitFor(() =>
    expect(mocks.resend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "8", delivery: "link" }),
    ),
  );
});
