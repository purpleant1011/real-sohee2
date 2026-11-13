delete from public.report_decisions
where owner_note = 'MCP atomic decision verification; remove after test'
   or hypothesis = 'MCP experiment verification; remove after test';
