-- AI Search Metrics SQL Starter Kit
-- Each named query returns: metric, engine, numerator, denominator, rate.

-- name: answer_metrics
WITH answered AS (
  SELECT * FROM audit_rows WHERE answer_available = 'yes'
),
metrics AS (
  SELECT 'mention_rate' AS metric, engine,
         SUM(CASE WHEN brand_mentioned = 'yes' THEN 1 ELSE 0 END) AS numerator,
         COUNT(*) AS denominator
  FROM answered GROUP BY engine
  UNION ALL
  SELECT 'recommendation_rate', engine,
         SUM(CASE WHEN brand_recommended = 'yes' THEN 1 ELSE 0 END), COUNT(*)
  FROM answered GROUP BY engine
  UNION ALL
  SELECT 'answered_rows', engine, COUNT(*), COUNT(*)
  FROM answered GROUP BY engine
)
SELECT metric, engine, numerator, denominator,
       CASE WHEN denominator = 0 THEN NULL ELSE ROUND(CAST(numerator AS REAL) / denominator, 4) END AS rate
FROM metrics
ORDER BY metric, engine;

-- name: citation_metrics
WITH answered AS (
  SELECT * FROM audit_rows WHERE answer_available = 'yes'
),
metrics AS (
  SELECT 'citation_present_rate_answer' AS metric, engine,
         SUM(CASE WHEN citation_count > 0 THEN 1 ELSE 0 END) AS numerator,
         COUNT(*) AS denominator
  FROM answered GROUP BY engine
  UNION ALL
  SELECT 'brand_citation_rate_answer', engine,
         SUM(CASE WHEN cited_brand_source = 'yes' THEN 1 ELSE 0 END), COUNT(*)
  FROM answered GROUP BY engine
  UNION ALL
  SELECT 'brand_citation_rate_cited_answers', engine,
         SUM(CASE WHEN cited_brand_source = 'yes' THEN 1 ELSE 0 END),
         SUM(CASE WHEN citation_count > 0 THEN 1 ELSE 0 END)
  FROM answered GROUP BY engine
)
SELECT metric, engine, numerator, denominator,
       CASE WHEN denominator = 0 THEN NULL ELSE ROUND(CAST(numerator AS REAL) / denominator, 4) END AS rate
FROM metrics
ORDER BY metric, engine;
