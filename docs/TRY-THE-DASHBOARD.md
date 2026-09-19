# Try the dashboard without an account

Use a separate desktop Obsidian test vault with the plugin installed. These are synthetic values, not a health assessment. This walkthrough has been checked against the source; a clean-install UI test is still pending.

1. Create a folder named `Health Demo` and set the plugin's daily notes folder to it. Leave Google disconnected and Apple ingestion disabled.
2. Create `Health Demo/2026-09-16.md` with:

```yaml
---
Sleep_hours: 7.5
Readiness: 72
HRV: 45
steps: 6400
---
```

3. Create `Health Demo/2026-09-17.md` with:

```yaml
---
Sleep_hours: 8
Readiness: 78
HRV: 48
steps: 8200
---
```

4. Create a dashboard note outside that folder and paste:

````markdown
```health-dashboard
from: 2026-09-16
to: 2026-09-17
```
````

5. Open Reading view. With the default cards, expect sleep, readiness, HRV, and steps to include the two dates. The step total should be 14,600. If empty, check the configured folder, filenames, frontmatter, and enabled cards.

For a short demo recording, show the sample notes, switch to the dashboard, then change one sample value and reopen the dashboard. Label the recording “synthetic sample data.” No cloud account or personal records are needed.
