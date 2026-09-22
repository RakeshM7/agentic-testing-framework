import { Page, Locator } from '@playwright/test';

/**
 * Best-effort Page Objects for the Task / Call log / Note creation UI reachable from a Deal
 * detail page's top action bar (button labels "Task" / "Call log" are literal captured text —
 * see `artifacts/rakesh-freshsales-ind-sep21/explore/pages/contact-detail-explore-agenttestlead/dom-snapshot.md`'s
 * "Top action bar: Email | Call log | Task | Meeting | ..."). The Task form's Title field and the
 * "Save" action are grounded in the same explore run's confirmed flow (deal-detail-explore-test-co
 * dom-snapshot: "clicked 'Task' ... filled Title ... saved" -> `POST /crm/sales/tasks` -> 201).
 *
 * Call log and Note field structure were NOT captured by explore-agent (the clarifications doc's
 * grounding reference explicitly calls this out: "Call and Note creation endpoints were not
 * directly captured in this crawl ... automation agents should discover the exact Call/Note
 * endpoints live during test execution"), and this run's own attempt to reach a live authenticated
 * session was blocked by reCAPTCHA (see README.md "Known blocker") — so `CallLogFormModal` and
 * `NoteComposer` below are placeholders pending that live discovery, not confirmed selectors.
 */
export class TaskFormModal {
  readonly titleInput: Locator;
  readonly saveButton: Locator;

  constructor(private readonly page: Page) {
    this.titleInput = page.getByLabel('Title', { exact: false });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
  }

  async fillAndSave(title: string) {
    await this.titleInput.fill(title);
    await this.saveButton.click();
  }
}

/** Placeholder pending live field discovery — see class-level doc comment above. */
export class CallLogFormModal {
  readonly saveButton: Locator;

  constructor(private readonly page: Page) {
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
  }
}

/** Placeholder pending live confirmation of the Deal-detail equivalent — see doc comment above. */
export class NoteComposer {
  readonly noteBox: Locator;

  constructor(private readonly page: Page) {
    this.noteBox = page.getByPlaceholder('Add a note...');
  }

  async addNote(text: string) {
    await this.noteBox.fill(text);
    await this.page.keyboard.press('Enter');
  }
}
