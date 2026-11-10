# Design reference

Static copies of the touch-first design canvas (https://claude.ai/artifact/EstNe5pd4gpTfuqm74VTMW).
Each `*.dc.html` file is one 390×844 phone screen, written as plain HTML with inline styles.
Read them as the visual spec: layout, spacing, copy, colours and type are all in the markup.
Ignore the `<x-dc>`, `<helmet>` and `data-dc-script` wrappers; they belong to the canvas tool.

| File | Screen |
|---|---|
| Main.dc.html | Home: month as a receipt, trip banner, insight, budgets strip, upcoming bills, bottom nav |
| QuickAdd.dc.html | Quick add bottom sheet with keypad |
| ScanReview.dc.html | Scan review: image + fields with confidence edges |
| Activity.dc.html | Activity list grouped by day with filter chips |
| Budgets.dc.html | Plan › Budgets segment |
| Savings.dc.html | Plan › Savings & accounts segment |
| Insights.dc.html | Insights narrative, findings, chat |
| Detail.dc.html | Transaction detail |
| Trip.dc.html | Trip (travel session) page |
