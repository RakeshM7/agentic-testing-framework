# Crawl Log

- Target: https://cloud.idurarapp.com/
- Mode: readonly
- Authenticated crawl: yes; browser session loaded `playwright-tests/.auth/idurar-session.json`.
- Pages visited: 10 (maximum 25)
- Maximum depth: 3
- Maximum depth reached: 1
- Login walls: none encountered; authenticated dashboard was available.
- Mutating actions: none. Add New, Create, Edit, Delete, Send by Email, Download, Save, and Logout were not activated.
- Detail pages: none opened because every requested module list displayed “No data”.
- Console errors and warnings: 0 across all 10 visited views.

## Pages Visited

- `https://cloud.idurarapp.com/` (depth 0, Dashboard)
- `https://cloud.idurarapp.com/customer` (depth 1, Customers; no rows)
- `https://cloud.idurarapp.com/lead` (depth 1, Leads; no rows)
- `https://cloud.idurarapp.com/offer` (depth 1, Offers for Leads; no rows)
- `https://cloud.idurarapp.com/quote` (depth 1, Quotes; no rows)
- `https://cloud.idurarapp.com/invoice` (depth 1, Invoices; no rows)
- `https://cloud.idurarapp.com/payment` (depth 1, Payments; no rows)
- `https://cloud.idurarapp.com/product` (depth 1, Products; no rows)
- `https://cloud.idurarapp.com/expenses` (depth 1, Expenses; no rows)
- `https://cloud.idurarapp.com/settings` (depth 1, Settings; General Settings tab captured without saving)

## Discovered but Skipped

- Add New controls on Customers, Leads, Offers, Quotes, Invoices, Products, and Expenses were skipped because they start create flows.
- Other main-menu destinations not requested were recorded in the sitemap but not visited: Peoples, Companies, Products Category, Order, Expenses Category, and Report.
- Settings submenu destinations Admin, Developer Api Key, About, Email Templates, Multi-company, Currencies, Public Form, Tax, and Payments Mode were not visited; only the requested Settings page was opened.
- Settings tabs Company Settings, Company Logo, Currency Settings, PDF Settings, and Finance Settings were not opened. The General Settings view contains editable controls, so no values were changed and Save was not clicked.
- No row-level actions or detail links were available because all requested lists were empty. Logout was not clicked.

## Summary

Authenticated readonly exploration captured Dashboard, Customers, Leads, Offers, Quotes, Invoices, Payments, Products, Expenses, and Settings. Every requested module list was empty, so there were no detail pages to inspect. The per-page screenshot, accessibility snapshot, filtered network requests, and console log are under `pages/<slug>/`.