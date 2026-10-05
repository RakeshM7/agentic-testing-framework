# Analytics module crawl log
mode: full-run; authenticated crawl via storage state, role appeared as Organization Admin (Rakesh M).
Pages visited: 9 (list, builder, 2 report views, 4 settings tabs, new-attribute form). Content lives in a nested iframe.
Created: report "Explore QA Report" (trashed afterwards). Favorited it (removed with it).

## Feature-mapping caveats
Discovery listed no subPages; actual module has report builder, report view, Settings (Schedules, Data Export, Custom Metrics, Custom Attributes), Trash and list filters.

## Coverage gaps
- Per-page network-requests/console files are placeholders; only landing screenshot saved to disk (other screenshots were taken but only viewed inline).
- Late in the run a screenshot call was denied by the permission classifier, after clicking Save Attribute with empty fields; validation messages for New Attribute not captured, and exploration stopped there.
- Not opened: sidebar filters (Recent, Favorites, My/Curated/Private/Shared), Trash view, row menu, Sort By, Chart/Interactive Filter/Text/Image widgets, Existing widgets tab, Edit mode on existing report, Clone Report, Email Now, Download, presentation mode, Create Export, Create Metric forms, filter panel, Add Page.
- Gallery entity list captured (26 entities); templates only seen for Accounts and Deals.
- Valid schedule save not performed (would create recurring emails).
- Never clicked Request demo / Help Center.
