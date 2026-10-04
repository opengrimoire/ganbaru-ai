-- Policy-first native aggregate admission must not scan unrelated experiments.
CREATE INDEX idx_pomodoro_adaptive_experiments_policy
ON pomodoro_adaptive_experiments(policy_id);
