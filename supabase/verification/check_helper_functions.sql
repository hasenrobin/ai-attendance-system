SELECT p.proname AS function_name,
       pg_get_function_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'current_user_company_id',
    'current_user_is_company_wide',
    'current_user_branch_ids',
    'current_user_has_permission'
  )
ORDER BY p.proname;
