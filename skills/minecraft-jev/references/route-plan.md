# Route plans

A plan is a short sequence of already-inspected menu actions with a completion check after each. The runner supports a click or a navigation key, not arbitrary shell code, generated coordinates or unreviewed command text. Match the current client layout before reusing this example.

The runner checks the actual window/screenshot dimensions before input. Each screen's `regions` contains pixel crop boxes `[left, top, right, bottom]`; `all` requires every literal clause, case-insensitive. A `|` separates explicitly observed OCR alternatives in one clause (not regex). `description` states the expected screen for the optional Jev judgment. In hybrid mode, a failed local check makes one text-only Jev request; uncertainty returns the current screenshot and stops. No implicit input retries or screenshot polling.

Use the exact current instance ID and PID from this task's native MCP launch. The script attaches using the installed MCP socket adapter and leaves lifecycle ownership with that MCP connection. It does not launch a replacement. Do not issue native MCP input concurrently. Its native-size screenshots avoid click-scale mismatch inside the runner; after switching back to native MCP clicks, take one screenshot at the intended width to establish that MCP connection's scale.

This is the verified 854×480 title → Play → title plan for Minecraft 1.26.50.4. Save it as a local JSON file if those screens match the current client:

```json
{
  "width": 854,
  "height": 480,
  "start": {
    "description": "Minecraft title menu identified by the Play and Settings buttons. Realms may also appear.",
    "regions": [
      [
        355,
        257,
        497,
        280
      ],
      [
        355,
        288,
        497,
        312
      ],
      [
        355,
        320,
        497,
        342
      ]
    ],
    "all": [
      "Play",
      "Settings"
    ]
  },
  "steps": [
    {
      "name": "open-play",
      "action": {
        "click": [
          426,
          269
        ]
      },
      "after": {
        "description": "Minecraft Play screen identified by the Servers tab and Create new world button, possibly OCR spelling worid.",
        "regions": [
          [
            610,
            51,
            675,
            69
          ],
          [
            620,
            115,
            737,
            133
          ]
        ],
        "all": [
          "Servers",
          "Create new world|Create new worid"
        ]
      },
      "settle_ms": 1500
    },
    {
      "name": "return-main",
      "action": {
        "key": "escape"
      },
      "after": {
        "description": "Minecraft title menu identified by the Play and Settings buttons. Realms may also appear.",
        "regions": [
          [
            355,
            257,
            497,
            280
          ],
          [
            355,
            288,
            497,
            312
          ],
          [
            355,
            320,
            497,
            342
          ]
        ],
        "all": [
          "Play",
          "Settings"
        ]
      },
      "settle_ms": 1500
    }
  ]
}
```

`settle_ms` is the measured allowance for each known transition (300–5000 ms). A route is limited to 12 steps and a 65-second watchdog. A failed result is not permission to lengthen waits or click again without diagnosis. `result.json` retains every local observation and screenshot path; normal stdout has only status, timings and final/failure image path. Return that one image through `view_image` in the calling tool batch.

For unexpected modals, UI layout tests, world geometry or visual regressions, use parent visual reasoning. A text match cannot establish a visual feature's correctness. Keep the original requested completion check, including any required final image review.
