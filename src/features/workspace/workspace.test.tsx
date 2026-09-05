import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsPage, TasksPage, WorkspaceProvider } from "./workspace";

function renderTasks() {
  return render(
    <WorkspaceProvider>
      <TasksPage />
    </WorkspaceProvider>,
  );
}
afterEach(() => window.localStorage.clear());

describe("workspace forms and storage recovery", () => {
  it("keeps invalid task submission in the accessible native validation path", async () => {
    const user = userEvent.setup();
    renderTasks();
    await screen.findByRole("button", { name: "New task" });
    await user.click(screen.getByRole("button", { name: "New task" }));
    const title = screen.getByLabelText("Task title");
    expect(title).toBeRequired();
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("requires explicit consent after a write failure and leaves the form open", async () => {
    const original = Storage.prototype.setItem;
    const user = userEvent.setup();
    renderTasks();
    await screen.findByRole("button", { name: "New task" });
    Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    try {
      await user.click(screen.getByRole("button", { name: "New task" }));
      await user.type(
        screen.getByLabelText("Task title"),
        "Write a useful test",
      );
      await user.click(screen.getByRole("button", { name: "Create task" }));
      expect(
        await screen.findByText(/browser did not allow.*not saved/i),
      ).toBeVisible();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/could not save task/i)).toBeInTheDocument();
      Storage.prototype.setItem = original;
      await user.click(
        screen.getByRole("button", { name: "Continue in memory" }),
      );
      await user.click(screen.getByRole("button", { name: "Create task" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText("Write a useful test")).toBeInTheDocument();
      expect(
        screen.queryByText(/browser did not allow.*not saved/i),
      ).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("handles a denied localStorage getter before loading and waits for consent", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("denied");
      },
    });
    try {
      const user = userEvent.setup();
      renderTasks();
      expect(
        await screen.findByRole("heading", {
          name: /storage needs your choice/i,
        }),
      ).toBeVisible();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No changes have been saved",
      );
      await user.click(
        screen.getByRole("button", { name: "Continue in memory" }),
      );
      expect(
        await screen.findByRole("button", { name: "New task" }),
      ).toBeVisible();
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });

  it("keeps corrupt data in explicit recovery and reports a failed reset in settings", async () => {
    window.localStorage.setItem("web-boilerplate.workspace", "{bad");
    renderTasks();
    expect(
      await screen.findByRole("heading", { name: /needs recovery/i }),
    ).toBeVisible();
    expect(screen.getByText(/Nothing has been deleted/i)).toBeInTheDocument();

    window.localStorage.clear();
    const original = Storage.prototype.setItem;
    const user = userEvent.setup();
    render(
      <WorkspaceProvider>
        <SettingsPage />
      </WorkspaceProvider>,
    );
    await screen.findByRole("button", { name: "Reset data" });
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    try {
      await user.click(screen.getByRole("button", { name: "Reset data" }));
      await user.click(screen.getByRole("button", { name: "Reset demo data" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "previous saved data is unchanged",
      );
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
