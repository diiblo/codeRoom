CREATE UNIQUE INDEX IF NOT EXISTS execution_sessions_provider_key_unique
  ON execution_sessions (provider, provider_session_key)
  WHERE provider_session_key IS NOT NULL;
