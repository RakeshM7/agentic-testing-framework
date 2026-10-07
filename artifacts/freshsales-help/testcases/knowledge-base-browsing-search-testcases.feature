Feature: Browse and search the public Freshsales Classic knowledge base
  As a public support-portal visitor
  I want to browse knowledge-base categories and search for articles
  So that I can find support information without signing in

  Background:
    Given I am not signed in
    And I am on the public Freshsales Classic support homepage "https://support.freshsales.io/support/home"

  @positive @P1
  Scenario: Browse the Getting Started category landing page
    # Test Case ID: TC-knowledge-base-browsing-search-001
    # Traceability: Answer 1, Answer 2; scope: Getting Started
    When I select the "Getting Started" knowledge-base category
    Then the "Getting Started with Freshsales" category landing page is displayed
    And the "Find some solutions here..." search box is visible
    And I do not open a subcategory folder or individual article

  @positive @P1
  Scenario: Browse the Leads, Contacts, and Accounts category landing page
    # Test Case ID: TC-knowledge-base-browsing-search-002
    # Traceability: Answer 1, Answer 2; scope: Leads/Contacts/Accounts
    When I select the "Leads, Contacts, & Accounts" knowledge-base category
    Then the "Leads, Contacts, Accounts, Products, and Custom modules" category landing page is displayed
    And the "Find some solutions here..." search box is visible
    And I do not open a subcategory folder or individual article

  @positive @P1
  Scenario: Browse the Deals category landing page
    # Test Case ID: TC-knowledge-base-browsing-search-003
    # Traceability: Answer 1, Answer 2; scope: Deals
    When I select the "Deals" knowledge-base category
    Then the "Deals" category landing page is displayed
    And the "Find some solutions here..." search box is visible
    And I do not open a subcategory folder or individual article

  @positive @P1
  Scenario: Browse the Admin Settings category landing page
    # Test Case ID: TC-knowledge-base-browsing-search-004
    # Traceability: Answer 1, Answer 2; scope: Admin Settings
    When I select the "Admin Settings" knowledge-base category
    Then the "Admin Settings" category landing page is displayed
    And the "Find some solutions here..." search box is visible
    And I do not open a subcategory folder or individual article

  @positive @P1 @unconfirmed-relevance
  Scenario: Search the public help center for email
    # Test Case ID: TC-knowledge-base-browsing-search-005
    # Traceability: Answer 3; edge case: Generic query email or deals
    When I enter "email" in the "Go ahead, ask us anything" search box
    And I select "Search"
    Then search results are displayed that appear relevant to "email"
    And I do not assert exact result titles or their order
    # UNCONFIRMED: Exact relevant article titles and the relevance oracle are unspecified.

  @positive @P1 @unconfirmed-relevance
  Scenario: Search the public help center for deals
    # Test Case ID: TC-knowledge-base-browsing-search-006
    # Traceability: Answer 3; edge case: Generic query email or deals
    When I enter "deals" in the "Go ahead, ask us anything" search box
    And I select "Search"
    Then search results are displayed that appear relevant to "deals"
    And I do not assert exact result titles or their order
    # UNCONFIRMED: Exact relevant article titles and the relevance oracle are unspecified.

  @negative @boundary @P1 @unconfirmed-empty-query-behavior
  Scenario: Submit an empty search query
    # Test Case ID: TC-knowledge-base-browsing-search-007
    # Traceability: Answer 4; edge case: Empty query
    When I leave the "Go ahead, ask us anything" search box empty
    And I select "Search"
    Then the UI handles the empty query without an application error
    # UNCONFIRMED: Exact validation or empty-state behavior and copy are unspecified.

  @negative @boundary @P1 @unconfirmed-whitespace-query-behavior
  Scenario: Submit a whitespace-only search query
    # Test Case ID: TC-knowledge-base-browsing-search-008
    # Traceability: Answer 4; edge case: Whitespace-only query
    When I enter only whitespace in the "Go ahead, ask us anything" search box
    And I select "Search"
    Then the UI handles the whitespace-only query without an application error
    # UNCONFIRMED: Whether whitespace is trimmed, rejected, or treated as empty is unspecified.
    # UNCONFIRMED: Exact validation or empty-state copy is unspecified.

  @negative @boundary @P1 @unconfirmed-no-results-copy
  Scenario: Search for a term with no matching results
    # Test Case ID: TC-knowledge-base-browsing-search-009
    # Traceability: Answer 4; edge case: Query with no matches
    When I enter a query that has no matching results in the "Go ahead, ask us anything" search box
    And I select "Search"
    Then the UI handles the query without an application error
    And an appropriate no-results state is presented
    # UNCONFIRMED: The exact wording and presentation of the no-results state are unspecified.