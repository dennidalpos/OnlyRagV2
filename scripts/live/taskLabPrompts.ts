/** Versioned requests; the model, rather than the harness, authors the application. */
export const TASKLAB_PROMPT_VERSION = '1.2.0'
export const TASKLAB_STAGES = [
  {
    id: '01a-scaffold',
    feature: 'scaffold',
    prompt: `Create a minimal JavaScript React/Vite app called TaskLab.
Use root index.html, src/main.jsx and src/App.jsx.
Render a TaskLab heading inside main.
Provide npm dev and build scripts; use "test": "vitest run".
Add src/App.test.jsx using react-dom/server renderToString and explicit Vitest imports; assert the rendered heading without a DOM test environment.
Install dependencies locally, then run tests and build.`,
  },
  {
    id: '01b-tailwind',
    feature: 'styles',
    prompt: `Compile Tailwind CSS locally in TaskLab using the Vite integration.
Import src/index.css from src/main.jsx.
Style the TaskLab heading with text-2xl and font-bold utilities.
The build must emit CSS, and the rendered heading must be 24px and bold.
Run the existing tests and build.`,
  },
  {
    id: '01c-server-browser',
    feature: 'server',
    prompt: `Verify the existing TaskLab scaffold without changing its features.
Start the managed development server.
Open its local page in the browser and check that the TaskLab heading is rendered.
Capture a screenshot.
Stop the managed server after checking it.
Include the complete server lifecycle in the plan's acceptance criteria; run tests and build.`,
  },
  {
    id: '02-navigation',
    feature: 'navigation',
    prompt: `Add Dashboard and Tasks views to TaskLab. Navigation inside a nav element changes the main view.
Both views reuse src/components/TaskCard.jsx. Dashboard has a section named Dashboard cards with at least two example task cards. Give every task article the accessible name "Task: TITLE".
Add a behavioral navigation test. Keep the scaffold, styling and checks working.`,
  },
  {
    id: '03a-mobile',
    feature: 'mobile',
    prompt: `Adapt both TaskLab views for 320px and 375px mobile screens.
Use a single column, a Menu button with aria-expanded and a slide-out navigation drawer. Menu opens the drawer; choosing Tasks closes it.
All pages and components stay inside their containers. Every button and navigation link has a minimum 44x44px target.
Use mobile-first Tailwind utilities and responsive spacing and typography throughout. Check both widths in the browser.`,
  },
  {
    id: '03b-tablet',
    feature: 'tablet',
    prompt: `Adapt TaskLab for a 768px tablet. Add an aside named Sidebar with a Toggle sidebar button whose aria-expanded changes when it collapses and expands the sidebar.
Dashboard cards use two grid columns. Preserve mobile navigation, global touch targets, spacing and typography.
Check navigation and overflow at 768px in the browser.`,
  },
  {
    id: '03c-desktop',
    feature: 'desktop',
    prompt: `Adapt TaskLab for 1024px, 1440px and 1920px desktop widths.
Show a left sidebar and a multi-column Dashboard grid. Use responsive Flexbox/Grid containers rather than fixed page widths.
Preserve mobile and tablet behavior. Check all three desktop widths for overflow, clipped content and readable spacing and typography.`,
  },
  {
    id: '04a-create-complete',
    feature: 'create',
    prompt: `Add task creation and completion to TaskLab.
Use a form named New task, inputs labelled Title and Description, and an Add task button. Reject empty titles.
Use two form columns on desktop when appropriate; mobile inputs are full-width and buttons stack vertically.
Task articles have the accessible name "Task: TITLE" and a checkbox named "Complete TITLE". Toggling it changes completion.
Keep tasks in creation order and add behavioral tests for creation and completion. Preserve both views and responsive behavior.`,
  },
  {
    id: '04b-edit-delete',
    feature: 'crud',
    prompt: `Add task editing and deletion to TaskLab.
Each task has buttons named "Edit TITLE" and "Delete TITLE". Editing opens a form named Edit task with Title and Description fields, Save and Cancel.
Saving updates the task in place without changing its order. Cancel keeps its original values. Delete removes only the selected task.
Add behavioral tests. Keep creation, completion, navigation and responsive forms working.`,
  },
  {
    id: '05-persistence',
    feature: 'persistence',
    prompt: `Add persistence to TaskLab. First ask me whether to use localStorage or a server database.
After my explicit choice, preserve task titles, descriptions, completion and order after reload.
Keep the existing task behavior and add a persistence regression test.`,
  },
  {
    id: '06a-filter',
    feature: 'filter',
    prompt: `Add a select labelled Status filter with options All, Active and Completed to Tasks.
Filtering changes only visibility, preserving task values and creation order. Add behavioral filter tests.
Keep persistence and all existing behavior.`,
  },
  {
    id: '06b-csv',
    feature: 'csv',
    prompt: `Add an Export CSV button to Tasks. Download the currently filtered records in their original creation order.
Include title, description and completion columns. Encode UTF-8 with comma delimiters and CRLF records; quote fields containing comma, quote or newline, doubling embedded quotes.
Add export tests with accented text and delimiters. Keep filters, persistence and existing behavior.`,
  },
  {
    id: '06c-boundaries',
    feature: 'boundaries',
    prompt: `Move TaskLab persistence into src/services/taskStore.js while preserving the confirmed localStorage choice.
Document future MongoDB, Redis, TodoWrite and Nuvolaris OpenServerless adapter boundaries in src/services/README.md.
Do not add connections, clients or placeholder implementations for those integrations. Run the existing regression tests and build.`,
  },
  {
    id: '07-refactor',
    feature: 'refactor',
    prompt: `Rename TaskLab src/components/TaskCard.jsx to src/components/TaskItem.jsx and rename its exported component.
Update every import and use in Dashboard and Tasks. Remove the old module. Preserve all behavior and the localStorage decision.
Run tests and build to catch broken imports.`,
  },
  {
    id: '08-browser',
    feature: 'browser',
    prompt: `Verify TaskLab in the managed local browser: navigate Dashboard and Tasks, create, edit, complete and delete a task, reload retained tasks, filter and export CSV.
Check 320, 375, 768, 1024, 1440 and 1920px for overflow, global 44x44px targets, responsive forms, sidebar/drawer, spacing and typography.
Capture screenshots. Fix any failures, run tests and build, then stop the managed server.`,
  },
  {
    id: '08-resumed',
    feature: 'resumed',
    prompt: `Continue the saved TaskLab session. Preserve verified work and the explicit localStorage decision.
Add a main footer saying "TaskLab ready". Do not re-scaffold or replace existing features.
Verify the footer in a behavioral test, run all tests and build, and recheck the existing task behavior in the browser.`,
  },
] as const

export type TaskLabFeature = (typeof TASKLAB_STAGES)[number]['feature']
