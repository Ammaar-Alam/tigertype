# Plan: Add Test Configuration UI to Practice Mode

This document outlines the plan to add configuration options (Mode and Duration) to the Practice Mode UI in the Race page.

## 1. State Changes in `Race.jsx`

Introduce two new state variables within the `Race` component (`client/src/pages/Race.jsx`):

-   `testMode`: Tracks the selected test type.
    -   Values: `'snippet'` (default), `'free_type'`
    -   Purpose: Determines whether the user types a predefined snippet or random words.
-   `testDuration`: Stores the selected time limit for 'Free Type' mode.
    -   Values: `15` (default), `30`, `60`, `120` (in seconds)
    -   Purpose: Sets the duration for the 'Free Type' test.

## 2. New Component: `TestConfigurator.jsx`

Create a new component file: `client/src/components/TestConfigurator.jsx`.

-   **Props:** It will receive `testMode`, `testDuration`, `setTestMode`, and `setTestDuration` from `Race.jsx`.
-   **UI Elements:**
    -   **Mode Selection:** Buttons or similar controls labeled "Snippets" and "Free Type" to update the `testMode` state.
    -   **Duration Selection:** Buttons or a dropdown labeled "15s", "30s", "60s", "120s". This section will *only be visible* when `testMode` is `'free_type'` and will update the `testDuration` state.

## 3. Integration into `Race.jsx`

-   Import `TestConfigurator` into `client/src/pages/Race.jsx`.
-   Render `<TestConfigurator />` conditionally, *only* when `raceState.type === 'practice'`.
-   **Placement:** Insert the component within the `race-container` div, specifically between the `race-header-wrapper` div and the `race-content` div.
-   Pass the `testMode`, `testDuration`, `setTestMode`, and `setTestDuration` state and setters as props to the `TestConfigurator` instance.

## 4. Visual Structure (Conceptual)

```mermaid
graph TD
    subgraph Race.jsx
        A[race-header-wrapper: Title, Back Button] --> B{Only if raceState.type === 'practice'};
        B -- Yes --> C[TestConfigurator: Mode & Duration Selectors];
        B -- No --> D[race-content: Typing/Results/PlayerStatus];
        C --> D;
    end

    subgraph TestConfigurator.jsx
        E[Mode Selector: Snippets | Free Type] --> F{If Mode == 'Free Type'};
        F -- Yes --> G[Duration Selector: 15s | 30s | 60s | 120s];
    end
```

## 5. Next Steps

Implement the `TestConfigurator.jsx` component and modify `Race.jsx` according to this plan. The logic for handling the 'Free Type' mode within the `Typing` component itself is a separate task.