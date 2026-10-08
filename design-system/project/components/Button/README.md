# Button

The interface's verbs outside the battlefield menus: deploy, confirm, cancel, resign.

**Provide:** a label in one or two words (set in capitals by the component), `variant`, an optional `hotkey` key cap, and the usual button props.

- `primary` is the single action that moves the player forward on a screen (Deploy, End turn, Continue). One per screen.
- `secondary` (default) for everything else; `danger` only for irreversible ends (Resign, Delete save); `ghost` for skips and dismissals.
- Show the hotkey on desktop: `Z` confirms, `X` cancels, matching the battlefield.
- Don't use a Button inside the battlefield's command menu — that is `CommandMenu`.
