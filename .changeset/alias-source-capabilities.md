---
"@reasoning-router/opencode": patch
---

Aliases now advertise their source model's input and output capabilities explicitly, so OpenCode sends PDF attachments to aliases whose source accepts PDFs. Before the source resolves, or if it never does, an alias advertises text only instead of text and image.
