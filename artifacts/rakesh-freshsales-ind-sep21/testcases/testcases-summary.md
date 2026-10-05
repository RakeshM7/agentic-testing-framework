# Test case summary: lead-to-deal-pipeline (rakesh-freshsales-ind-sep21)

Source: `artifacts/rakesh-freshsales-ind-sep21/clarifications/lead-to-deal-pipeline-clarifications.md`
Output: `artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv` (confirmed format: CSV)

## Counts by category
| Category | Count |
|---|---|
| Happy | 8 |
| Negative | 3 |
| Boundary | 5 |
| Total | 16 |

## Counts by priority
| Priority | Count |
|---|---|
| P0 | 5 |
| P1 | 9 |
| P2 | 2 |

## Traceability matrix
| Test case | Covers |
|---|---|
| TC-lead-to-deal-pipeline-001 | Q1, Q10: Create Contact (Status New / Lifecycle Lead) |
| TC-lead-to-deal-pipeline-002 | Q2: Qualified -> Sales Qualified Lead |
| TC-lead-to-deal-pipeline-003 | Q3: Link to Account (existing-vs-new open question) |
| TC-lead-to-deal-pipeline-004 | Q4: '+ New Deal' |
| TC-lead-to-deal-pipeline-005 | Q5: Kanban moves through all stages |
| TC-lead-to-deal-pipeline-006 | Q6: Task |
| TC-lead-to-deal-pipeline-007 | Q6: Call |
| TC-lead-to-deal-pipeline-008 | Q6: Note |
| TC-lead-to-deal-pipeline-009 | Edge: missing required contact field (Q8) |
| TC-lead-to-deal-pipeline-010 | Edge: invalid email (Q8) |
| TC-lead-to-deal-pipeline-011 | Edge: invalid phone (Q8) |
| TC-lead-to-deal-pipeline-012 | Edge: deal empty name (Q8) |
| TC-lead-to-deal-pipeline-013 | Edge: non-numeric amount (Q8) |
| TC-lead-to-deal-pipeline-014 | Edge: task no title (Q8) |
| TC-lead-to-deal-pipeline-015 | Edge: skip/backward/Won/Lost (Q9, placeholder, not asserted) |
| TC-lead-to-deal-pipeline-016 | Edge: other unlisted (placeholder, not asserted) |

## Notes
- Exact stage names/count, required fields and error text were not available in the snapshots (only partial: stages "Qualification" and "Negotiation" seen); steps defer to live UI observation per the clarifications doc.
- Cases 015 and 016 are placeholders for unconfirmed rows; automation should skip them.
- No `playwright-tests/.env` exists, so no identity cross-check was needed; no specific account is named in the cases.
