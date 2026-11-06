-- No minimum term: every plan is month to month (cancel any time, effective at the end of the paid month).
UPDATE "Plan" SET "minimumMonths" = 0 WHERE "minimumMonths" > 0;
