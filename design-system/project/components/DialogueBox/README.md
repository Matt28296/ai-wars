# DialogueBox

The story's voice: portrait, speaker name in their faction ink with sigil, optional radio channel, and up to three lines of text.

**Provide:** `speaker` (`{name, faction, initials, src, title}`), `side`, optional `channel`, the line as children, and `more` while further lines follow.

- Alternate sides between speakers; the same speaker keeps their side for a whole scene.
- ECHO has no nation: `faction: null` paints it in signal — ECHO is the interface.
- Body copy is `body`; keep a line under 140 characters and never over 220.
- Text types on at the player's text speed; the first confirm completes the line, the second advances.
